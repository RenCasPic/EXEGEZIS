import type { EvidenceLevel } from "@exegezis/core";
import { searchDir } from "@/lib/user-workspace";
import { CircleHelp, CircleX, Minus, Search, Check, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { groupStats } from "@exegezis/core";
import { listTemplates } from "@exegezis/search/light";
import { HomeHeader } from "@/components/home/home-header";
import { accountSummary } from "@/lib/account";
import { InspectForm } from "@/components/home/inspect-form";
import { SearchForm, type TemplateOption } from "@/components/home/search-form";
import { StatusPill } from "@/components/ui/status";
import { formatFor } from "@/i18n/format";
import { getFormat } from "@/i18n/server";
import { cn } from "@/lib/cn";
import { buildCases, proofMetrics, type CaseGroup, type CaseRow } from "@/lib/evidence/cases";
import { listInspections } from "@/lib/evidence/inspections";
import { getRootCauses, getSummaries } from "@/lib/evidence/investigations";
import { latestPerCase } from "@/lib/evidence/root-causes";
import { NOT_IMPLEMENTED_STAGES, STAGES, type Tone } from "@/lib/evidence/stages";
import { INSPECTION_STATUS_TONE } from "@/lib/inspection-labels";
import { listProjects } from "@/lib/projects";
import { getScope, inScope, UNASSIGNED } from "@/lib/scope";
import { EVIDENCE_LEVELS, evidenceLevelIndex, verdictTone } from "@/lib/verdicts";

/*
 * The home (docs/design/home-app.html at 1440 px, home-app-mobile.html at
 * 390 px): its own header, the inspection form, «what is proven», the
 * activity per case (a table on wide screens, cards on narrow ones), recent
 * inspections and what EXEGEZIS can prove today. Real data from runs/ only.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: { absolute: `${t("title")} · EXEGEZIS` } };
}

const FILTERS: ("all" | CaseGroup)[] = ["all", "proven", "pending", "expected"];
/** The activity table's columns (the design's grid). */
const COLUMNS = "grid grid-cols-[minmax(0,2.4fr)_150px_170px_110px_120px_56px] gap-4";
/** Run dots shown per case (the most recent ones). */
const DOTS = 8;
/** Cases on the home, the most recent first; «See all» opens the full list. */
const HOME_CASES = 6;

type PillTone = "ok" | "warn" | "q" | "off" | "bad";
const PILL: Record<PillTone, string> = {
  ok: "text-ok bg-ok-bg border-ok/30",
  warn: "text-warn bg-warn-bg border-warn/30",
  q: "text-q bg-q-bg border-q/30",
  off: "text-off bg-off-bg border-off-bd",
  bad: "text-bad bg-bad-bg border-bad/30",
};
const PILL_ICON: Record<PillTone, typeof Check> = { ok: Check, warn: TriangleAlert, q: CircleHelp, off: Minus, bad: CircleX };
const FILL: Record<PillTone, string> = { ok: "bg-ok", warn: "bg-warn", q: "bg-q", off: "bg-off", bad: "bg-bad" };

function pillTone(tone: Tone): PillTone {
  return tone === "running" || tone === "unimplemented" ? "q" : tone;
}

/** A verdict as in the design: sentence case, its family's colour and icon (the icon only where there is room). */
function Verdict({ code, tone, compact = false }: { code: string; tone: PillTone; compact?: boolean }) {
  const t = useTranslations("labels");
  const Icon = PILL_ICON[tone];
  const key = `status.${code}` as "status.OK";
  return (
    <span title={t("statusTitle", { code })} className={cn("inline-flex items-center gap-1.5 rounded-full border text-[12px] font-semibold whitespace-nowrap", compact ? "px-[9px] py-[3px]" : "px-2.5 py-1", PILL[tone])}>
      {!compact && <Icon className="size-3" strokeWidth={2.4} aria-hidden />}
      {t.has(key) ? t(key) : code}
    </span>
  );
}

interface Meter {
  filled: number;
  tone: PillTone;
  label: string;
  short: string;
}

/** Root-cause evidence on a 5-step bar: none, reproduced (2), sufficient (3), candidate (4), validated (5). */
function meterOf(row: CaseRow, falseValidation: boolean, t: (key: string) => string): Meter {
  const level: EvidenceLevel | null = row.kind === "negative" ? null : row.evidence;
  if (level === null || level === "NONE") return { filled: 0, tone: "q", label: t("meter.notApplicable"), short: t("meter.notApplicable") };
  const index = evidenceLevelIndex(level);
  const filled = index === 0 ? 0 : Math.min(EVIDENCE_LEVELS.length, index + 1);
  if (falseValidation) return { filled, tone: "bad", label: t("meter.falseValidation"), short: t("meter.falseValidation") };
  if (level === "VALIDATED") return { filled, tone: "ok", label: t("meter.validated"), short: t("meter.validatedShort") };
  if (level === "SUFFICIENT" || level === "CANDIDATE") return { filled, tone: "warn", label: t(`meter.${level}`), short: t(`meter.${level}`) };
  return { filled, tone: "q", label: t(`meter.${level}`), short: t(`meter.${level}`) };
}

function MeterBar({ meter, narrow = false }: { meter: Meter; narrow?: boolean }) {
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: EVIDENCE_LEVELS.length }, (_, i) => (
        <span key={i} className={cn("h-1.5 rounded-[2px]", narrow ? "w-5" : "w-[22px]", i < meter.filled ? FILL[meter.tone] : "bg-empty")} />
      ))}
    </span>
  );
}

