"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveSearchSettingsAction, saveTemplateAction, type SettingsState } from "@/app/search-actions";
import { buttonClass } from "@/components/ui/primitives";

const input = "h-9 w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-fg";

function Result({ state }: { state: SettingsState }) {
  if (state.error !== null)
    return (
      <p role="alert" className="flex items-start gap-1.5 text-[13px] text-bad">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  if (state.done !== undefined) return <p className="text-[13px] text-ok">{state.done}</p>;
  return null;
}

export function SearchSettingsForm({ maxCostUsd, model, models }: { maxCostUsd: number; model: string; models: { id: string; label: string; price: string }[] }) {
  const t = useTranslations("settings.searchPage.form");
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSearchSettingsAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("maxCost")}
          <input name="maxCostUsd" type="number" step="0.01" min="0.01" max="100" defaultValue={maxCostUsd} required className={`${input} font-mono`} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {t("model")}
          <select name="model" defaultValue={model} className={input}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.price})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[12px] text-muted">{t("costHelp")}</p>
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} {t("save")}
      </button>
      <Result state={state} />
    </form>
  );
}

export function TemplateForm() {
  const t = useTranslations("settings.searchPage.form");
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveTemplateAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        {t("name")}
        <input name="name" required maxLength={120} placeholder={t("namePlaceholder")} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        {t("description")}
        <input name="description" maxLength={1000} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        {t("terms")}
        <input name="terms" placeholder={t("termsPlaceholder")} className={input} />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-fg">
        <input type="checkbox" name="variants" className="size-4 accent-[var(--accent)]" /> {t("variants")}
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        {t("meaning")}
        <textarea name="meaning" rows={2} className="w-full rounded-md border border-line-strong bg-field px-2.5 py-2 text-[13px] text-fg" />
      </label>
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} {t("saveTemplate")}
      </button>
      <Result state={state} />
    </form>
  );
}
