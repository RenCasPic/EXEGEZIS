import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container, SectionHeading } from "./ui";

const ROWS = ["r1", "r2", "r3", "r4", "r5"] as const;

/** The difference: what usual tools give you, and what EXEGEZIS gives you. A table on wide screens, a list on phones. */
export function Comparison() {
  const t = useTranslations("diff");
  return (
    <section aria-labelledby="diff-title" className="py-16 sm:py-24">
      <Container>
        <SectionHeading id="diff-title" eyebrow={t("eyebrow")} title={t("title")} />
        <div className="panel-frame hidden overflow-hidden rounded-xl bg-panel md:block">
          <table className="w-full border-collapse text-left text-[15px]">
            <caption className="sr-only">{t("caption")}</caption>
            <thead>
              <tr className="border-b border-line bg-sunken">
                <th scope="col" className="px-5 py-3 text-[13px] font-semibold text-muted">
                  {t("aspect")}
                </th>
                <th scope="col" className="px-5 py-3 text-[13px] font-semibold text-muted">
                  {t("usual")}
                </th>
                <th scope="col" className="px-5 py-3 font-mono text-[13px] font-semibold text-accent-text">
                  {t("exegezis")}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-5 py-4 font-semibold text-heading">
                    {t(`${r}.a`)}
                  </th>
                  <td className="px-5 py-4 text-muted">
                    <span className="flex items-start gap-2">
                      <X className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                      {t(`${r}.u`)}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-medium text-heading">
                    <span className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
                      {t(`${r}.e`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex flex-col gap-4 md:hidden">
          {ROWS.map((r) => (
            <li key={r} className="panel-frame rounded-xl bg-panel p-4">
              <h3 className="text-[16px] font-semibold text-heading">{t(`${r}.a`)}</h3>
              <dl className="mt-2 grid gap-2 text-[14px]">
                <div>
                  <dt className="text-[12px] text-muted">{t("usual")}</dt>
                  <dd className="text-muted">{t(`${r}.u`)}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[12px] text-accent-text">{t("exegezis")}</dt>
                  <dd className="font-medium text-heading">{t(`${r}.e`)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
