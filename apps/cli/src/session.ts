import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { AccessStore, AccessUnreadableError, KeystoreUnavailableError, normalizeOrigin, type AccessEntry } from "@exegezis/access";
import type { AdapterAccess } from "@exegezis/adapter-browser";
import { captureAccess } from "@exegezis/inspect";
import { z } from "zod";
import { EXIT, UsageError, type SessionCommand } from "./args.js";
import { printer, type CliIo } from "./shared.js";

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
      return { access: null, entry, warning: `${error.message} Inspecting as an anonymous visitor.` };
    }
    throw error;
  }
}

function status(entry: AccessEntry, now = Date.now()): string {
  if (entry.expired) return "expired (a login wall came back): run session login again";
  if (entry.expiresAt !== null && Date.parse(entry.expiresAt) < now) return `expired on ${entry.expiresAt.slice(0, 10)}`;
  return entry.expiresAt === null ? "active" : `active until about ${entry.expiresAt.slice(0, 10)}`;
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
        out(`Saved access (${store.dir})`);
        out("Only this user on this computer can open them. On another computer or user, sign in again.");
        out();
        if (entries.length === 0) out("None yet. Save one with: pnpm exegezis session login --url https://your-site/");
        for (const e of entries) {
          out(`  ${e.origin}`);
          out(`    ${e.kinds.length === 0 ? "no saved access" : e.kinds.join(", ")} · ${e.kinds.includes("session") ? status(e) : "—"} · last used ${e.lastUsedAt?.slice(0, 16).replace("T", " ") ?? "never"}`);
          if (e.settings.robotsOwner) out("    this site is yours: robots.txt exclusions are inspected too");
          if (e.settings.unsafeLinkPatterns.length > 0) out(`    never visited: ${e.settings.unsafeLinkPatterns.join(", ")}`);
        }
        return EXIT.ok;
      }
      case "delete": {
        const removed = await store.delete(cmd.url as string);
        out(removed ? `Forgot the saved access of ${normalizeOrigin(cmd.url as string)}.` : `Nothing was saved for ${normalizeOrigin(cmd.url as string)}.`);
        return EXIT.ok;
      }
      case "set": {
        if (cmd.robotsOwner === undefined && cmd.unsafePatterns === undefined) throw new UsageError('Nothing to set: use --robots-owner yes|no or --unsafe-pattern "<text>".');
        const entry = await store.entry(cmd.url as string);
        const settings = {
          robotsOwner: cmd.robotsOwner ?? entry?.settings.robotsOwner ?? false,
          unsafeLinkPatterns: cmd.unsafePatterns ?? entry?.settings.unsafeLinkPatterns ?? [],
        };
        await store.touch(cmd.url as string, { settings });
        out(`${normalizeOrigin(cmd.url as string)}: robots.txt exclusions ${settings.robotsOwner ? "are inspected too (your site)" : "are respected"}${settings.unsafeLinkPatterns.length > 0 ? `; never visited: ${settings.unsafeLinkPatterns.join(", ")}` : ""}.`);
        return EXIT.ok;
      }
      case "http-auth": {
        let input: z.infer<typeof HttpAuthInput>;
        if (cmd.stdin) {
          const parsed = HttpAuthInput.safeParse(JSON.parse(await readAll(process.stdin)));
          if (!parsed.success) throw new UsageError('--stdin expects {"username":"…","password":"…"}.');
          input = parsed.data;
        } else {
          out(`HTTP authentication for ${normalizeOrigin(cmd.url as string)} (the password is not shown while you type and is saved encrypted).`);
          input = HttpAuthInput.parse({ username: await ask("Username: ", false), password: await ask("Password: ", true) });
        }
        await store.put(cmd.url as string, { httpCredentials: input });
        out(`Saved. Inspections of ${normalizeOrigin(cmd.url as string)} will authenticate as ${input.username}.`);
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
        out(`WAF token for ${origin} (only for a site that is yours). EXEGEZIS sends it as the header X-Exegezis-Token, only to this site.`);
        out();
        out(`  ${token}`);
        out();
        out("Cloudflare: Security → WAF → Custom rules → Create rule");
        out(`  Expression:  (http.request.headers["x-exegezis-token"][0] eq "${token}")`);
        out("  Action:      Skip — Bot Fight Mode / Super Bot Fight Mode, Managed Challenge, Rate limiting rules");
        out("Vercel: Firewall → Custom rules, the same condition on the header, action Bypass.");
        out("Keep it secret like a password. To replace it: pnpm exegezis session waf-token --url " + origin + " --rotate");
        return EXIT.ok;
      }
      case "login": {
        const url = cmd.url as string;
        const origin = normalizeOrigin(url);
        const existing = await store.get(origin).catch(() => null);
        out(`A browser window will open on ${url}.`);
        out("1. Sign in, pass the verification, or choose in the cookie banner (the most private option is fine).");
        out("   EXEGEZIS does not type, read or keep your password: only the final browser state (cookies of this site).");
        out(`2. When you see the page you wanted, ${cmd.doneFile === undefined ? "come back here and press Enter" : 'press "Listo" in EXEGEZIS'} (or close the window).`);
        out();
        const result = await captureAccess({
          url,
          exegezisVersion,
          browserChannel: cmd.browserChannel,
          existing: existing === null ? null : { origin, ...(existing.httpCredentials === undefined ? {} : { httpCredentials: existing.httpCredentials }) },
          person: () => waitForDone(cmd.doneFile),
        });
        if (!result.ok) {
          out(`Not saved: ${result.reason}`);
          out("Nothing was stored. Try again and finish the sign-in or the verification before pressing Enter.");
          return EXIT.expectationFailed;
        }
        const entry = await store.put(origin, { storageState: result.storageState });
        out(`Saved: ${entry.kinds.join(", ")} for ${origin}${entry.expiresAt === null ? "" : `, valid until about ${entry.expiresAt.slice(0, 10)}`}.`);
        out("Inspections of this site will use it automatically (--no-session to inspect as an anonymous visitor).");
        return EXIT.ok;
      }
    }
  } catch (error) {
    if (error instanceof KeystoreUnavailableError || error instanceof AccessUnreadableError) {
      io.stderr.write(`${error.message}\n`);
      return EXIT.engineError;
    }
    throw error;
  }
}
