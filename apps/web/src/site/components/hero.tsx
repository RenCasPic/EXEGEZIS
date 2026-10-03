import { siteT, type SiteLocale } from "../i18n";
import { InspectForm } from "./inspect-form";
import { Container, Eyebrow } from "./ui";

const PILL = "shrink-0 rounded-full px-2.5 py-[3px] text-[12px] font-semibold whitespace-nowrap";

/** An illustration of a report (not real data): hidden from assistive technology. White card, lime outline. */
function ReportPreview({ locale }: { locale: SiteLocale }) {
  const t = siteT(locale, "preview");
  const rows = [
    ["row1", "verified"],
    ["row2", "verified"],
    ["row3", "verified"],
    ["row4", "intermittent"],
  ] as const;
  return (
    <div aria-hidden className="overflow-hidden rounded-2xl border-[1.5px] border-panel-border shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <div className="theme-light flex flex-col gap-[14px] bg-panel p-4 text-heading sm:p-[22px]">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-[13px] text-muted">
            {t("site")} · {t("pages")}
          </span>
          <span className={`${PILL} bg-ok-bg text-ok`}>{t("done")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {(
            [
              ["frontend", 4],
              ["backend", 1],
            ] as const
          ).map(([key, count]) => (
            <div key={key} className="flex flex-col gap-1 rounded-[10px] border-[1.5px] border-panel-border px-3.5 py-3">
              <span className="text-[12px] text-muted">{t(key)}</span>
              <span className="text-[18px] font-semibold sm:text-[22px]">{t("problems", { count })}</span>
            </div>
          ))}
        </div>
        {rows.map(([row, verdict]) => (
          <div key={row} className="flex items-center gap-3 border-t border-line py-[11px]">
            <span className={`${PILL} ${verdict === "verified" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>{t(verdict)}</span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{t(`${row}.title`)}</span>
            <span className="shrink-0 text-[12px] text-muted">{t(`${row}.where`)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Navy hero: label, title, text, the address field, three notes and the report preview. */
export function Hero({ locale, cloud }: { locale: SiteLocale; cloud: boolean }) {
  const t = siteT(locale, "hero");
  return (
    <section aria-labelledby="hero-title" className="theme-dark bg-bg text-heading">
      <Container className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 pt-14 pb-16 lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-16 lg:pt-[88px] lg:pb-[104px] xl:grid-cols-[minmax(0,1fr)_560px]">
        <div className="flex min-w-0 flex-col gap-6 lg:gap-7">
          <Eyebrow onNavy>{t("eyebrow")}</Eyebrow>
          <h1 id="hero-title" className="text-[42px] leading-[1.02] font-semibold tracking-[-0.03em] sm:text-[56px] xl:text-[68px]">
            {t("title")}
          </h1>
          <p className="max-w-[620px] text-[18px] leading-[1.55] text-text-soft sm:text-[20px]">{t("text")}</p>
          <InspectForm locale={locale} cloud={cloud} />
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-muted">
            <li>{t("noCard")}</li>
            <li aria-hidden className="max-sm:hidden">·</li>
            <li>{t("readOnly")}</li>
            <li aria-hidden className="max-sm:hidden">·</li>
            <li>{t("minutes")}</li>
          </ul>
        </div>
        <ReportPreview locale={locale} />
      </Container>
    </section>
  );
}
