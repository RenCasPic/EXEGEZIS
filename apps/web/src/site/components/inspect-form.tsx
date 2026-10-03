"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { siteT, type SiteLocale } from "../i18n";
import { inspectUrl } from "../urls";
import { GlobeIcon, LIME_BUTTON } from "./ui";

/** An address the person typed, as an http(s) URL (https:// is added when there is no scheme). */
export function normalizeSiteUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const web = url.protocol === "http:" || url.protocol === "https:";
    // A real host: a domain with a dot, an IP address, or localhost (for the person's own app).
    const host = url.hostname.includes(".") || url.hostname === "localhost" || url.hostname.startsWith("[");
    return web && host ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The hero field's id: the closing call's «Inspect for free» brings the visitor back to it. */
export const HERO_URL_ID = "hero-url";

/**
 * «Inspect for free»: the app's Inspect tab with the address filled in, after
 * signing up (a signed-in visitor goes straight there).
 */
export function InspectForm({ locale }: { locale: SiteLocale }) {
  const t = siteT(locale, "inspect");
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "invalid">("idle");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const site = normalizeSiteUrl(value);
    if (site === null) {
      setState("invalid");
      return;
    }
    setState("checking");
    window.location.assign(inspectUrl(site, locale));
  };

  return (
    <form onSubmit={submit} noValidate className="flex w-full max-w-[640px] flex-col gap-3">
      <label htmlFor={HERO_URL_ID} className="sr-only">
        {t("label")}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex h-[58px] min-w-0 shrink-0 items-center sm:flex-1 gap-3 rounded-xl border-[1.5px] border-panel-border bg-panel px-[18px]">
          <GlobeIcon className="size-5 text-muted" />
          <input
            id={HERO_URL_ID}
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (state === "invalid") setState("idle");
            }}
            placeholder={t("placeholder")}
            aria-invalid={state === "invalid"}
            aria-describedby={state === "invalid" ? `${HERO_URL_ID}-error` : undefined}
            className="min-w-0 flex-1 bg-transparent font-mono text-[16px] text-heading placeholder:text-muted"
          />
        </div>
        <button type="submit" disabled={state === "checking"} className={`${LIME_BUTTON} h-[58px] gap-2 rounded-xl px-[26px] text-[16px] font-bold disabled:opacity-70`}>
          {state === "checking" && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {state === "checking" ? t("checking") : t("submit")}
        </button>
      </div>
      {state === "invalid" && (
        <p id={`${HERO_URL_ID}-error`} role="alert" className="text-[14px] text-heading">
          {t("invalid")}
        </p>
      )}
    </form>
  );
}
