import { CheckCircle2, CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { InspectForm } from "./inspect-form";
import { Container, Eyebrow } from "./ui";

/** An illustration of a report (not real data): hidden from assistive technology. */
function ReportPreview() {
  const t = useTranslations("preview");
  const rows = [
    ["row1", "verified", "runs"],
    ["row2", "verified", "runs"],
    ["row3", "verified", "runs"],
    ["row4", "intermittent", "runsSome"],
  ] as const;
  return (
    <div aria-hidden className="panel-frame w-full rounded-xl bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <span className="font-mono text-[13px] text-heading">{t("site")}</span>
        <span className="font-mono text-[12px] text-muted">{t("pages")}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {(
          [
            ["frontend", 4],
            ["backend", 1],
          ] as const
        ).map(([key, count]) => (
          <div key={key} className="rounded-lg border border-line bg-sunken p-3">
            <div className="text-[12px] text-muted">{t(key)}</div>
            <div className="mt-1 text-[15px] font-semibold text-heading">{t("problems", { count })}</div>
          </div>
        ))}
      </div>
      <ul className="mt-4 flex flex-col">
        {rows.map(([row, verdict, runs]) => (
          <li key={row} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${verdict === "verified" ? "border-ok/30 bg-ok-bg text-ok" : "border-warn/30 bg-warn-bg text-warn"}`}
            >
              {verdict === "verified" ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />}
              {t(verdict)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-heading">{t(row)}</span>
            <span className="shrink-0 font-mono text-[12px] text-muted">{t(runs)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Navy hero: label, title, text, the address field and the report preview. */
export function Hero() {
  const t = useTranslations("hero");
  return (
    <section aria-labelledby="hero-title" className="theme-dark border-b border-line">
      <Container className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-5">
          <Eyebrow onNavy>{t("eyebrow")}</Eyebrow>
          <h1 id="hero-title" className="text-[36px] leading-[1.05] font-semibold tracking-tight text-heading sm:text-[54px]">
            {t("title")}
          </h1>
          <p className="max-w-xl text-[17px] leading-relaxed text-heading">{t("text")}</p>
          <InspectForm />
          <p className="text-[13px] text-muted">{t("notes")}</p>
        </div>
        <ReportPreview />
      </Container>
    </section>
  );
}
