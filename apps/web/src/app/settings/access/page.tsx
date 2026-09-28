import { AppWindow, KeyRound, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { deleteAccessAction, openAccessWindowAction, robotsOwnerAction } from "@/app/access-actions";
import { HttpAuthForm, WafTokenForm } from "@/components/access/forms";
import { buttonClass, EmptyState, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { accessState, listAccess } from "@/lib/access";
import { getFormat } from "@/i18n/server";
import { displayPath } from "@/lib/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("access"))("metaTitle") };
}

const STATE = {
  active: { label: "ACTIVE", tone: "ok" },
  expired: { label: "EXPIRED", tone: "bad" },
  none: { label: "NO_ACCESS", tone: "q" },
} as const;

const input = "h-9 w-full rounded-md border border-line-strong bg-panel px-2.5 font-mono text-[13px] text-fg";

/**
 * Settings → Accesos (docs/09-access.md §5): metadata of the saved access
 * (index.json) only. The web never decrypts or shows a secret.
 */
export default async function AccessSettingsPage() {
  const [{ dir, entries }, t, f, ts] = await Promise.all([listAccess(), getTranslations("access"), getFormat(), getTranslations("settings")]);
  const windows = process.platform === "win32";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="text-[12px] text-accent-text hover:underline">
            {ts("back")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />

      <p className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-fg">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <span>
          {windows ? t("storageWindows") : t("storageOther")} {t("folder")} <Mono>{displayPath(dir)}</Mono>
        </span>
      </p>

      {entries.length === 0 ? (
        <Panel title={t("sites")}>
          <EmptyState icon={<KeyRound />} title={t("none")}>
            {t("noneBody")}
          </EmptyState>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-4" aria-label={t("sitesLabel")}>
          {entries.map((e) => {
            const state = accessState(e);
            return (
              <li key={e.origin}>
                <Panel
                  title={<span className="break-all font-mono">{e.origin}</span>}
                  actions={<StatusPill status={STATE[state].label} tone={STATE[state].tone} size="xs" />}
                >
                  <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                    <div>
                      <dt className="text-[12px] text-muted">{t("kinds")}</dt>
                      <dd className="text-fg">{e.kinds.length === 0 ? "—" : e.kinds.map((k) => t(`kind.${k}`)).join(" · ")}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">{t("lastUsed")}</dt>
                      <dd className="text-fg" title={e.lastUsedAt === null ? undefined : f.absolute(e.lastUsedAt)}>
                        {e.lastUsedAt === null ? t("never") : f.relative(e.lastUsedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">{t("expiry")}</dt>
                      <dd className="text-fg">
                        {e.expired ? t("expiredValue") : e.expiresAt === null ? t("noDate") : f.absolute(e.expiresAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">{t("saved")}</dt>
                      <dd className="text-fg">{f.absolute(e.updatedAt)}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={openAccessWindowAction}>
                      <input type="hidden" name="url" value={`${e.origin}/`} />
                      <input type="hidden" name="block" value={state === "expired" ? "SESSION_EXPIRED" : "LOGIN_WALL"} />
                      <button type="submit" className={buttonClass(state === "expired" ? "primary" : "secondary")}>
                        <AppWindow aria-hidden /> {e.kinds.includes("session") ? t("renew") : t("signIn")}
                      </button>
                    </form>
                    <form action={deleteAccessAction}>
                      <input type="hidden" name="url" value={`${e.origin}/`} />
                      <button type="submit" className={buttonClass("secondary")}>
                        <Trash2 aria-hidden /> {t("delete")}
                      </button>
                    </form>
                  </div>

                  <form action={robotsOwnerAction} className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-fg">
                    <input type="hidden" name="url" value={`${e.origin}/`} />
                    <input type="hidden" name="robotsOwner" value={e.settings.robotsOwner ? "no" : "yes"} />
                    <span>
                      {t("robots")} <strong>{e.settings.robotsOwner ? t("yes") : t("no")}</strong>
                    </span>
                    <button type="submit" className={buttonClass("ghost")}>
                      {e.settings.robotsOwner ? t("disable") : t("enable")}
                    </button>
                  </form>
                  {e.settings.unsafeLinkPatterns.length > 0 && (
                    <p className="mt-2 text-[12px] text-muted">
                      {t("unsafeLinks")} <Mono>{e.settings.unsafeLinkPatterns.join(", ")}</Mono>
                    </p>
                  )}

                  <details className="mt-4 rounded-md border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">{t("httpAuth")}</summary>
                    <div className="border-t border-line p-3">
                      <HttpAuthForm url={`${e.origin}/`} />
                    </div>
                  </details>
                  <details className="mt-2 rounded-md border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">{t("wafToken")}</summary>
                    <div className="border-t border-line p-3">
                      <WafTokenForm url={`${e.origin}/`} hasToken={e.kinds.includes("wafToken")} />
                    </div>
                  </details>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}

      <Panel title={t("addSite")}>
        <form action={openAccessWindowAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted">
            {t("loginUrl")}
            <input name="url" type="url" required placeholder={t("loginPlaceholder")} className={input} />
          </label>
          <input type="hidden" name="block" value="LOGIN_WALL" />
          <button type="submit" className={buttonClass("primary")}>
            <AppWindow aria-hidden /> {t("openWindow")}
          </button>
        </form>
        <p className="mt-2 text-[12px] text-muted">{t("windowHelp")}</p>
      </Panel>
    </div>
  );
}