function Origin({ row }: { row: CaseRow }) {
  const t = useTranslations("home.cases");
  const o = row.origin;
  if (o.kind === "replay")
    return (
      <span title={t("replayTitle")} className="bg-stripes rounded-md border border-line-strong px-2 py-[3px] text-[12px] font-medium text-off">
        {t("replay")}
      </span>
    );
  if (o.kind === "ai") return <span className="text-[12px] text-muted">{t("aiModel", { model: o.model })}</span>;
  if (o.kind === "human") return <span className="text-[12px] text-muted">{t("humanPlan")}</span>;
  return <span className="text-[12px] text-muted">—</span>;
}

function originText(row: CaseRow, t: (key: string, values?: Record<string, string>) => string): string {
  const o = row.origin;
  return o.kind === "replay" ? t("replay") : o.kind === "ai" ? t("aiModel", { model: o.model }) : o.kind === "human" ? t("humanPlan") : "—";
}

/** One dot per run (the latest {DOTS}): reproduced filled, inconclusive filled grey, not reproduced as a ring; empty slots faint. */
function Dots({ row }: { row: CaseRow }) {
  const t = useTranslations("common");
  const runs = row.runs.slice(-DOTS);
  const count = (m: string) => runs.filter((r) => r.mark === m).length;
  const label = t("runHistory", { proven: count("ok"), inconclusive: count("q"), notProven: count("off") });
  return (
    <span className="flex gap-1" role="img" aria-label={label} title={label}>
      {Array.from({ length: DOTS }, (_, i) => {
        const run = runs[i];
        return <span key={i} aria-hidden className={cn("size-2 rounded-full", run === undefined ? "bg-line-soft" : run.mark === "ok" ? "bg-ok" : run.mark === "q" ? "bg-q" : "border-[1.5px] border-off-dot")} />;
      })}
    </span>
  );
}

function noteOf(row: CaseRow, t: (key: string, values?: Record<string, string>) => string, status: (key: string) => string): string {
  if (row.kind === "positive") return t("note.seeded");
  if (row.kind === "negative") return t("note.expected", { expected: row.expected === null ? "—" : status(row.expected).toLowerCase() });
  return t("note.adhoc");
}

function CaseVerdict({ row, compact }: { row: CaseRow; compact?: boolean }) {
  return row.outcome === null ? <Verdict code="NOT_RUN" tone="q" {...(compact ? { compact } : {})} /> : <Verdict code={row.outcome} tone={pillTone(verdictTone(row.outcome))} {...(compact ? { compact } : {})} />;
}

function NotAsExpected({ row }: { row: CaseRow }) {
  const t = useTranslations("home.cases");
  const status = useTranslations("labels.status");
  if (row.kind !== "negative" || row.asExpected !== false) return null;
  const expected = row.expected === null ? "—" : status(row.expected);
  return (
    <span className="font-medium text-bad" title={t("expectedWas", { expected })}>
      {" · "}
      {t("notAsExpected", { expected })}
    </span>
  );
}

