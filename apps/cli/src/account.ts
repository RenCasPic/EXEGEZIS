import { cp, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AccessStore, defaultAccessDir, osProtector, systemProtector } from "@exegezis/access";
import { adoptRuns, connect, findClaimant, userDirs, type RunKind } from "@exegezis/accounts";
import { searchDataDir } from "@exegezis/search/light";
import { EXIT, parseArgsError, UsageError } from "./args.js";
import { t } from "./i18n.js";
import type { CliIo } from "./shared.js";

/*
 * `exegezis account claim-local [--email <email>] [--dry-run]`
 * (docs/13-accounts.md): gives what the CLI already has on this machine —
 * runs/, the saved site accesses and the search settings — to a web app
 * account: the first one created, or the one with --email. It copies (the
 * originals stay for the CLI), re-encrypts the saved accesses with the app's
 * key, and records every
 * inspection, search and investigation in the database as that user's.
 */

export interface AccountCommand {
  kind: "account";
  action: "claim-local";
  email: string | null;
  dryRun: boolean;
}

export function parseAccountArgs(argv: readonly string[]): AccountCommand {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { email: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  } catch (error) {
    throw parseArgsError(error);
  }
  const [action, ...extra] = parsed.positionals;
  if (action !== "claim-local") throw new UsageError(t("account.action"));
  if (extra.length > 0) throw new UsageError(t("args.unexpected", { arg: String(extra[0]) }));
  return { kind: "account", action, email: parsed.values.email?.trim() || null, dryRun: parsed.values["dry-run"] };
}

interface FoundRun {
  id: string;
  kind: RunKind;
  targetUrl: string;
  createdAt: string | null;
  pagesRequested: number | null;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

/** Inspections, searches and investigations under `dir` (by their report files), for the database. */
async function findRuns(dir: string, depth = 0, out: FoundRun[] = []): Promise<FoundRun[]> {
  if (depth > 8) return out;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  const id = dir.split(/[\\/]/).at(-1) ?? "";
  if (names.includes("inspection-report.json") || names.includes("search-report.json")) {
    const inspection = names.includes("inspection-report.json");
    const report = await readJson(join(dir, inspection ? "inspection-report.json" : "search-report.json"));
    const url = str(obj(report?.["target"])["url"]);
    if (url !== null) out.push({ id, kind: inspection ? "inspection" : "search", targetUrl: url, createdAt: str(report?.["startedAt"]), pagesRequested: Number(obj(report?.["options"])["maxPages"]) || null });
    return out;
  }
  if (names.includes("bug-report.json")) {
    const report = await readJson(join(dir, "bug-report.json"));
    const url = str(obj(report?.["target"])["baseUrl"]) ?? str(report?.["baseUrl"]) ?? str(obj(report?.["environment"])["baseUrl"]);
    if (url !== null) out.push({ id, kind: "investigation", targetUrl: url, createdAt: str(report?.["createdAt"]) ?? str(report?.["startedAt"]), pagesRequested: null });
    return out;
  }
  for (const name of names) {
    if (name.startsWith(".") || ["node_modules", "screenshots", "dom", "attempts"].includes(name)) continue;
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) await findRuns(path, depth + 1, out);
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function accountCommand(command: AccountCommand, io: CliIo, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const out = (line: string) => io.stdout.write(`${line}\n`);
  const databaseUrl = (env["DATABASE_URL"] ?? "").trim();
  if (databaseUrl === "") {
    io.stderr.write(`${t("account.needsDatabase")}\n`);
    return EXIT.usage;
  }
  const dataDir = resolve((env["EXEGEZIS_DATA_DIR"] ?? "").trim() || join(process.cwd(), "data"));
  const runsDir = resolve((env["EXEGEZIS_RUNS_DIR"] ?? "").trim() || join(process.cwd(), "runs"));
  const sql = connect(databaseUrl, { max: 1 });
  try {
    const user = await findClaimant(sql, command.email);
    if (user === null) {
      io.stderr.write(`${command.email === null ? t("account.noAccounts") : t("account.noSuchEmail", { email: command.email })}\n`);
      return EXIT.expectationFailed;
    }
    const dirs = userDirs(dataDir, user.id);
    const runs = await findRuns(runsDir);
    const source = new AccessStore(defaultAccessDir(), osProtector());
    const entries = await source.index().catch(() => []);
    const searchDir = searchDataDir();
    out(t("account.claimFor", { email: user.email, id: user.id }));
    out(t("account.from", { runs: runsDir, access: source.dir, search: searchDir }));
    out(t("account.to", { dir: dirs.root }));
    out(t("account.found", { runs: runs.length, access: entries.length }));
    if (command.dryRun) {
      out(t("account.dryRun"));
      return EXIT.ok;
    }

    // 1. Artifacts: copied, never overwriting what the account already has.
    if (await exists(runsDir)) await cp(runsDir, dirs.runs, { recursive: true, force: false, errorOnExist: false });
    if (await exists(searchDir)) await cp(searchDir, dirs.search, { recursive: true, force: false, errorOnExist: false });
    // 2. Saved accesses: decrypted with this machine's key, encrypted again with the cloud one.
    const target = new AccessStore(dirs.access, systemProtector());
    let moved = 0;
    const unreadable: string[] = [];
    for (const entry of entries) {
      try {
        const secrets = await source.get(entry.origin);
        if (secrets === null) continue;
        await target.put(entry.origin, secrets);
        await target.touch(entry.origin, { settings: entry.settings, expired: entry.expired, lastUsedAt: entry.lastUsedAt });
        moved++;
      } catch {
        unreadable.push(entry.origin);
      }
    }
    // 3. Metadata: the runs are the account's (usage, ownership).
    const added = await adoptRuns(sql, user.id, runs);
    out(t("account.done", { runs: added, access: moved }));
    if (unreadable.length > 0) out(t("account.unreadable", { origins: unreadable.join(", ") }));
    return EXIT.ok;
  } finally {
    await sql.end();
  }
}
