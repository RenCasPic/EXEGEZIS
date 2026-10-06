import { listSites, OWNERSHIP_PAGES } from "@exegezis/accounts";
import { CheckCircle2, Globe, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { addSiteAction, removeSiteAction, verifySiteAction } from "@/app/site-actions";
import { buttonClass, CodeBlock, PageHeader, Panel } from "@/components/ui/primitives";
import { getFormat } from "@/i18n/server";
import { supabase } from "@/lib/auth";
import { param } from "@/lib/params";
import { VERIFICATION_NAME } from "@/lib/site-ownership";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.sitesPage"))("metaTitle") };
}

/** Settings → Sites: prove a site is yours (a meta tag or a DNS TXT record) to inspect more than 20 pages of it. */
export default async function SitesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const [sites, ts, t, f] = await Promise.all([listSites(await supabase()), getTranslations("settings"), getTranslations("settings.sitesPage"), getFormat()]);
  const focus = param(params, "site");
  const check = param(params, "check");
  const error = param(params, "error");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="text-[12px] text-accent-text hover:underline">
            {ts("back")}
          </Link>
        }
        title={t("title")}
        description={t("description", { pages: OWNERSHIP_PAGES })}
      />

      {error !== "" && (
        <p role="alert" className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[13px] text-bad">
          {t(error === "site" ? "errorSite" : "errorOrigin")}
        </p>
      )}

      <Panel title={t("add")}>
        <form action={addSiteAction} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="site" className="sr-only">
            {t("siteLabel")}
          </label>
          <input id="site" name="site" required defaultValue={focus} placeholder="tu-sitio.com" className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-panel px-3 font-mono text-[13px] text-fg" />
          <button type="submit" className={buttonClass("primary")}>
            {t("addButton")}
          </button>
        </form>
      </Panel>

      <Panel title={t("count", { count: sites.length })} bodyClassName="p-0">
        {sites.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted">{t("none")}</p>
        ) : (
          <ul>
            {sites.map((s) => (
              <li key={s.site} id={s.site} className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Globe className="size-4 text-faint" aria-hidden />
                  <span className="font-mono text-[13px] text-fg">{s.site}</span>
                  {s.verifiedAt !== null ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-ok">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t("verified", { method: t(`method.${s.method ?? "meta"}`), date: f.absolute(s.verifiedAt) })}
                    </span>
                  ) : (
                    <span className="text-[12px] text-warn">{t("pending")}</span>
                  )}
                  <form action={removeSiteAction} className="ml-auto">
                    <input type="hidden" name="site" value={s.site} />
                    <button type="submit" className={buttonClass("danger", "sm")} aria-label={t("remove", { site: s.site })}>
                      <Trash2 aria-hidden />
                    </button>
                  </form>
                </div>
                {s.verifiedAt === null && (
                  <div className="flex flex-col gap-3 text-[13px] text-muted">
                    <p>{t("howMeta")}</p>
                    <CodeBlock code={`<meta name="${VERIFICATION_NAME}" content="${s.token}">`} lineNumbers={false} />
                    <p>{t("howDns", { host: s.site })}</p>
                    <CodeBlock code={`${VERIFICATION_NAME}=${s.token}`} lineNumbers={false} />
                    {focus === s.site && check === "failed" && (
                      <p role="alert" className="text-bad">
                        {t("notFound")}
                      </p>
                    )}
                    <form action={verifySiteAction}>
                      <input type="hidden" name="site" value={s.site} />
                      <button type="submit" className={buttonClass("primary", "sm")}>
                        {t("check")}
                      </button>
                    </form>
                  </div>
                )}
                {focus === s.site && check === "ok" && (
                  <p role="status" className="text-[13px] text-ok">
                    {t("nowVerified", { pages: OWNERSHIP_PAGES })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
