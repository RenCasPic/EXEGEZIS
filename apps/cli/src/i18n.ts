import { formatEngineMessage, type EngineMessage } from "@exegezis/core";
import { IntlMessageFormat } from "intl-messageformat";
import { CLI_MESSAGES_EN, CLI_MESSAGES_ES, type CliKey } from "./messages-catalog.js";

/*
 * The CLI's language (docs/11-i18n.md): `--lang en|es`, else EXEGEZIS_LANG,
 * else the system's language, else English. Chosen once per invocation,
 * before the arguments are parsed, so help and usage errors are translated too.
 */

export type CliLocale = "en" | "es";
export const CLI_LOCALES: readonly CliLocale[] = ["en", "es"];

let current: CliLocale = "en";

export function cliLocale(): CliLocale {
  return current;
}

export function setCliLocale(locale: CliLocale): void {
  current = locale;
}

/** "es", "es-MX", "es_ES.UTF-8" → "es"; anything else we do not speak → null. */
export function localeOf(value: string | undefined | null): CliLocale | null {
  if (value === undefined || value === null) return null;
  const base = value.trim().toLowerCase().split(/[-_.@]/)[0];
  return base === "en" || base === "es" ? base : null;
}

/** The system's language: LC_ALL / LC_MESSAGES / LANG (POSIX), then the ICU default (Windows). */
export function systemLocale(env: NodeJS.ProcessEnv = process.env): CliLocale | null {
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const l = localeOf(env[name]);
    if (l !== null) return l;
  }
  try {
    return localeOf(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

export class LangError extends Error {
  override readonly name = "LangError";
}

/**
 * Takes `--lang <en|es>` / `--lang=<en|es>` out of argv (it is valid before or
 * after the command) and resolves the language. An unknown --lang is an error;
 * an unknown EXEGEZIS_LANG falls back to the system.
 */
export function resolveCliLocale(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): { locale: CliLocale; argv: string[]; invalid: string | null } {
  const rest: string[] = [];
  let flag: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--lang") {
      flag = argv[i + 1] ?? "";
      i++;
    } else if (a.startsWith("--lang=")) flag = a.slice("--lang=".length);
    else rest.push(a);
  }
  if (flag !== null) {
    const l = flag === "en" || flag === "es" ? flag : null;
    if (l !== null) return { locale: l, argv: rest, invalid: null };
    return { locale: localeOf(env["EXEGEZIS_LANG"]) ?? systemLocale(env) ?? "en", argv: rest, invalid: flag };
  }
  return { locale: localeOf(env["EXEGEZIS_LANG"]) ?? systemLocale(env) ?? "en", argv: rest, invalid: null };
}

const cache = new Map<string, IntlMessageFormat>();

/** A CLI message in the current language (placeholders filled; plurals by ICU). */
export function t(key: CliKey, params: Record<string, string | number> = {}): string {
  const locale = cliLocale();
  const template = (locale === "es" ? CLI_MESSAGES_ES : CLI_MESSAGES_EN)[key];
  const id = `${locale}\u0000${key}`;
  let format = cache.get(id);
  if (format === undefined) {
    // CLI texts are plain text: <file>, <id>… are placeholders for the reader, not tags.
    format = new IntlMessageFormat(template, locale, undefined, { ignoreTag: true });
    cache.set(id, format);
  }
  return String(format.format(params));
}

/** An engine message (a code and its parameters) in the current language; the recorded English text when there is no code. */
export function engineText(message: EngineMessage | null | undefined, fallback: string): string {
  return message === null || message === undefined ? fallback : formatEngineMessage(message, cliLocale());
}
