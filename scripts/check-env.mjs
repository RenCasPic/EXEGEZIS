// Before `pnpm web`: the app always has accounts (Supabase), so .env must say which project.
// Variables already set in this terminal win over .env, as in the app (apps/web/next.config.ts).
//
//   node scripts/check-env.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const REPO = join(import.meta.dirname, "..");
// The name to ask for first; older names are still read (packages/accounts/src/config.ts).
const REQUIRED = [
  ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"],
  ["SUPABASE_SERVICE_ROLE_KEY"],
];

const file = join(REPO, ".env");
const env = { ...(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}), ...process.env };
const missing = REQUIRED.filter((names) => names.every((n) => (env[n] ?? "").trim() === "")).map((names) => names[0]);
if (missing.length > 0) {
  console.error(
    [
      `Falta en .env: ${missing.join(", ")}.`,
      `.env is missing: ${missing.join(", ")}.`,
      "",
      "Cópialas de tu proyecto en supabase.com: Project Settings → API Keys (docs/13-accounts.md).",
      "Copy them from your project on supabase.com: Project Settings → API Keys (docs/13-accounts.md).",
      "  notepad .env",
    ].join("\n"),
  );
  process.exit(2);
}
