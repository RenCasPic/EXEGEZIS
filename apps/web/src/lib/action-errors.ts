import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { CliNotBuiltError } from "./jobs";
import { RefusedError, PlanLimitError } from "./plan-gate";
import { translateUi, ui, type UiMessage } from "./ui-message";

/** A UiMessage in the request's language (server actions). */
export async function say(m: UiMessage): Promise<string> {
  const t = await getTranslations();
  return translateUi(t, m);
}

/** An error thrown while starting a job, in the request's language. */
export async function errorText(error: unknown): Promise<string> {
  if (error instanceof CliNotBuiltError) return say(ui("common.errors.cliNotBuilt"));
  if (error instanceof PlanLimitError) return say(ui(`account.limits.${error.reason}`, typeof error.limit === "number" ? { limit: error.limit } : {}));
  if (error instanceof RefusedError) return say(ui(`account.refused.${error.reason}`));
  return say(ui("common.errors.unexpected", { detail: error instanceof Error ? error.message : String(error) }));
}

/** «See plans» goes with a plan limit (the URL of the landing's pricing). */
export async function plansLinkFor(error: unknown): Promise<{ plansUrl?: string }> {
  if (!(error instanceof PlanLimitError)) return {};
  const [{ siteLinks }, { getUiLocale }] = await Promise.all([import("./links"), import("../i18n/server")]);
  return { plansUrl: siteLinks(await getUiLocale()).plans };
}

/** Actions without a form state (repeat, approve, run a saved search): a refusal opens the account page, which says why. */
export function redirectOnRefusal(error: unknown): void {
  if (error instanceof PlanLimitError) redirect(`/settings/account?limit=${error.reason}#plan`);
  if (error instanceof RefusedError) redirect(`/settings/account?refused=${error.reason}`);
}
