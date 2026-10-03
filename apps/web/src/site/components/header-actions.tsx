"use client";

import { useEffect, useState } from "react";
import { siteT, type SiteLocale } from "../i18n";
import type { SiteLinks } from "../links";
import { SIGNED_IN_HINT_COOKIE } from "../urls";
import { LIME_BUTTON } from "./ui";

/** The initials the app left in its «signed in» hint cookie (cloud mode), or null. */
function signedInInitials(): string | null {
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${SIGNED_IN_HINT_COOKIE}=`))
    ?.slice(SIGNED_IN_HINT_COOKIE.length + 1);
  if (raw === undefined || raw === "") return null;
  try {
    return decodeURIComponent(raw).slice(0, 3) || "·";
  } catch {
    return "·";
  }
}

/**
 * «Sign in · Start for free», or — cloud mode, signed in — «Go to the app»
 * and the visitor's initials. The page is static: the app leaves a hint
 * cookie (not the session, which stays httpOnly) that is read here; the app
 * checks the session itself when the visitor goes there.
 */
export function HeaderActions({ locale, links, menu = false }: { locale: SiteLocale; links: SiteLinks; menu?: boolean }) {
  const t = siteT(locale, "nav");
  const [initials, setInitials] = useState<string | null>(null);

  useEffect(() => {
    if (links.cloud) setInitials(signedInInitials());
  }, [links.cloud]);

  if (initials !== null) {
    return menu ? (
      <a href={links.app} className={`${LIME_BUTTON} mt-1 h-10 rounded-[10px] px-[18px] text-[15px] font-semibold`}>
        {t("goToApp")}
      </a>
    ) : (
      <>
        <a href={links.app} className={`${LIME_BUTTON} h-10 rounded-[10px] px-[18px] text-[15px] font-semibold max-sm:hidden`} data-go-to-app>
          {t("goToApp")}
        </a>
        <a href={links.app} aria-label={t("account", { name: initials })} className="grid size-10 place-items-center rounded-full border-[1.5px] border-panel-border font-mono text-[13px] font-semibold text-heading">
          {initials}
        </a>
      </>
    );
  }

  return menu ? (
    <>
      <a href={links.signIn} className="rounded-md px-3 py-2 text-[15px] text-heading hover:bg-hover">
        {t(links.cloud ? "signIn" : "openApp")}
      </a>
      <a href={links.start} className={`${LIME_BUTTON} mt-1 h-10 rounded-[10px] px-[18px] text-[15px] font-semibold`}>
        {t("start")}
      </a>
    </>
  ) : (
    <>
      <a href={links.signIn} className="hidden text-[15px] font-medium text-heading hover:underline md:inline">
        {t(links.cloud ? "signIn" : "openApp")}
      </a>
      <a href={links.start} className={`${LIME_BUTTON} h-10 rounded-[10px] px-[18px] text-[15px] font-semibold max-sm:hidden`}>
        {t("start")}
      </a>
    </>
  );
}
