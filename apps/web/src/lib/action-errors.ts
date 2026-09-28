import { getTranslations } from "next-intl/server";
import { CliNotBuiltError } from "./jobs";
import { translateUi, ui, type UiMessage } from "./ui-message";

/** A UiMessage in the request's language (server actions). */
export async function say(m: UiMessage): Promise<string> {
  const t = await getTranslations();
  return translateUi(t, m);
}

/** An error thrown while starting a job, in the request's language. */
export async function errorText(error: unknown): Promise<string> {
  if (error instanceof CliNotBuiltError) return say(ui("common.errors.cliNotBuilt"));
  return say(ui("common.errors.unexpected", { detail: error instanceof Error ? error.message : String(error) }));
}
