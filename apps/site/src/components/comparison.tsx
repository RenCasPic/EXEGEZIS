import { useTranslations } from "next-intl";
import { Section, SectionHeading } from "./ui";

const ROWS = ["r1", "r2", "r3", "r4", "r5"] as const;
const GRID = "grid grid-cols-[1.2fr_1fr_1fr] items-center gap-x-3 px-4 md:gap-x-0 py-[18px] md:px-8";

/** The difference: a three-column table (aspect · usual tools · EXEGEZIS). */
export function Comparison() {
  const t = useTranslations("diff");
  return (
    <Section labelledBy="diff-title">
      <SectionHeading id="diff-title" eyebrow={t("eyebrow")} title={t("title")} />
      <div className="panel-frame overflow-hidden rounded-2xl bg-panel">
        <table className="block w-full text-left">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="block border-b border-line bg-table-head">
            <tr className={`${GRID} text-[13px] text-muted md:text-[14px] [&>th]:font-semibold`}>
              <th scope="col">{t("aspect")}</th>
              <th scope="col">{t("usual")}</th>
              <th scope="col" className="text-accent-text">
                {t("exegezis")}
              </th>
            </tr>
          </thead>
          <tbody className="block">
            {ROWS.map((r) => (
              <tr key={r} className={`${GRID} border-b border-line text-[14px] md:text-[16px]`}>
                <th scope="row" className="font-medium text-heading">
                  {t(`${r}.a`)}
                </th>
                <td className="text-muted">{t(`${r}.u`)}</td>
                <td className="font-medium text-heading">{t(`${r}.e`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
