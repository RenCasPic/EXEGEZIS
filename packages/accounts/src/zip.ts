import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { zipSync, type Zippable } from "fflate";

async function walk(dir: string, out: string[]): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    const s = await stat(path);
    if (s.isDirectory()) await walk(path, out);
    else if (s.isFile()) out.push(path);
  }
}

/** A ZIP with `account.json` and every file under `folders` (each under its name in the ZIP). */
export async function zipAccount(json: unknown, folders: readonly { name: string; path: string }[]): Promise<Uint8Array> {
  const files: Zippable = { "account.json": new TextEncoder().encode(`${JSON.stringify(json, null, 2)}\n`) };
  for (const folder of folders) {
    const found: string[] = [];
    await walk(folder.path, found);
    for (const path of found) files[`${folder.name}/${relative(folder.path, path).split("\\").join("/")}`] = new Uint8Array(await readFile(path));
  }
  return zipSync(files, { level: 6 });
}
