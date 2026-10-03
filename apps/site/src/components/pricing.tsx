"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { linksFor } from "@content/links";
import { annualMonthly, annualTotal, PLANS, type Plan } from "@content/pricing";
import { CheckIcon, Section, SectionHeading, SoonBadge } from "./ui";

type Billing = "monthly" | "annual";

/** What EXEGEZIS does not do yet: an empty dashed circle, never the check of what is available. */
function SoonIcon() {
  return <span className="mt-[3px] size-[14px] shrink-0 rounded-full border-[1.5px] border-dashed border-line-strong" aria-hidden />;
}

function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  const t = useTranslations("pricing");
  const locale = useLocale() === "es" ? "es" : "en";
  const monthly = plan.monthly;
  const shown = monthly === null ? null : billing === "annual" && monthly > 0 ? annualMonthly(monthly) : monthly;
  const note = monthly === null ? t("annualContract") : monthly === 0 ? t("forever") : billing === "annual" ? t("billedAnnually", { amount: String(annualTotal(monthly)) }) : t("billedMonthly");
  return (
    <li
      aria-labelledby={`plan-${plan.id}`}
      className={`flex flex-col gap-[14px] rounded-[18px] border-solid border-panel-border bg-panel p-6 md:p-7 ${
        plan.highlighted ? "border-[2.5px] shadow-[0_18px_40px_rgba(0,102,255,0.18)]" : "border-[1.5px] shadow-[var(--panel-shadow)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`plan-${plan.id}`} className="text-[22px] font-semibold text-heading">
          {t(`plans.${plan.id}.name`)}
        </h3>
        {plan.highlighted && <span className="rounded-full bg-accent px-2.5 py-1 text-[12px] font-semibold text-on-accent">{t("mostChosen")}</span>}
      </div>
      <p className="min-h-[42px] text-[14px] leading-[1.5] text-muted">{t(`plans.${plan.id}.tagline`)}</p>
      <p className="flex items-baseline gap-1.5">
        <span className="text-[44px] font-semibold tracking-[-0.02em] text-heading">{shown === null ? t("custom") : t("price", { amount: String(shown) })}</span>
        {monthly !== null && monthly > 0 && <span className="text-[14px] text-muted">{t("perMonth")}</span>}
      </p>
      <p className="min-h-[18px] text-[13px] text-muted">{note}</p>
      <a
        href={linksFor(locale)[plan.cta]}
        className={`flex items-center justify-center rounded-[10px] text-[15px] font-semibold hover:no-underline ${
          plan.highlighted ? "h-[46px] bg-accent text-on-accent hover:bg-accent-hover" : "h-[49px] border-[1.5px] border-panel-border bg-panel text-accent-text hover:bg-hover"
        }`}
      >
        {t(`plans.${plan.id}.cta`)}
      </a>
      {!plan.purchasable && <p className="-mt-1.5 text-center text-[12px] text-muted">{t("paymentsSoon")}</p>}
      <ul className="mt-1.5 flex flex-col gap-2.5 border-t border-line pt-[18px]">
        {plan.features.map((f) => (
          <li key={f.id} className={`flex gap-2.5 text-[14px] leading-[1.4] ${f.available ? "text-heading" : "text-muted"}`} data-available={f.available}>
            {f.available ? <CheckIcon className="mt-0.5 size-4 text-accent" /> : <SoonIcon />}
            <span className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              {t(`features.${f.id}` as never, (f.values ?? {}) as never)}
              {!f.available && <SoonBadge>{t("soon")}</SoonBadge>}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Pricing: Monthly / Annual (two months free), four plans from content/pricing.ts. */
export function Pricing() {
  const t = useTranslations("pricing");
  const [billing, setBilling] = useState<Billing>("monthly");
  return (
    <Section id="pricing" labelledBy="pricing-title">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <SectionHeading id="pricing-title" eyebrow={t("eyebrow")} title={t("title")} />
        <div role="radiogroup" aria-label={t("billing")} className="flex shrink-0 gap-1 self-start rounded-xl border-[1.5px] border-panel-border bg-panel p-1 md:self-auto">
          {(["monthly", "annual"] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={billing === b}
              onClick={() => setBilling(b)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const next = billing === "monthly" ? "annual" : "monthly";
                  setBilling(next);
                  (e.currentTarget.parentElement?.querySelector(`[data-billing="${next}"]`) as HTMLButtonElement | null)?.focus();
                }
              }}
              tabIndex={billing === b ? 0 : -1}
              data-billing={b}
              className={`h-[38px] rounded-[9px] px-4 text-[14px] font-medium whitespace-nowrap ${billing === b ? "bg-accent text-on-accent" : "text-muted hover:text-heading"}`}
            >
              {t(b)}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} billing={billing} />
        ))}
      </ul>
      <p className="text-[14px] text-muted">{t("note")}</p>
    </Section>
  );
}
