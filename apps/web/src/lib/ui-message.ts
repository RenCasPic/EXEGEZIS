/*
 * A text the server computes for the UI (a validation error, why a target
 * does not answer): a catalog key and its values, translated where it is
 * shown or by the server action that returns it (docs/11-i18n.md). A value
 * can itself be a message (translated first).
 */

export interface UiMessage {
  key: string;
  values?: Record<string, string | number | UiMessage>;
}

export const ui = (key: string, values?: UiMessage["values"]): UiMessage => (values === undefined ? { key } : { key, values });

export function isUiMessage(v: unknown): v is UiMessage {
  return typeof v === "object" && v !== null && typeof (v as { key?: unknown }).key === "string";
}

/** Any next-intl translator (root namespace), loosely typed: keys come from data. */
type AnyTranslate = (key: never, values?: never) => string;

export function translateUi(t: AnyTranslate, m: UiMessage): string {
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m.values ?? {})) values[k] = typeof v === "object" ? translateUi(t, v) : v;
  return t(m.key as never, values as never);
}
