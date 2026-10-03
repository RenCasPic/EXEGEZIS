"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CLOUD, LOCAL_APP_URL, linksFor } from "@content/links";
import { LIME_BUTTON } from "./ui";

interface Session {
  signedIn: boolean;
  name?: string;
}

function initials(name: string): string {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "·";
}

/**
 * «Sign in · Start for free», or — cloud mode, with a session in the app —
 * «Go to the app» and the visitor's initials. The site is static: it asks the
 * app (/api/session, readable only from this site) after loading.
 */
export function HeaderActions({ locale, menu = false }: { locale: "en" | "es"; menu?: boolean }) {
  const t = useTranslations("nav");
  const links = linksFor(locale);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!CLOUD) return;
    const controller = new AbortController();
    fetch(`${LOCAL_APP_URL}/api/session`, { credentials: "include", signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Session>) : null))
      .then((s) => setSession(s))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (session?.signedIn === true) {
    const name = session.name ?? "";
    return menu ? (
      <a href={links.app} className={`${LIME_BUTTON} mt-1 h-10 rounded-[10px] px-[18px] text-[15px] font-semibold`}>
        {t("goToApp")}
      </a>
    ) : (
      <>
        <a href={links.app} className={`${LIME_BUTTON} h-10 rounded-[10px] px-[18px] text-[15px] font-semibold max-sm:hidden`} data-go-to-app>
          {t("goToApp")}
        </a>
        <a href={links.app} aria-label={t("account", { name })} title={name} className="grid size-10 place-items-center rounded-full border-[1.5px] border-panel-border font-mono text-[13px] font-semibold text-heading">
          {initials(name)}
        </a>
      </>
    );
  }

  return menu ? (
    <>
      <a href={links.signIn} className="rounded-md px-3 py-2 text-[15px] text-heading hover:bg-hover">
        {t("signIn")}
      </a>
      <a href={links.start} className={`${LIME_BUTTON} mt-1 h-10 rounded-[10px] px-[18px] text-[15px] font-semibold`}>
        {t("start")}
      </a>
    </>
  ) : (
    <>
      <a href={links.signIn} className="hidden text-[15px] font-medium text-heading hover:underline md:inline">
        {t("signIn")}
      </a>
      <a href={links.start} className={`${LIME_BUTTON} h-10 rounded-[10px] px-[18px] text-[15px] font-semibold max-sm:hidden`}>
        {t("start")}
      </a>
    </>
  );
}
