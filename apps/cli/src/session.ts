import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { AccessStore, AccessUnreadableError, KeystoreUnavailableError, normalizeOrigin, type AccessEntry } from "@exegezis/access";
import type { AdapterAccess } from "@exegezis/adapter-browser";
import { captureAccess } from "@exegezis/inspect";
import { z } from "zod";
import { EXIT, UsageError, type SessionCommand } from "./args.js";
import { printer, type CliIo } from "./shared.js";
import { engineText, t } from "./i18n.js";
import type { BlockInfo } from "@exegezis/core";

/**
 * `exegezis session …` (docs/09-access.md). Every value that is a secret
 * travels through stdin or the visible window, never through arguments, and
 * is never printed — except the WAF token, shown once so it can be put in
 * the site's own WAF rule.
 */
export function openStore(): AccessStore {
  return new AccessStore();
}

/** The origin's saved access, decrypted in memory, as the adapter takes it. Unreadable access is reported, not fatal. */
export async function loadAccess(url: string, io: CliIo): Promise<{ access: AdapterAccess | null; entry: AccessEntry | null; warning: string | null }> {
  const store = openStore();
  const origin = normalizeOrigin(url);
  const entry = await store.entry(origin);
  if (entry === null || entry.kinds.length === 0) return { access: null, entry, warning: null };
  try {
    const secrets = await store.get(origin);
    if (secrets === null) return { access: null, entry, warning: null };
    return {
      access: {
        origin,
        ...(secrets.storageState === undefined ? {} : { storageState: secrets.storageState }),
        ...(secrets.httpCredentials === undefined ? {} : { httpCredentials: secrets.httpCredentials }),
        ...(secrets.wafToken === undefined ? {} : { wafToken: secrets.wafToken }),
      },
      entry,
      warning: null,
    };
  } catch (error) {
    if (error instanceof AccessUnreadableError || error instanceof KeystoreUnavailableError) {
      void io;
      return { access: null, entry, warning: t("session.anonymousFallback", { message: error.message }) };
    }
    throw error;
  }
}

const KINDS = ["session", "httpCredentials", "wafToken"] as const;
const kindName = (k: string): string => ((KINDS as readonly string[]).includes(k) ? t(`session.kind.${k as (typeof KINDS)[number]}`) : k);

/** Why a login did not save anything, in the current language (the block's own detail through its code). */
function loginReason(result: { reason: string; block: BlockInfo | null }): string {
  if (result.block !== null) return t("session.stillBlocked", { kind: result.block.kind, detail: engineText(result.block.message, result.block.detail) });
  if (result.reason.startsWith("The window was closed")) return t("session.windowClosed");
  const status = /^the page is still not reachable \((.*)\)$/.exec(result.reason)?.[1];
  return status === undefined ? result.reason : t("session.stillUnreachable", { status });
}

function status(entry: AccessEntry, now = Date.now()): string {
  if (entry.expired) return t("session.expiredWall");
  if (entry.expiresAt !== null && Date.parse(entry.expiresAt) < now) return t("session.expiredOn", { date: entry.expiresAt.slice(0, 10) });
  return entry.expiresAt === null ? t("session.active") : t("session.activeUntil", { date: entry.expiresAt.slice(0, 10) });
}

const HttpAuthInput = z.strictObject({ username: z.string().min(1), password: z.string().min(1) });

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += String(chunk);
  return text;
}

/** Asks for a value on the terminal; `hidden` stops the echo (passwords). */
async function ask(question: string, hidden: boolean): Promise<string> {
  const input = process.stdin;
  const rl = createInterface({ input, output: process.stderr, terminal: true });
  if (hidden) {
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) write.call(rl, s);
    };
  }
  try {
    return await new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
  } finally {
    rl.close();
    if (hidden) process.stderr.write("\n");
  }
}

