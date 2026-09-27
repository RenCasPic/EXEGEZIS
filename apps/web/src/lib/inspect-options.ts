import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { StartInspectionInput } from "./jobs";
import { BROWSER_CHANNEL_IDS, INSPECT_CHECKS, INSPECT_DEFAULTS } from "./inspect-checks";
import { ui, type UiMessage } from "./ui-message";
import { repoRoot } from "./workspace";

export { INSPECT_CHECKS, INSPECT_DEFAULTS };

const optionalInt = (min: number, max: number, key: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: key, params: { min, max } });
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
        ctx.addIssue({ code: "custom", message: "common.errors.urlInvalid" });
        return z.NEVER;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        ctx.addIssue({ code: "custom", message: "common.errors.urlProtocol" });
        return z.NEVER;
      }
      return u.toString();
    }),
  runs: optionalInt(1, 20, "common.errors.runsRange"),
  maxPages: optionalInt(1, 500, "common.errors.pagesRange"),
  maxDepth: optionalInt(0, 10, "common.errors.depthRange"),
  checks: z.array(z.enum(INSPECT_CHECKS.map((c) => c.id))),
  storageState: z.string().trim(),
  strictReadonly: z.boolean(),
  ignoreRobots: z.boolean(),
  browserChannel: z.enum(BROWSER_CHANNEL_IDS),
  noSession: z.boolean(),
});

export type InspectFormResult = { ok: true; input: StartInspectionInput } | { ok: false; error: UiMessage };

export function parseInspectForm(raw: Record<keyof z.input<typeof InspectForm>, unknown>): InspectFormResult {
  const parsed = InspectForm.safeParse(raw);
  if (!parsed.success) {
    // The first problem, as a catalog key: our own issues carry the key; Zod's own (a wrong enum value) is an invalid option.
    const issue = parsed.error.issues[0];
    const key = issue?.code === "custom" && issue.message.startsWith("common.errors.") ? issue.message : issue?.path[0] === "checks" ? "common.errors.checksInvalid" : "common.errors.invalidOption";
    const params = issue?.code === "custom" ? ((issue as { params?: Record<string, number> }).params ?? undefined) : undefined;
    return { ok: false, error: ui(key, params) };
  }
  const v = parsed.data;
  let storageState: string | null = null;
  if (v.storageState !== "") {
    storageState = isAbsolute(v.storageState) ? v.storageState : resolve(repoRoot(), v.storageState);
    if (!existsSync(storageState)) return { ok: false, error: ui("common.errors.storageStateMissing", { path: v.storageState }) };
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
      browserChannel: v.browserChannel,
      noSession: v.noSession,
    },
  };
}
