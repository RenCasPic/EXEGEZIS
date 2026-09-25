import { ArrowDown, FlaskConical, GitPullRequestDraft, ShieldCheck } from "lucide-react";
import type { BugReport } from "@exegezis/core";
import { Panel } from "@/components/ui/primitives";
import { NotImplemented, OutcomePill, StatusPill } from "@/components/ui/status";
import { NOT_IMPLEMENTED_DETAIL } from "@/lib/evidence/stages";

export function RootCausePanel() {
  return (
    <Panel id="root-cause" title="Root Cause" icon={<FlaskConical />} actions={<NotImplemented size="xs" />}>
      <p className="text-[13px] text-muted">{NOT_IMPLEMENTED_DETAIL.root_cause}</p>
      <div className="mt-3 rounded-md border border-dashed border-line-strong p-3 text-xs text-faint">
        No root cause has been proposed or validated for this investigation. When this stage exists, a cause will only be shown as VALIDATED if an experiment
        confirmed its prediction; otherwise it will read INSUFFICIENT EVIDENCE.
      </div>
    </Panel>
  );
}

export function FixPanel({ spec }: { spec: { path: string } | null }) {
  return (
    <Panel id="fix" title="Fix" icon={<GitPullRequestDraft />} actions={<NotImplemented size="xs" />}>
      <p className="text-[13px] text-muted">{NOT_IMPLEMENTED_DETAIL.fix}</p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[13px]">
        <dt className="text-muted">Proposed change</dt>
        <dd className="text-faint">None</dd>
        <dt className="text-muted">Files changed</dt>
        <dd className="text-faint">None</dd>
        <dt className="text-muted">Regression test</dt>
        <dd className="text-faint">
          {spec === null ? "None" : <>The compiled reproduction test (<span className="font-mono">{spec.path}</span>) exists, but it has not been used as a regression test for any fix.</>}
        </dd>
      </dl>
    </Panel>
  );
}

function Step({ label, status }: { label: string; status: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
      <span className="font-mono text-[12px] uppercase tracking-wide text-fg">{label}</span>
      {status}
    </div>
  );
}

export function VerificationPanel({ report }: { report: BugReport | null }) {
  const r = report?.reproduction ?? null;
  const reproduced = report?.outcome === "VERIFIED";
  return (
    <Panel id="verification" title="Fix Verification" icon={<ShieldCheck />} actions={<NotImplemented size="xs" />}>
      <p className="text-[13px] text-muted">{NOT_IMPLEMENTED_DETAIL.verification}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <Step label="Bug reproduced" status={<OutcomePill outcome={report?.outcome ?? null} size="xs" />} />
          <ArrowDown className="mx-auto size-3.5 text-faint" />
          <Step label="Fix applied" status={<NotImplemented size="xs" />} />
          <ArrowDown className="mx-auto size-3.5 text-faint" />
          <Step label="Reproduction passes" status={<NotImplemented size="xs" />} />
          <ArrowDown className="mx-auto size-3.5 text-faint" />
          <Step label="Regression suite passes" status={<NotImplemented size="xs" />} />
        </div>
        <div className="grid grid-cols-2 content-start gap-3">
          <div className="rounded-md border border-line p-3">
            <div className="text-xs text-muted">Before (real)</div>
            <div className="mt-1 font-mono text-[18px] text-fg">{r === null ? "—" : `${r.failures} / ${r.attempts}`}</div>
            <div className="text-xs text-faint">{r === null ? "not executed" : "attempts failed the expectation"}</div>
          </div>
          <div className="rounded-md border border-dashed border-line-strong p-3">
            <div className="text-xs text-muted">After</div>
            <div className="mt-1 font-mono text-[18px] text-faint">—</div>
            <div className="text-xs text-faint">no fix to run against</div>
          </div>
          <div className="col-span-2 rounded-md border border-dashed border-line-strong p-3">
            <div className="text-xs text-muted">Regression suite</div>
            <div className="mt-1 text-xs text-faint">Not run: there is no fix.</div>
          </div>
          <div className="col-span-2 flex items-center justify-between rounded-md border border-line bg-panel-2 p-3">
            <span className="text-xs text-muted">Result</span>
            <StatusPill status={reproduced ? "NO FIX · NOT VERIFIED" : "NOT VERIFIED"} tone="neutral" size="xs" />
          </div>
        </div>
      </div>
    </Panel>
  );
}
