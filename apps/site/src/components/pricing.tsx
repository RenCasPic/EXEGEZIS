"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LINKS } from "@content/links";
import { annualMonthly, annualTotal, PLANS, type Plan } from "@content/pricing";
import { buttonClass, Container, SectionHeading, SoonBadge } from "./ui";

type Billing = "monthly" | "annual";

function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  const t = useTranslations("pricing");
  const name = t(`plans.${plan.id}.name`);
  const monthly = plan.monthly;
  const shown = monthly === null ? null : billing === "annual" && monthly > 0 ? annualMonthly(monthly) : monthly;
  return (
    <li
      aria-labelledby={`plan-${plan.id}`}
      className={`relative flex flex-col gap-5 rounded-xl bg-panel p-5 ${plan.highlighted ? "border-[3px] border-accent" : "panel-frame"}`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-5 rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-semibold text-on-accent">{t("mostChosen")}</span>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`plan-${plan.id}`} className="text-[18px] font-semibold text-heading">
            {name}
          </h3>
          {!plan.purchasable && <SoonBadge>{t("paymentsSoon")}</SoonBadge>}
        </div>
        <p className="text-[13px] text-muted">{t(`plans.${plan.id}.tagline`)}</p>
      </div>
      <div className="min-h-[4.5rem]">
        {shown === null ? (
          <>
            <p className="text-[32px] leading-none font-semibold tracking-tight text-heading">{t("custom")}</p>
            <p className="mt-2 text-[13px] text-muted">{t("annualContract")}</p>
          </>
        ) : (
          <>
            <p className="flex items-baseline gap-1">
              <span className="font-mono text-[36px] leading-none font-semibold tracking-tight text-heading">{t("price", { amount: String(shown) })}</span>
              <span className="text-[14px] text-muted">{monthly === 0 ? t("forever") : t("perMonth")}</span>
            </p>
            {billing === "annual" && monthly !== null && monthly > 0 && (
              <p className="mt-2 font-mono text-[13px] text-muted">{t("billedAnnually", { amount: String(annualTotal(monthly)) })}</p>
            )}
          </>
        )}
      </div>
      <a href={LINKS[plan.cta]} className={`${buttonClass(plan.highlighted ? "primary" : "outline")} w-full`}>
        {t(`plans.${plan.id}.cta`)}
      </a>
      <ul className="flex flex-col gap-2.5 border-t border-line pt-4 text-[14px]">
        {plan.features.map((f) => (
          <li key={f.id} className={`flex items-start gap-2 ${f.available ? "text-heading" : "text-muted"}`} data-available={f.available}>
            {f.available ? (
              <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
            ) : (
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden />
            )}
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
    <section id="pricing" aria-labelledby="pricing-title" className="py-16 sm:py-24">
      <Container>
        <SectionHeading id="pricing-title" eyebrow={t("eyebrow")} title={t("title")} />
        <div role="radiogroup" aria-label={t("billing")} className="mb-6 inline-flex rounded-lg border border-line-strong bg-panel p-1">
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
              className={`rounded-md px-3 py-1.5 text-[14px] font-medium ${billing === b ? "bg-accent text-on-accent" : "text-heading hover:bg-hover"}`}
            >
              {t(b)}
            </button>
          ))}
        </div>
        <p className="mb-8 max-w-3xl rounded-lg border border-dashed border-line-strong bg-sunken px-4 py-3 text-[14px] text-heading">{t("cloudNotice")}</p>
        <ul className="grid gap-6 pt-3 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} billing={billing} />
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-[13px] text-muted">{t("note")}</p>
      </Container>
    </section>
  );
}
