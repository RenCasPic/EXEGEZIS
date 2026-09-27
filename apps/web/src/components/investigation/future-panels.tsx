import { ArrowDown, FlaskConical, GitPullRequestDraft, ShieldCheck } from "lucide-react";
import type { BugReport } from "@exegezis/core";
import { useTranslations } from "next-intl";
import { Panel } from "@/components/ui/primitives";
import { NotImplemented, OutcomePill, StatusPill } from "@/components/ui/status";
import Link from "next/link";
import { RootCauseView } from "@/components/root-cause/root-cause-view";
import type { RootCauseEntry } from "@/lib/evidence/root-causes";

export function RootCausePanel({ entry, bugId }: { entry: RootCauseEntry | null; bugId: string | null }) {
  const t = useTranslations("investigations.rootCause");
  const stage = useTranslations("common.stageDetail");
  const report = entry?.report.status === "ok" ? entry.report.value : null;
  return (
    <Panel
      id="root-cause"
      title={t("title")}
      icon={<FlaskConical />}
      subtitle={report === null ? undefined : t("subtitle", { bug: report.bugId, plan: report.planPath })}
      actions={
        report === null ? (
          <StatusPill status="NOT_RUN" tone="q" size="xs" />
        ) : (
          <Link href={`/verification/root-causes/${entry?.ref.id ?? ""}`} className="text-xs text-accent-text hover:underline">
            {t("open")}
          </Link>
        )
      }
    >
      {entry !== null && report !== null ? (
        <RootCauseView entry={entry} report={report} />
      ) : (
        <div className="flex flex-col gap-2 text-[13px] text-muted">
          <p>{stage("noRootCauseRun")}</p>
          <p className="text-xs text-faint">
            {t("rule")}
            {bugId !== null && (
              <>
                {" "}
                {t("run")} <code className="font-mono">pnpm exegezis root-cause --case {bugId}</code>
              </>
            )}
          </p>
        </div>
      )}
    </Panel>
  );
}

export function FixPanel({ spec }: { spec: { path: string } | null }) {
  const t = useTranslations("investigations.fix");
  const stage = useTranslations("common.stageDetail");
  return (
    <Panel id="fix" title={t("title")} icon={<GitPullRequestDraft />} actions={<NotImplemented size="xs" />}>
      <p className="text-[13px] text-muted">{stage("fixNotImplemented")}</p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[13px]">
        <dt className="text-muted">{t("proposedChange")}</dt>
        <dd className="text-faint">{t("proposedNone")}</dd>
        <dt className="text-muted">{t("filesChanged")}</dt>
        <dd className="text-faint">{t("none")}</dd>
        <dt className="text-muted">{t("regressionTest")}</dt>
        <dd className="text-faint">{spec === null ? t("none") : t("regressionExists", { path: spec.path })}</dd>
      </dl>
    </Panel>
  );
}

function Step({ label, status }: { label: string; status: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
      <span className="font-mono text-[12px] tracking-wide text-fg">{label}</span>
      {status}
    </div>
  );
}

export function VerificationPanel({ report }: { report: BugReport | null }) {
  const r = report?.reproduction ?? null;
  const reproduced = report?.outcome === "VERIFIED";
  const t = useTranslations("investigations.fixVerification");
  const stage = useTranslations("common.stageDetail");
  return (
    <Panel id="verification" title={t("title")} icon={<ShieldCheck />} actions={<NotImplemented size="xs" />}>
      <p className="text-[13px] text-muted">{stage("verificationNotImplemented")}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <Step label={t("bugReproduced")} status={<OutcomePill outcome={report?.outcome ?? null} size="xs" />} />
          <ArrowDown className="mx-auto size-3.5 text-faint" />
          <Step label={t("fixApplied")} status={<NotImplemented size="xs" />} />
          <ArrowDown className="mx-auto size-3.5 text-faint" />
          <Step label={t("reproductionPasses")} status={<NotImplemented size="xs" />} />
          <ArrowDown className="mx-auto size-3.5 text-faint" />
          <Step label={t("regressionPasses")} status={<NotImplemented size="xs" />} />
        </div>
        <div className="grid grid-cols-2 content-start gap-3">
          <div className="rounded-md border border-line p-3">
            <div className="text-xs text-muted">{t("before")}</div>
            <div className="mt-1 font-mono text-[18px] text-fg">{r === null ? "—" : `${r.failures} / ${r.attempts}`}</div>
            <div className="text-xs text-faint">{r === null ? t("notExecuted") : t("attemptsFailed")}</div>
          </div>
          <div className="rounded-md border border-dashed border-line-strong p-3">
            <div className="text-xs text-muted">{t("after")}</div>
            <div className="mt-1 font-mono text-[18px] text-faint">—</div>
            <div className="text-xs text-faint">{t("noFix")}</div>
          </div>
          <div className="col-span-2 rounded-md border border-dashed border-line-strong p-3">
            <div className="text-xs text-muted">{t("regression")}</div>
            <div className="mt-1 text-xs text-faint">{t("regressionNotRun")}</div>
          </div>
          <div className="col-span-2 flex items-center justify-between rounded-md border border-line bg-panel-2 p-3">
            <span className="text-xs text-muted">{t("result")}</span>
            <StatusPill status={reproduced ? t("noFixNotVerified") : "NOT_VERIFIED"} tone="q" size="xs" />
          </div>
        </div>
      </div>
    </Panel>
  );
}
