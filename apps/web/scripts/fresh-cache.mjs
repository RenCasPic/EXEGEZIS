// Clears a Next build folder when the app's structure changed since it was built
// (routes added, moved or removed, root layouts, workspace packages): Turbopack's
// persistent cache does not always notice those, and then serves 404s or «Can't
// resolve» errors that only go away by deleting the folder.
//
//   node apps/web/scripts/fresh-cache.mjs [distDir]      (default: .next; relative to apps/web)
//
// The fingerprint is the list of files under src/app plus pnpm-lock.yaml; it is kept
// in <distDir>/.exegezis-fingerprint. Same fingerprint: nothing is touched.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const WEB = join(import.meta.dirname, "..");
const REPO = join(WEB, "..", "..");

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else out.push(relative(WEB, path).split("\\").join("/"));
  }
  return out;
}

export function fingerprint() {
  const hash = createHash("sha256");
  for (const f of files(join(WEB, "src", "app")).sort()) hash.update(`${f}\n`);
  const lock = join(REPO, "pnpm-lock.yaml");
  if (existsSync(lock)) hash.update(readFileSync(lock));
  return hash.digest("hex");
}

/** Deletes `distDir` (relative to apps/web) when the fingerprint changed; true when it did. */
export function ensureFreshCache(distDir = ".next") {
  const dir = join(WEB, distDir);
  const marker = join(dir, ".exegezis-fingerprint");
  const now = fingerprint();
  const before = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
  if (before === now) return false;
  const stale = existsSync(dir);
  if (stale) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(marker, `${now}\n`);
  return stale;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dist = process.argv[2] ?? process.env.EXEGEZIS_NEXT_DIST ?? ".next";
  if (ensureFreshCache(dist)) console.log(`apps/web/${dist}: the app's structure changed since the last build; its cache was cleared.`);
}
