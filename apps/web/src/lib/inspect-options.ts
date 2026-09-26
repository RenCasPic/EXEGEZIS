import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { StartInspectionInput } from "./jobs";
import { INSPECT_CHECKS, INSPECT_DEFAULTS } from "./inspect-checks";
import { repoRoot } from "./workspace";

export { INSPECT_CHECKS, INSPECT_DEFAULTS };

const optionalInt = (min: number, max: number, name: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${name}: un entero entre ${min} y ${max}.` });
        return z.NEVER;
      }
      return n;
    });

/** Same limits as the CLI (apps/cli/src/args.ts), in the form's language. */
export const InspectForm = z.strictObject({
  url: z
    .string()
    .trim()
    .transform((v, ctx) => {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "Escribe una URL completa, con http:// o https://." });
        return z.NEVER;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        ctx.addIssue({ code: "custom", message: "Solo se pueden inspeccionar URLs http(s)." });
        return z.NEVER;
      }
      return u.toString();
    }),
  runs: optionalInt(1, 20, "Repeticiones"),
  maxPages: optionalInt(1, 500, "Páginas"),
  maxDepth: optionalInt(0, 10, "Profundidad"),
  checks: z.array(z.enum(INSPECT_CHECKS.map((c) => c.id))),
  storageState: z.string().trim(),
  strictReadonly: z.boolean(),
  ignoreRobots: z.boolean(),
});

export type InspectFormResult = { ok: true; input: StartInspectionInput } | { ok: false; error: string };

export function parseInspectForm(raw: Record<keyof z.input<typeof InspectForm>, unknown>): InspectFormResult {
  const parsed = InspectForm.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
  const v = parsed.data;
  let storageState: string | null = null;
  if (v.storageState !== "") {
    storageState = isAbsolute(v.storageState) ? v.storageState : resolve(repoRoot(), v.storageState);
    if (!existsSync(storageState)) return { ok: false, error: `No existe el archivo storageState: ${v.storageState}` };
  }
  return {
    ok: true,
    input: {
      url: v.url,
      runs: v.runs ?? INSPECT_DEFAULTS.runs,
      maxPages: v.maxPages,
      maxDepth: v.maxDepth,
      // Every check selected is the same as no selection: the CLI runs them all.
      checks: v.checks.length === 0 || v.checks.length === INSPECT_CHECKS.length ? null : v.checks,
      storageState,
      strictReadonly: v.strictReadonly,
      ignoreRobots: v.ignoreRobots,
    },
  };
}