function waitForDone(doneFile: string | undefined): Promise<void> {
  if (doneFile !== undefined) {
    // The UI's "Done" button creates this file.
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (existsSync(doneFile)) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

export async function sessionCommand(cmd: SessionCommand, io: CliIo, exegezisVersion: string): Promise<number> {
  const out = printer(io);
  const store = openStore();
  try {
    switch (cmd.action) {
      case "list": {
        const entries = (await store.index()).filter((e) => e.kinds.length > 0 || e.settings.robotsOwner || e.settings.unsafeLinkPatterns.length > 0);
        if (cmd.json) {
          io.stdout.write(`${JSON.stringify({ dir: store.dir, entries }, null, 2)}\n`);
          return EXIT.ok;
        }
        out(t("session.listTitle", { dir: store.dir }));
        out(t("session.listNote"));
        out();
        if (entries.length === 0) out(t("session.listNone"));
        for (const e of entries) {
          out(`  ${e.origin}`);
          out(`    ${e.kinds.length === 0 ? t("session.noAccess") : e.kinds.map(kindName).join(", ")} · ${e.kinds.includes("session") ? status(e) : "—"} · ${t("session.lastUsed", { when: e.lastUsedAt?.slice(0, 16).replace("T", " ") ?? t("session.never") })}`);
          if (e.settings.robotsOwner) out(t("session.yours"));
          if (e.settings.unsafeLinkPatterns.length > 0) out(t("session.neverVisited", { patterns: e.settings.unsafeLinkPatterns.join(", ") }));
        }
        return EXIT.ok;
      }
      case "delete": {
        const removed = await store.delete(cmd.url as string);
        out(removed ? t("session.forgot", { origin: normalizeOrigin(cmd.url as string) }) : t("session.nothingSaved", { origin: normalizeOrigin(cmd.url as string) }));
        return EXIT.ok;
      }
      case "set": {
        if (cmd.robotsOwner === undefined && cmd.unsafePatterns === undefined) throw new UsageError(t("session.nothingToSet"));
        const entry = await store.entry(cmd.url as string);
        const settings = {
          robotsOwner: cmd.robotsOwner ?? entry?.settings.robotsOwner ?? false,
          unsafeLinkPatterns: cmd.unsafePatterns ?? entry?.settings.unsafeLinkPatterns ?? [],
        };
        await store.touch(cmd.url as string, { settings });
        out(
          t("session.robotsSet", {
            origin: normalizeOrigin(cmd.url as string),
            owner: settings.robotsOwner ? "yes" : "no",
            patterns: settings.unsafeLinkPatterns.length > 0 ? t("session.patternsSet", { patterns: settings.unsafeLinkPatterns.join(", ") }) : "",
          }),
        );
        return EXIT.ok;
      }
      case "http-auth": {
        let input: z.infer<typeof HttpAuthInput>;
        if (cmd.stdin) {
          const parsed = HttpAuthInput.safeParse(JSON.parse(await readAll(process.stdin)));
          if (!parsed.success) throw new UsageError(t("session.stdinShape"));
          input = parsed.data;
        } else {
          out(t("session.httpIntro", { origin: normalizeOrigin(cmd.url as string) }));
          input = HttpAuthInput.parse({ username: await ask(t("session.username"), false), password: await ask(t("session.password"), true) });
        }
        await store.put(cmd.url as string, { httpCredentials: input });
        out(t("session.httpSaved", { origin: normalizeOrigin(cmd.url as string), username: input.username }));
        return EXIT.ok;
      }
      case "waf-token": {
        const current = await store.get(cmd.url as string).catch(() => null);
        const token = current?.wafToken !== undefined && !cmd.rotate ? current.wafToken : randomBytes(32).toString("base64url");
        await store.put(cmd.url as string, { wafToken: token });
        const origin = normalizeOrigin(cmd.url as string);
        if (cmd.json) {
          io.stdout.write(`${JSON.stringify({ origin, header: "X-Exegezis-Token", token })}\n`);
          return EXIT.ok;
        }
        out(t("session.wafIntro", { origin }));
        out();
        out(`  ${token}`);
        out();
        out("Cloudflare: Security → WAF → Custom rules → Create rule");
        out(t("session.wafExpression", { expression: `(http.request.headers["x-exegezis-token"][0] eq "${token}")` }));
        out(t("session.wafAction"));
        out(t("session.wafVercel"));
        out(t("session.wafSecret", { origin }));
        return EXIT.ok;
      }
      case "login": {
        const url = cmd.url as string;
        const origin = normalizeOrigin(url);
        const existing = await store.get(origin).catch(() => null);
        out(t("session.loginOpen", { url }));
        out(t("session.loginStep1"));
        out(t("session.loginStep1b"));
        out(cmd.doneFile === undefined ? t("session.loginStep2Enter") : t("session.loginStep2Done"));
        out();
        const result = await captureAccess({
          url,
          exegezisVersion,
          browserChannel: cmd.browserChannel,
          existing: existing === null ? null : { origin, ...(existing.httpCredentials === undefined ? {} : { httpCredentials: existing.httpCredentials }) },
          person: () => waitForDone(cmd.doneFile),
        });
        if (!result.ok) {
          out(t("session.notSaved", { reason: loginReason(result) }));
          out(t("session.notSavedHelp"));
          return EXIT.expectationFailed;
        }
        const entry = await store.put(origin, { storageState: result.storageState });
        out(t("session.saved", { kinds: entry.kinds.map(kindName).join(", "), origin, until: entry.expiresAt === null ? "" : t("session.until", { date: entry.expiresAt.slice(0, 10) }) }));
        out(t("session.savedHelp"));
        return EXIT.ok;
      }
    }
  } catch (error) {
    if (error instanceof KeystoreUnavailableError || error instanceof AccessUnreadableError) {
      io.stderr.write(`${t("session.unreadable", { message: error.message })}\n`);
      return EXIT.engineError;
    }
    throw error;
  }
}
