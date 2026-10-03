"use client";

import { AlertTriangle, Loader2, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { PlansLink } from "@/components/account/plans-link";
import { useActionState, useState } from "react";
import { startInvestigation, type StartState } from "@/app/actions";
import { EngineProblem } from "@/components/ui/copy-command";
import { buttonClass } from "@/components/ui/primitives";

const field = "w-full rounded-md border border-line-strong bg-field px-3 py-2 text-[13px] text-fg placeholder:text-faint";
const labelClass = "mb-1.5 flex items-center gap-2 text-[13px] font-medium text-fg";

export function StartForm({
  projects,
  credentials,
  defaultBaseUrl,
}: {
  projects: string[];
  credentials: boolean;
  defaultBaseUrl: string;
}) {
  const t = useTranslations("investigations.new");
  const [state, action, pending] = useActionState<StartState, FormData>(startInvestigation, { error: null });
  const [baseUrl, setBaseUrl] = useState(state.fields?.baseUrl ?? defaultBaseUrl);
  const f = state.fields;

  return (
    <form action={action} className="flex flex-col gap-5">
      <div>
        <label htmlFor="symptom" className={labelClass}>
          {t("symptom")}
        </label>
        <textarea
          id="symptom"
          name="symptom"
          required
          minLength={12}
          rows={5}
          defaultValue={f?.symptom ?? ""}
          placeholder={t("symptomPlaceholder")}
          className={field}
        />
        <p className="mt-1.5 text-xs text-faint">{t("symptomHelp")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="baseUrl" className={labelClass}>
            {t("targetUrl")}
          </label>
          <input id="baseUrl" name="baseUrl" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={`${field} font-mono`} />
          <p className="mt-1.5 text-xs text-faint">{t("targetHelp")}</p>
        </div>
        <div>
          <label htmlFor="project" className={labelClass}>
            {t("project")}
          </label>
          <select id="project" name="project" defaultValue={f?.project ?? projects[0] ?? ""} className={field}>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="">{t("unassigned")}</option>
          </select>
        </div>
        <div>
          <label htmlFor="runs" className={labelClass}>
            {t("attempts")}
          </label>
          <select id="runs" name="runs" defaultValue={f?.runs ?? "5"} className={field}>
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {t("runs", { count: n })}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-faint">{t("attemptsHelp")}</p>
        </div>
      </div>

      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">{t("optional")}</summary>
        <div className="grid gap-4 border-t border-line p-3 md:grid-cols-2">
          <div>
            <label htmlFor="expected" className={labelClass}>
              {t("expected")}
            </label>
            <textarea id="expected" name="expected" rows={2} defaultValue={f?.expected ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor="actual" className={labelClass}>
              {t("actual")}
            </label>
            <textarea id="actual" name="actual" rows={2} defaultValue={f?.actual ?? ""} className={field} />
          </div>
          <p className="text-xs text-faint md:col-span-2">{t("optionalHelp")}</p>
        </div>
      </details>

      <div className="rounded-md border border-line bg-panel-2 p-3 text-xs text-muted">
        <div className="mb-1 font-medium text-fg">{t("whatHappens")}</div>
        {t("whatHappensBody", { command: "exegezis ai-verify" })}
      </div>

      {!credentials && (
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-bg p-3 text-[13px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {t("noCredentials")}
        </div>
      )}
      {state.error !== null &&
        (state.remedy !== undefined ? (
          <EngineProblem message={state.error} remedy={state.remedy} />
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/40 bg-bad-bg p-3 text-[13px] text-bad">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {state.error}
            <PlansLink href={state.plansUrl} />
          </div>
        ))}

      <div className="flex justify-end">
        <button type="submit" disabled={pending || !credentials} className={buttonClass("primary")}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />}
          {t("start")}
        </button>
      </div>
    </form>
  );
}
