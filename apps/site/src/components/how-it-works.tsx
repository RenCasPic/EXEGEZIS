import { useTranslations } from "next-intl";
import { Section, SectionHeading } from "./ui";

/** How it works: three steps under a 3 px blue rule. */
export function HowItWorks() {
  const t = useTranslations("how");
  return (
    <Section id="how" labelledBy="how-title" gap={48}>
      <SectionHeading id="how-title" eyebrow={t("eyebrow")} title={t("title")} />
      <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {(["step1", "step2", "step3"] as const).map((step, i) => (
          <li key={step} className="flex flex-col gap-[14px] border-t-[3px] border-accent pt-6">
            <span className="font-mono text-[40px] font-medium text-accent" aria-hidden>
              {i + 1}
            </span>
            <h3 className="text-[22px] font-semibold text-heading">{t(`${step}.title`)}</h3>
            <p className="text-[16px] leading-[1.55] text-muted">{t(`${step}.text`)}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
