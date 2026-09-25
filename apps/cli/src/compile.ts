import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileToPlaywright, type CompiledSpec } from "@exegezis/compiler-playwright";
import { EXIT } from "./args.js";
import { absolute, createAdapter, displayPath, loadTestPlan, printer, specRuntime, type CliIo, type LoadedPlan } from "./shared.js";

export interface CompileCommandOptions {
  planFile: string;
  output: string;
  exegezisVersion: string;
}

/** Compiles a loaded plan and writes `<dir>/<id>.spec.ts`. */
export async function writeCompiledSpec(
  loaded: LoadedPlan,
  dir: string,
  exegezisVersion: string,
): Promise<{ spec: CompiledSpec; path: string }> {
  const spec = compileToPlaywright(loaded.plan, {
    exegezisVersion,
    planHash: loaded.hash,
    planPath: loaded.path,
    runtime: specRuntime(createAdapter(false)),
  });
  await mkdir(dir, { recursive: true });
  const path = join(dir, spec.fileName);
  await writeFile(path, spec.source, "utf8");
  return { spec, path };
}

/** `exegezis compile`: plan -> standalone Playwright spec. */
export async function compileCommand(options: CompileCommandOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const loaded = await loadTestPlan(io, options.planFile);
  const { spec, path } = await writeCompiledSpec(loaded, absolute(io, options.output), options.exegezisVersion);

  out("EXEGEZIS");
  out();
  out(`Compiled ${loaded.plan.id} (${loaded.plan.steps.length} steps) to:`);
  out(displayPath(io, path, false));
  out();
  out("Run it with Playwright (EXEGEZIS is not required):");
  out(`  npx playwright test ${spec.fileName}`);
  return EXIT.ok;
}