function CaseTableRow({ row, when, falseValidation }: { row: CaseRow; when: string; falseValidation: boolean }) {
  const t = useTranslations("home.cases");
  const status = useTranslations("labels.status");
  const meter = meterOf(row, falseValidation, t as unknown as (key: string) => string);
  return (
    <li className={cn(COLUMNS, "items-center border-b border-line-soft px-6 py-3.5")}>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <Link href={`/investigations/${row.latest.ref.id}`} className="text-[14px] font-medium break-words text-fg hover:underline" translate="no">
          {row.title}
        </Link>
        <span className="text-[12px] text-muted">
          <span className="font-mono">{row.caseId}</span> · {noteOf(row, t as never, status as never)}
          <NotAsExpected row={row} />
        </span>
      </div>
      <div>
        <CaseVerdict row={row} />
      </div>
      <div className="flex flex-col gap-1.5">
        <MeterBar meter={meter} />
        <span className="text-[12px] text-muted">{meter.label}</span>
      </div>
      <Dots row={row} />
      <div>
        <Origin row={row} />
      </div>
      <span className="text-right text-[12px] text-muted">{when}</span>
    </li>
  );
}

function CaseCard({ row, when, falseValidation }: { row: CaseRow; when: string; falseValidation: boolean }) {
  const t = useTranslations("home.cases");
  const status = useTranslations("labels.status");
  const meter = meterOf(row, falseValidation, t as unknown as (key: string) => string);
  return (
    <li className="panel-frame flex flex-col gap-2.5 rounded-xl bg-panel px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[12px] text-muted">{row.caseId}</span>
        <CaseVerdict row={row} compact />
      </div>
      <Link href={`/investigations/${row.latest.ref.id}`} className="text-[15px] leading-[1.35] font-medium text-fg hover:underline" translate="no">
        {row.title}
      </Link>
      <div className="flex items-center justify-between gap-2">
        <MeterBar meter={meter} narrow />
        <span className="text-[12px] text-muted">{meter.short}</span>
      </div>
      <span className="text-[12px] text-muted">
        {noteOf(row, t as never, status as never)} · {originText(row, t as never)} · {when}
        <NotAsExpected row={row} />
      </span>
    </li>
  );
}

function Metric({ label, labelShort, value, hint, hintShort, extra }: { label: string; labelShort: string; value: ReactNode; hint: ReactNode; hintShort: ReactNode; extra?: ReactNode }) {
  return (
    <div className="panel-frame flex flex-col gap-1.5 rounded-xl bg-panel p-4 xl:gap-2 xl:px-6 xl:py-[22px]">
      <span className="text-[13px] text-muted xl:text-[14px]">
        <span className="xl:hidden">{labelShort}</span>
        <span className="max-xl:hidden">{label}</span>
      </span>
      <span className="font-mono text-[30px] leading-none font-medium xl:text-[40px]">{value}</span>
      <span className="text-[12px] text-muted xl:hidden">{hintShort}</span>
      <span className="text-[13px] leading-[1.45] text-muted max-xl:hidden">{hint}</span>
      {extra}
    </div>
  );
}

