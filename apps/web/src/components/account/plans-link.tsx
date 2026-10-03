"use client";

import { useTranslations } from "next-intl";

/** «See plans», next to a plan limit: the landing's pricing. */
export function PlansLink({ href }: { href: string | undefined }) {
  const t = useTranslations("account.limits");
  if (href === undefined) return null;
  return (
    <a href={href} className="ml-auto shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover" data-see-plans>
      {t("seePlans")}
    </a>
  );
}
