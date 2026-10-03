// Before `pnpm web`: the app always has accounts (Supabase), so .env must say where they are.
// Variables already set in this terminal win over .env, as in the app (apps/web/next.config.ts).
//
//   node scripts/check-env.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const REPO = join(import.meta.dirname, "..");
const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DATABASE_URL", "EXEGEZIS_APP_URL"];

const file = join(REPO, ".env");
const env = { ...(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}), ...process.env };
const missing = REQUIRED.filter((k) => (env[k] ?? "").trim() === "");
if (missing.length > 0) {
  console.error(
    [
      `.env is missing: ${missing.join(", ")}.`,
      `Falta en .env: ${missing.join(", ")}.`,
      "",
      "The app has accounts (Supabase): copy those lines from .env.example and fill them in (docs/13-accounts.md).",
      "La app tiene cuentas (Supabase): copia esas líneas de .env.example y rellénalas (docs/13-accounts.md).",
      "  notepad .env",
    ].join("\n"),
  );
  process.exit(2);
}
