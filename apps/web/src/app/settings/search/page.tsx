import { listTemplates, PRICES, PRICES_AS_OF, PRICES_SOURCE, readSearchSettings, searchDataDir } from "@exegezis/search/light";
import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteTemplateAction } from "@/app/search-actions";
import { SearchSettingsForm, TemplateForm } from "@/components/search/settings-forms";
import { buttonClass, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { displayPath } from "@/lib/workspace";

export const metadata: Metadata = { title: "Búsquedas · Ajustes" };

/** Settings → Búsquedas (docs/10-search.md §5): cost limit, model and the person's own templates. */
export default async function SearchSettingsPage() {
  const [settings, templates] = await Promise.all([readSearchSettings(), listTemplates()]);
  const models = Object.entries(PRICES).map(([id, p]) => ({ id, label: p.label, price: `${p.input} / ${p.output} USD por millón de tokens` }));
  return (
    <div lang="es" className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="text-[12px] text-accent-text hover:underline">
            ← Ajustes
          </Link>
        }
        title="Búsquedas"
        description={
          <>
            Límite de coste, modelo y tus plantillas. Se guardan en <Mono>{displayPath(searchDataDir())}</Mono>, fuera de runs/.
          </>
        }
      />
      <Panel title="Coste y modelo">
        <SearchSettingsForm maxCostUsd={settings.maxCostUsd} model={settings.model} models={models} />
        <p className="mt-3 text-[12px] text-faint">
          Precios de{" "}
          <a href={PRICES_SOURCE} target="_blank" rel="noreferrer" className="underline">
            la página oficial
          </a>
          , revisados el {PRICES_AS_OF}.
        </p>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`Plantillas (${templates.length})`} bodyClassName="p-0">
          <ul>
            {templates.map((t) => (
              <li key={t.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">
                    {t.name} <span className="font-mono text-[11px] font-normal text-faint">{t.id} v{t.version}</span>
                  </div>
                  <div className="text-[12px] text-muted">
                    {t.origin === "repository" ? "Del repositorio" : "Tuya"} · {t.meaning === null ? "sin IA" : t.exact === null ? "solo por significado (IA)" : "exacta + por significado opcional"}
                  </div>
                  {t.exact !== null && (t.exact.terms.length > 0 || t.exact.phrases.length > 0) && (
                    <div className="truncate text-[12px] text-faint">
                      {[...t.exact.terms, ...t.exact.phrases.map((p) => `"${p}"`)].join(", ")}
                    </div>
                  )}
                </div>
                {t.origin === "user" && (
                  <form action={deleteTemplateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className={buttonClass("ghost", "sm")} aria-label={`Borrar la plantilla ${t.name}`}>
                      <Trash2 aria-hidden />
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Nueva plantilla">
          <TemplateForm />
        </Panel>
      </div>
    </div>
  );
}
