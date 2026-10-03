import { listTemplates, PRICES, PRICES_AS_OF, PRICES_SOURCE, readSearchSettings, searchDataDir } from "@exegezis/search/light";
import { searchDir } from "@/lib/user-workspace";
import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { deleteTemplateAction } from "@/app/search-actions";
import { SearchSettingsForm, TemplateForm } from "@/components/search/settings-forms";
import { buttonClass, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { displayPath } from "@/lib/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.searchPage"))("metaTitle") };
}

/** Settings → Búsquedas (docs/10-search.md §5): cost limit, model and the person's own templates. */
export default async function SearchSettingsPage() {
  const dir = await searchDir();
  const [settings, templates, ts, t] = await Promise.all([readSearchSettings(dir), listTemplates(dir), getTranslations("settings"), getTranslations("settings.searchPage")]);
  const models = Object.entries(PRICES).map(([id, p]) => ({ id, label: p.label, price: t("price", { input: p.input, output: p.output }) }));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="text-[12px] text-accent-text hover:underline">
            {ts("back")}
          </Link>
        }
        title={t("title")}
        description={t.rich("description", { dir: () => <Mono>{displayPath(dir ?? searchDataDir())}</Mono> })}
      />
      <Panel title={t("costModel")}>
        <SearchSettingsForm maxCostUsd={settings.maxCostUsd} model={settings.model} models={models} />
        <p className="mt-3 text-[12px] text-faint">
          {t("pricesFrom")}{" "}
          <a href={PRICES_SOURCE} target="_blank" rel="noreferrer" className="underline">
            {t("officialPage")}
          </a>
          {t("reviewed", { date: PRICES_AS_OF })}
        </p>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t("templates", { count: templates.length })} bodyClassName="p-0">
          <ul>
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">
                    <span translate="no">{tpl.name}</span>{" "}
                    <span className="font-mono text-[11px] font-normal text-faint">
                      {tpl.id} {t("version", { version: tpl.version })}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted">
                    {tpl.origin === "repository" ? t("fromRepo") : t("yours")} · {tpl.meaning === null ? t("noAi") : tpl.exact === null ? t("meaningOnly") : t("exactPlusMeaning")}
                  </div>
                  {tpl.exact !== null && (tpl.exact.terms.length > 0 || tpl.exact.phrases.length > 0) && (
                    <div className="truncate text-[12px] text-faint" translate="no">
                      {[...tpl.exact.terms, ...tpl.exact.phrases.map((p) => `"${p}"`)].join(", ")}
                    </div>
                  )}
                </div>
                {tpl.origin === "user" && (
                  <form action={deleteTemplateAction}>
                    <input type="hidden" name="id" value={tpl.id} />
                    <button type="submit" className={buttonClass("ghost", "sm")} aria-label={t("deleteTemplate", { name: tpl.name })}>
                      <Trash2 aria-hidden />
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t("newTemplate")}>
          <TemplateForm />
        </Panel>
      </div>
    </div>
  );
}
