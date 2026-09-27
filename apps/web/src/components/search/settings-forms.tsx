"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { saveSearchSettingsAction, saveTemplateAction, type SettingsState } from "@/app/search-actions";
import { buttonClass } from "@/components/ui/primitives";

const input = "h-9 w-full rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg";

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
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSearchSettingsAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Límite de coste por búsqueda por significado (USD)
          <input name="maxCostUsd" type="number" step="0.01" min="0.01" max="100" defaultValue={maxCostUsd} required className={`${input} font-mono`} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Modelo
          <select name="model" defaultValue={model} className={input}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.price})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[12px] text-muted">Antes de llamar a la IA se estima el coste; si supera el límite no se envía nada y se te pide aprobarlo. También vale para «Sugerir términos relacionados».</p>
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Guardar
      </button>
      <Result state={state} />
    </form>
  );
}

export function TemplateForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveTemplateAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Nombre
        <input name="name" required maxLength={120} placeholder="p. ej. Horarios y eventos" className={input} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Descripción (opcional)
        <input name="description" maxLength={1000} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Términos exactos (sin IA)
        <input name="terms" placeholder='horario, misa, "culto dominical", -cancelado' className={input} />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-fg">
        <input type="checkbox" name="variants" className="size-4 accent-[var(--accent)]" /> Con variantes
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Descripción por significado (opcional, usa IA)
        <textarea name="meaning" rows={2} className="w-full rounded-md border border-line-strong bg-panel px-2.5 py-2 text-[13px] text-fg" />
      </label>
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Guardar plantilla
      </button>
      <Result state={state} />
    </form>
  );
}
