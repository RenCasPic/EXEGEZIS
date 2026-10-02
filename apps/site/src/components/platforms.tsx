import { useTranslations } from "next-intl";
import { Section, SectionHeading } from "./ui";

const PLATFORMS = [
  ["web", true],
  ["apis", false],
  ["mobile", false],
  ["plugins", false],
  ["desktop", false],
] as const;

/** Platforms: the web today (blue outline, «Available»); the rest, coming soon (dashed outline). */
export function Platforms() {
  const t = useTranslations("platforms");
  return (
    <Section labelledBy="platforms-title">
      <SectionHeading id="platforms-title" eyebrow={t("eyebrow")} title={t("title")} />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {PLATFORMS.map(([key, available]) => (
          <li key={key} className={`flex flex-col gap-2.5 rounded-[14px] border-[1.5px] bg-panel p-[22px] ${available ? "border-panel-border" : "border-dashed border-line-strong"}`}>
            <h3 className="text-[18px] font-semibold text-heading">{t(`${key}.name`)}</h3>
            <p className="text-[14px] leading-[1.45] text-muted">{t(`${key}.detail`)}</p>
            <span className={`mt-auto self-start rounded-full px-2.5 py-1 text-[12px] font-semibold ${available ? "bg-accent text-on-accent" : "bg-q-bg text-q"}`}>{available ? t("available") : t("soon")}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
