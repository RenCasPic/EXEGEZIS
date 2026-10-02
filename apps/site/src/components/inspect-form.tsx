"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { inspectUrl, LOCAL_APP_URL } from "@content/links";
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

/** Does the local app answer? A no-cors request resolves when something listens, and fails when nothing does. */
async function localAppIsUp(): Promise<boolean> {
  try {
    await fetch(`${LOCAL_APP_URL}/`, {
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

/** The hero field's id: the closing call's «Inspect for free» brings the visitor back to it. */
export const HERO_URL_ID = "hero-url";

/**
 * «Inspect for free». Until the cloud version exists it opens the local app
 * (apps/web) with the address already in the Inspect tab; if the app is not
 * running, it says how to start it.
 */
export function InspectForm() {
  const t = useTranslations("inspect");
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "invalid" | "down">("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const site = normalizeSiteUrl(value);
    if (site === null) {
      setState("invalid");
      return;
    }
    setState("checking");
    if (await localAppIsUp()) window.location.assign(inspectUrl(site));
    else setState("down");
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex w-full max-w-[640px] flex-col gap-3">
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
              if (state === "invalid" || state === "down") setState("idle");
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
      {state === "down" && (
        <div role="alert" className="panel-frame flex gap-3 rounded-xl bg-panel p-4 text-left text-[14px] text-heading">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{t("downTitle")}</p>
            <p className="text-muted">{t("downBody")}</p>
            <ul className="list-disc pl-5 text-muted">
              <li>{t("downCmd")}</li>
              <li>
                {t.rich("downNpm", {
                  code: (chunks) => <code className="font-mono text-heading">{chunks}</code>,
                })}
              </li>
            </ul>
            <p className="text-muted">{t.rich("downWhere", { url: LOCAL_APP_URL })}</p>
          </div>
        </div>
      )}
    </form>
  );
}