/** «m:ss» (minutes), as in the design; «—» without times. */
function minutes(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** `/?url=https://…` (from the public site's «Inspect for free»): the address, if it is an http(s) one. */
function initialUrl(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return "";
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

const PANEL = "panel-frame rounded-xl bg-panel";

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Cloud mode: a signed-in user who accepted the legal texts (else /login or /welcome).
  const account = await accountSummary();
  const [all, rootCauses, inspections, scope, projects, params, t, common, status, f] = await Promise.all([
    getSummaries(),
    getRootCauses(),
    listInspections(),
    getScope(),
    listProjects(),
    searchParams,
    getTranslations("home"),
    getTranslations("common"),
    getTranslations("labels.status"),
    getFormat(),
  ]);
  const summaries = all.filter((s) => inScope(s, scope));
  const cases = buildCases(summaries);
  const latestCauses = latestPerCase(rootCauses);
  const m = proofMetrics(cases, summaries, latestCauses);
  const falseValidated = latestCauses.filter((e) => e.evaluation?.falseValidation === true).map((e) => e.ref.caseId);
  const seeded = cases.filter((c) => c.kind === "positive").length;
  const filter = FILTERS.find((id) => id === params["casos"]) ?? "all";
  const shown = (filter === "all" ? cases : cases.filter((c) => c.group === filter)).slice(0, HOME_CASES);
  const tab = params["modo"] === "buscar" ? "search" : "inspect";
  const templates: TemplateOption[] =
    tab === "search"
      ? (await listTemplates(await searchDir()).catch(() => [])).map((tp) => ({ id: tp.id, name: tp.name, description: tp.description, origin: tp.origin, hasExact: tp.exact !== null, hasMeaning: tp.meaning !== null }))
      : [];
  const fmt = formatFor(f.locale);
  const hasUnassigned = all.some((s) => s.project === null);
  const projectOptions = [...projects.map((p) => ({ id: p.id, label: p.id })), ...(hasUnassigned ? [{ id: UNASSIGNED, label: t("header.unassigned") }] : [])];
  const recent = inspections.slice(0, 5);

  return (
    <div className="flex min-h-screen flex-col bg-bg [line-height:normal]">
      <HomeHeader projects={projectOptions} project={scope.project} account={account} />
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 pt-5 pb-8 xl:gap-14 xl:p-12">
        <section aria-labelledby="home-title" className={cn(PANEL, "flex flex-col gap-4 rounded-[14px] px-[18px] py-[22px] xl:gap-6 xl:rounded-2xl xl:px-12 xl:pt-11 xl:pb-9")}>
          <div className="flex flex-col gap-4 xl:gap-2.5">
            <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-accent-text xl:text-[12px]">{tab === "search" ? t("eyebrowSearch") : t("eyebrowInspect")}</span>
            <h1 id="home-title" className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-heading xl:text-[40px] xl:leading-[1.1]">
              {tab === "search" ? t("headingSearch") : t("headingInspect")}
            </h1>
            <p className="max-w-[720px] text-[15px] leading-[1.5] text-muted xl:text-[17px]">
              {tab === "search" ? (
                t("introSearch")
              ) : (
                <>
                  <span className="xl:hidden">{t("introInspectShort")}</span>
                  <span className="max-xl:hidden">{t("introInspect")}</span>
                </>
              )}
            </p>
          </div>
          {tab === "search" ? <SearchForm templates={templates} /> : <InspectForm initialUrl={initialUrl(params["url"])} />}
          <div className="flex flex-col gap-2 border-t border-line pt-3.5 text-[14px] xl:flex-row xl:items-center xl:justify-between xl:pt-[18px]">
            <p className="font-medium text-fg xl:font-normal xl:text-muted">
              {t("haveSymptom")}{" "}
              <Link href="/investigations/new" className="font-medium hover:underline">
                {t("openInvestigation")}
              </Link>
            </p>
            <Link href={tab === "search" ? "/" : "/?modo=buscar"} className="font-medium text-accent-text hover:underline max-xl:hidden">
              {tab === "search" ? t("switchToInspect") : t("switchToSearch")}
            </Link>
          </div>
        </section>

        <section aria-labelledby="proof-title" className="flex flex-col gap-3 xl:gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="proof-title" className="text-[18px] font-semibold text-heading xl:text-[20px]">
              {t("proven.title")}
            </h2>
            <span className="text-[13px] text-muted max-xl:hidden">{t("proven.note")}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 xl:gap-4">
            <Metric
              label={t("metrics.verifiedBugs")}
              labelShort={t("metrics.verifiedBugs")}
              value={fmt.number(m.verifiedBugs)}
              hint={t("metrics.verifiedBugsHint", { verified: m.verifiedBugs, seeded, reproductions: m.reproductions, attempts: m.attempts })}
              hintShort={t("metrics.verifiedBugsShort", { verified: m.verifiedBugs, seeded })}
            />
            <Metric
              label={t("metrics.validatedCauses")}
              labelShort={t("metrics.validatedCausesShort")}
              value={
                <>
                  {fmt.number(m.validatedCauses)}
                  <span className="text-[15px] text-muted xl:text-[18px]"> / {fmt.number(m.rootCauseCases)}</span>
                </>
              }
              hint={t("metrics.validatedCausesHint")}
              hintShort={
                m.falseValidations > 0 ? (
                  <Link href="/verification/root-causes" className="font-medium text-bad hover:underline">
                    {t("metrics.falseValidationsShort", { count: m.falseValidations, ids: falseValidated.join(", ") })}
                  </Link>
                ) : (
                  t("metrics.validatedCausesShortHint", { cases: m.rootCauseCases })
                )
              }
              extra={
                m.falseValidations > 0 ? (
                  <Link href="/verification/root-causes" className="flex items-center gap-1.5 text-[13px] font-medium text-bad hover:underline max-xl:hidden">
                    <CircleX className="size-3.5" strokeWidth={2} aria-hidden />
                    {t("metrics.falseValidations", { count: m.falseValidations, ids: falseValidated.join(", ") })}
                  </Link>
                ) : undefined
              }
            />
            <Metric
              label={t("metrics.falseVerified")}
              labelShort={t("metrics.falseVerified")}
              value={<span className={m.falseVerified > 0 ? "text-bad" : "text-ok"}>{fmt.number(m.falseVerified)}</span>}
              hint={m.falseVerified > 0 ? t("metrics.falseVerifiedSome", { count: m.negativeCases, verified: m.falseVerified }) : t("metrics.falseVerifiedNone", { count: m.negativeCases })}
              hintShort={t("metrics.falseVerifiedShort", { count: m.negativeCases })}
            />
            <Metric
              label={t("metrics.median")}
              labelShort={t("metrics.medianShort")}
              value={minutes(m.medianMsToVerify)}
              hint={m.timedCases === 0 ? t("metrics.medianNone") : t("metrics.medianHint", { count: m.timedCases })}
              hintShort={t("metrics.medianShortHint")}
            />
          </div>
        </section>

        <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
          <section aria-labelledby="cases-title" className="flex flex-col gap-3 lg:panel-frame lg:gap-0 lg:rounded-xl lg:bg-panel">
            <div className="flex items-baseline justify-between gap-4 lg:items-center lg:border-b lg:border-line lg:px-6 lg:py-5">
              <h2 id="cases-title" className="text-[18px] font-semibold text-heading lg:text-[17px]">
                {t("cases.title")}
              </h2>
              <div className="flex items-center gap-4">
                <nav aria-label={t("cases.filterLabel")} className="flex gap-0.5 rounded-lg border border-line bg-sunken p-[3px] text-[13px] max-lg:hidden">
                  {FILTERS.map((id) => (
                    <Link
                      key={id}
                      href={id === "all" ? "/" : `/?casos=${id}`}
                      scroll={false}
                      aria-current={filter === id ? "page" : undefined}
                      className={cn("rounded-md px-2.5 py-[5px]", filter === id ? "bg-panel font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted hover:text-fg")}
                    >
                      {t(`cases.filters.${id}`)}
                    </Link>
                  ))}
                </nav>
                <Link href="/investigations" className="text-[13px] font-medium text-fg hover:underline">
                  {t("cases.all")}
                </Link>
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="rounded-xl border-[1.5px] border-dashed border-line-strong px-[18px] py-[22px] text-center lg:m-6">
                <p className="text-[15px] font-semibold text-heading">{cases.length === 0 ? t("cases.none") : t("cases.noneInFilter")}</p>
                <p className="mt-2 text-[13px] text-muted">
                  {cases.length === 0 ? (
                    <>
                      {t("cases.noneBody")} <code className="font-mono">pnpm exegezis benchmark --suite buggy-shop</code>
                    </>
                  ) : (
                    t("cases.tryAnother")
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className={cn(COLUMNS, "border-b border-line px-6 py-2.5 text-[12px] text-muted max-lg:hidden")} aria-hidden>
                  <span>{t("cases.columns.case")}</span>
                  <span>{t("cases.columns.verdict")}</span>
                  <span>{t("cases.columns.evidence")}</span>
                  <span>{t("cases.columns.history")}</span>
                  <span>{t("cases.columns.origin")}</span>
                  <span className="text-right">{t("cases.columns.last")}</span>
                </div>
                <ul className="max-lg:hidden">
                  {shown.map((row) => (
                    <CaseTableRow key={row.key} row={row} when={fmt.relative(row.createdAt)} falseValidation={falseValidated.includes(row.caseId)} />
                  ))}
                </ul>
                <ul className="flex flex-col gap-3 lg:hidden">
                  {shown.map((row) => (
                    <CaseCard key={row.key} row={row} when={fmt.relative(row.createdAt)} falseValidation={falseValidated.includes(row.caseId)} />
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-6 py-3.5 text-[12px] text-muted max-lg:hidden">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-ok" aria-hidden />
                    {status("REPRODUCED")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-q" aria-hidden />
                    {status("INCONCLUSIVE")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full border-[1.5px] border-off-dot" aria-hidden />
                    {t("cases.notReproduced")}
                  </span>
                  <span>{t("cases.replayNote")}</span>
                </div>
              </>
            )}
          </section>

          <div className="flex min-w-0 flex-col gap-6">
            <section aria-labelledby="recent-title" className="flex flex-col gap-5 xl:panel-frame xl:rounded-xl xl:bg-panel xl:px-6 xl:pt-5 xl:pb-7">
              <h2 id="recent-title" className={cn("text-[17px] font-semibold text-heading", recent.length === 0 && "max-xl:sr-only")}>
                {t("recent.title")}
              </h2>
              {recent.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-line-strong px-[18px] py-[22px] text-center xl:gap-2.5 xl:px-6 xl:py-7">
                  <Search className="size-7 text-muted max-xl:hidden" strokeWidth={1.6} aria-hidden />
                  <p className="text-[15px] font-semibold text-heading">{t("recent.none")}</p>
                  <p className="text-[13px] leading-[1.5] text-muted">
                    <span className="xl:hidden">{t("recent.noneShort")}</span>
                    <span className="max-xl:hidden">{t("recent.noneBody")}</span>
                  </p>
                </div>
              ) : (
                <ul className={cn("flex flex-col", "max-xl:panel-frame max-xl:rounded-xl max-xl:bg-panel")}>
                  {recent.map((i) => {
                    const r = i.report.status === "ok" ? i.report.value : null;
                    const g = r === null ? null : groupStats(r.groups, r.findings);
                    return (
                      <li key={i.id} className="border-b border-line-soft last:border-b-0">
                        <Link href={`/inspections/${i.id}`} className="flex items-center gap-3 py-2.5 max-xl:px-4 hover:underline">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[13px] text-fg">{r?.target.url ?? i.relDir}</div>
                            <div className="text-[12px] text-muted">
                              {r === null || g === null ? t("recent.invalid") : t("recent.line", { problems: g.problems, elements: g.elements, when: fmt.relative(r.finishedAt) })}
                            </div>
                          </div>
                          {r === null ? <StatusPill status="INVALID" tone="bad" size="xs" /> : <StatusPill status={r.status} tone={INSPECTION_STATUS_TONE[r.status]} size="xs" />}
                        </Link>
                      </li>
                    );
                  })}
                  {inspections.length > recent.length && (
                    <li className="pt-2.5 max-xl:px-4 max-xl:pb-2.5">
                      <Link href="/inspections" className="text-[13px] font-medium text-accent-text hover:underline">
                        {t("recent.all")}
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </section>

            <section aria-labelledby="capabilities-title" className={cn(PANEL, "flex flex-col gap-3.5 px-6 py-5 max-md:hidden")}>
              <h2 id="capabilities-title" className="text-[17px] font-semibold text-heading">
                {t("capabilities.title")}
              </h2>
              <ol className="flex flex-col gap-0.5 text-[14px]">
                {STAGES.map((stage, i) => {
                  const off = NOT_IMPLEMENTED_STAGES.includes(stage.id);
                  return (
                    <li key={stage.id} className="flex items-center justify-between gap-3 border-b border-line-soft py-[7px]" title={common(`stages.${stage.id}.text`)}>
                      <span className="flex items-center gap-2.5 text-fg">
                        <span className="w-[18px] font-mono text-[12px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                        {common(`stages.${stage.id}.label`)}
                      </span>
                      {off ? (
                        <span className="rounded-md border-[1.5px] border-dashed border-line-strong px-2 py-0.5 text-[12px] font-medium text-off">{status("NOT_IMPLEMENTED")}</span>
                      ) : stage.id === "root_cause" ? (
                        <span className="text-[12px] font-semibold text-warn">{t("capabilities.rootCause")}</span>
                      ) : (
                        <span className="text-[12px] font-semibold text-ok">{t("capabilities.ready")}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
