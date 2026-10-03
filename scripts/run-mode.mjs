// Runs a command in local or cloud mode (docs/13-accounts.md):
//
//   node scripts/run-mode.mjs local <command…>    EXEGEZIS_MODE=local, whatever .env says
//   node scripts/run-mode.mjs cloud <command…>    the variables of .env.cloud, EXEGEZIS_MODE=cloud
//
// `pnpm web` and `pnpm verify` are always local; only `pnpm web:cloud` and
// `pnpm exegezis:cloud` read .env.cloud. Variables already set in this
// terminal win over .env.cloud; .env (read by the CLI and the app) never
// overrides either.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const REPO = join(import.meta.dirname, "..");
const [mode, ...command] = process.argv.slice(2);
if ((mode !== "local" && mode !== "cloud") || command.length === 0) {
  console.error("usage: node scripts/run-mode.mjs local|cloud <command…>");
  process.exit(2);
}

const env = { ...process.env, EXEGEZIS_MODE: mode };
if (mode === "cloud") {
  const file = join(REPO, ".env.cloud");
  if (!existsSync(file)) {
    console.error("Cloud mode reads .env.cloud, which does not exist yet. Create it from the example and fill it in (docs/13-accounts.md):\n  copy .env.cloud.example .env.cloud\n  notepad .env.cloud");
    process.exit(2);
  }
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) if (process.env[k] === undefined) env[k] = v;
  env.EXEGEZIS_MODE = "cloud";
  const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DATABASE_URL", "EXEGEZIS_APP_URL"].filter((k) => (env[k] ?? "").trim() === "");
  if (missing.length > 0) {
    console.error(`.env.cloud is missing: ${missing.join(", ")} (see .env.cloud.example).`);
    process.exit(2);
  }
}

const child = spawn(command.join(" "), { cwd: process.cwd(), env, stdio: "inherit", shell: true });
child.on("exit", (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)));
