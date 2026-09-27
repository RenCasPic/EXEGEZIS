import { IntlMessageFormat } from "intl-messageformat";
import { z } from "zod";
import { ENGINE_MESSAGES_EN, ENGINE_MESSAGES_ES } from "./messages-catalog.js";

/*
 * Engine messages (docs/11-i18n.md). What the engine explains — a reason, a
 * criterion's detail, a block, an error — is recorded as a code and its
 * parameters, so every reader sees it in their language. The English text is
 * still written next to it (for logs and for readers of older versions). A
 * parameter can itself be a message, or a list of messages (joined with «; »).
 */

export type MessageParam = string | number | EngineMessage | EngineMessage[];
export interface EngineMessage {
  code: string;
  params: Record<string, MessageParam>;
}

export const EngineMessage: z.ZodType<EngineMessage> = z.lazy(() =>
  z.strictObject({
    code: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
    params: z.record(z.string(), z.union([z.string(), z.number(), EngineMessage, z.array(EngineMessage)])),
  }),
);

export type EngineCode = keyof typeof ENGINE_MESSAGES_EN;
export type EngineLocale = "en" | "es";

export const ENGINE_MESSAGES: Record<EngineLocale, Record<string, string>> = { en: ENGINE_MESSAGES_EN, es: ENGINE_MESSAGES_ES };

export function msg(code: EngineCode, params: Record<string, MessageParam> = {}): EngineMessage {
  return { code, params };
}

const cache = new Map<string, IntlMessageFormat>();

/** The message in a language; nested messages first, lists joined with «; ». Unknown codes fall back to the code. */
export function formatEngineMessage(m: EngineMessage, locale: EngineLocale = "en"): string {
  const template = ENGINE_MESSAGES[locale][m.code] ?? ENGINE_MESSAGES.en[m.code];
  if (template === undefined) return m.code;
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m.params)) {
    values[k] = typeof v === "string" || typeof v === "number" ? v : Array.isArray(v) ? v.map((x) => formatEngineMessage(x, locale)).join("; ") : formatEngineMessage(v, locale);
  }
  const key = `${locale}\u0000${m.code}`;
  let format = cache.get(key);
  if (format === undefined) {
    format = new IntlMessageFormat(template, locale);
    cache.set(key, format);
  }
  return String(format.format(values));
}

/** English text for the fields older readers use (reason, detail, message). */
export function englishOf(m: EngineMessage): string {
  return formatEngineMessage(m, "en");
}
export { ENGINE_MESSAGES_EN, ENGINE_MESSAGES_ES } from "./messages-catalog.js";
