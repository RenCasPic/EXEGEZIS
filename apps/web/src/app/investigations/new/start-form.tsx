"use client";

import { AlertTriangle, Loader2, Play } from "lucide-react";
import { useActionState, useState } from "react";
import { startInvestigation, type StartState } from "@/app/actions";
import { buttonClass } from "@/components/ui/primitives";
import { NotImplemented } from "@/components/ui/status";

const field = "w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-line-strong";
const labelClass = "mb-1.5 flex items-center gap-2 text-[13px] font-medium text-fg";

export function StartForm({
  projects,
  repository,
  credentials,
  defaultBaseUrl,
}: {
  projects: string[];
  repository: string;
  credentials: boolean;
  defaultBaseUrl: string;
}) {
  const [state, action, pending] = useActionState<StartState, FormData>(startInvestigation, { error: null });
  const [baseUrl, setBaseUrl] = useState(state.fields?.baseUrl ?? defaultBaseUrl);
  const f = state.fields;

  return (
    <form action={action} className="flex flex-col gap-5">
      <div>
        <label htmlFor="symptom" className={labelClass}>
          Symptom
        </label>
        <textarea
          id="symptom"
          name="symptom"
          required
          minLength={12}
          rows={5}
          defaultValue={f?.symptom ?? ""}
          placeholder="Describe what is going wrong, as a user would: what you did, and what happened."
          className={field}
        />
        <p className="mt-1.5 text-xs text-faint">This text is redacted for secrets and sent to the planner. It is the only thing the model sees besides the page structure.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="baseUrl" className={labelClass}>
            Target URL
          </label>
          <input id="baseUrl" name="baseUrl" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={`${field} font-mono`} />
          <p className="mt-1.5 text-xs text-faint">The application must already be running there.</p>
        </div>
        <div>
          <label htmlFor="project" className={labelClass}>
            Project
          </label>
          <select id="project" name="project" defaultValue={f?.project ?? projects[0] ?? ""} className={field}>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="">Unassigned</option>
          </select>
        </div>
        <div>
          <span className={labelClass}>
            Repository <NotImplemented size="xs" />
          </span>
          <div className={`${field} cursor-not-allowed font-mono text-muted`}>{repository}</div>
          <p className="mt-1.5 text-xs text-faint">Detected locally. Code is not read or analysed by any stage yet.</p>
        </div>
        <div>
          <label htmlFor="runs" className={labelClass}>
            Attempts
          </label>
          <select id="runs" name="runs" defaultValue={f?.runs ?? "5"} className={field}>
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} runs
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-faint">A bug is VERIFIED only if every attempt fails identically.</p>
        </div>
      </div>

      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">Optional context</summary>
        <div className="grid gap-4 border-t border-line p-3 md:grid-cols-2">
          <div>
            <label htmlFor="expected" className={labelClass}>
              Expected behavior
            </label>
            <textarea id="expected" name="expected" rows={2} defaultValue={f?.expected ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor="actual" className={labelClass}>
              Actual behavior
            </label>
            <textarea id="actual" name="actual" rows={2} defaultValue={f?.actual ?? ""} className={field} />
          </div>
          <p className="text-xs text-faint md:col-span-2">Appended to the symptom as “Expected: …” / “Actual: …”. Linking a related issue is not implemented.</p>
        </div>
      </details>

      <div className="rounded-md border border-line bg-panel-2 p-3 text-xs text-muted">
        <div className="mb-1 font-medium text-fg">What happens</div>
        Runs <code className="font-mono">exegezis ai-verify</code> locally: one planner call (Anthropic) writes a TestPlan, the deterministic engine validates it against the
        live page, executes it, reproduces it and writes a BugReport. The model never decides the verdict. Each run costs one planner call.
      </div>

      {!credentials && (
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-bg p-3 text-[13px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          No planner credentials found. Add EXEGEZIS_ANTHROPIC_API_KEY to the repository’s .env file to start investigations from here.
        </div>
      )}
      {state.error !== null && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/40 bg-bad-bg p-3 text-[13px] text-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending || !credentials} className={buttonClass("primary")}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />}
          Start Investigation
        </button>
      </div>
    </form>
  );
}
