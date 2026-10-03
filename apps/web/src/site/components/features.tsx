import { siteT, type SiteLocale } from "../i18n";
import { CheckIcon, Section, SectionHeading } from "./ui";

const TOOLS = ["inspect", "search", "verify", "private"] as const;

/** What it does: four tools in a 2 × 2 grid, each with its text and three points. */
export function Features({ locale }: { locale: SiteLocale }) {
  const t = siteT(locale, "features");
  return (
    <Section id="product" labelledBy="product-title" gap={48}>
      <SectionHeading id="product-title" eyebrow={t("eyebrow")} title={t("title")} />
      <ul className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {TOOLS.map((key, i) => (
          <li key={key} className="panel-frame flex flex-col gap-[14px] rounded-2xl bg-panel p-6 md:p-8">
            <span className="font-mono text-[13px] text-accent-text">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="text-[24px] font-semibold text-heading md:text-[26px]">{t(`${key}.title`)}</h3>
            <p className="text-[16px] leading-[1.55] text-muted">{t(`${key}.text`)}</p>
            <ul className="mt-1 flex flex-col gap-2">
              {(["p1", "p2", "p3"] as const).map((p) => (
                <li key={p} className="flex gap-2.5 text-[15px] text-heading">
                  <CheckIcon className="mt-px size-[18px] text-accent" />
                  {t(`${key}.${p}`)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}
