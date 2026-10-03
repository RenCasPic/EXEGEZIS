import { LIMITS, listWaitlist, usage } from "@exegezis/accounts";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { joinWaitlistAction, linkIdentityAction, unlinkIdentityAction } from "@/app/account-actions";
import { signOutEverywhereAction } from "@/app/auth-actions";
import { DeleteAccountForm, EmailForm, PasswordForm, ProfileForm } from "@/components/account/settings-forms";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { requireAccount } from "@/lib/account";
import { config, db } from "@/lib/auth";
import { siteLinks } from "@/lib/links";
import { param } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.settings"))("title") };
}

const LIMIT_REASONS = ["inspectionsPerMonth", "pagesPerInspection", "sites", "meaningSearch", "aiBalance"] as const;
const REFUSED = ["privateAddress", "serverPath", "visibleWindow"] as const;
const PROVIDERS = [
  ["google", "Google"],
  ["github", "GitHub"],
] as const;

function Bar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null || limit === 0) return null;
  const share = Math.min(1, used / limit);
  return (
    <span className="h-1.5 w-full overflow-hidden rounded-full bg-empty" aria-hidden>
      <span className={`block h-full rounded-full ${share >= 1 ? "bg-bad" : share >= 0.8 ? "bg-warn" : "bg-accent"}`} style={{ width: `${share * 100}%` }} />
    </span>
  );
}

/** Settings → Account: profile, security, plan and usage, data. */
export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ user, profile }, params, t, plans, locale] = await Promise.all([requireAccount(), searchParams, getTranslations("account.settings"), getTranslations("account.plans"), getLocale()]);
  const [used, waitlist] = await Promise.all([usage(db(), user.id), listWaitlist(db(), user.id)]);
  const limits = LIMITS[profile.plan];
  const links = siteLinks(locale === "es" ? "es" : "en");
  const limitReason = LIMIT_REASONS.find((r) => r === param(params, "limit"));
  const refused = REFUSED.find((r) => r === param(params, "refused"));
  const providers = config().oauthProviders;
  const identities = user.user.identities ?? [];
  const waiting = new Set(waitlist.map((w) => w.plan));
  const num = (n: number | null) => (n === null ? t("plan.unlimited") : String(n));

  const rows: { label: string; used: string; bar: { used: number; limit: number | null } | null }[] = [
    { label: t("plan.inspections"), used: t("plan.usedOf", { used: used.inspections, limit: num(limits.inspectionsPerMonth) }), bar: { used: used.inspections, limit: limits.inspectionsPerMonth } },
    { label: t("plan.pages"), used: t("plan.pagesValue", { pages: used.pages, limit: num(limits.pagesPerInspection) }), bar: null },
    { label: t("plan.sites"), used: t("plan.usedOf", { used: used.sites.length, limit: num(limits.sites) }), bar: { used: used.sites.length, limit: limits.sites } },
    {
      label: t("plan.ai"),
      used: !limits.meaningSearch ? t("plan.aiNotIncluded") : t("plan.aiValue", { used: used.aiUsd.toFixed(2), limit: limits.aiBalanceUsd === null ? t("plan.unlimited") : limits.aiBalanceUsd.toFixed(2) }),
      bar: limits.meaningSearch ? { used: used.aiUsd, limit: limits.aiBalanceUsd } : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="text-[12px] text-accent-text hover:underline">
            {t("back")}
          </Link>
        }
        title={t("title")}
        description={t("description", { email: user.email })}
      />

      {(limitReason !== undefined || refused !== undefined) && (
        <p role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-[14px] text-fg">
          {limitReason !== undefined ? t("limitReached") : t(`refused.${refused ?? "privateAddress"}`)}
          {limitReason !== undefined && (
            <a href={links.plans} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover">
              {t("seePlans")}
            </a>
          )}
        </p>
      )}

      <div id="profile">
        <Panel title={t("profile")}>
          <ProfileForm displayName={profile.displayName} locale={profile.locale} theme={profile.theme} />
        </Panel>
      </div>

      <div id="security" className="flex flex-col gap-5">
        <Panel title={t("security")}>
          <div className="flex flex-col gap-8">
            <EmailForm email={user.email} />
            <div className="border-t border-line pt-6">
              <h3 className="mb-4 text-[14px] font-semibold text-heading">{t("password")}</h3>
              <PasswordForm hasPassword={user.providers.includes("email")} />
            </div>
            <div className="border-t border-line pt-6">
              <h3 className="mb-1 text-[14px] font-semibold text-heading">{t("linked")}</h3>
              <p className="mb-4 text-[13px] text-muted">{providers.length === 0 ? t("linkedNone") : t("linkedHint")}</p>
              <ul className="flex flex-col gap-2">
                {PROVIDERS.filter(([id]) => providers.includes(id) || user.providers.includes(id)).map(([id, name]) => {
                  const linked = user.providers.includes(id);
                  return (
                    <li key={id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-[14px]">
                      <span className="text-fg">
                        {name} · <span className={linked ? "text-ok" : "text-muted"}>{linked ? t("linkedYes") : t("linkedNo")}</span>
                      </span>
                      <form action={linked ? unlinkIdentityAction : linkIdentityAction}>
                        <input type="hidden" name="provider" value={id} />
                        <button type="submit" disabled={linked && identities.length <= 1} className="rounded-lg border-[1.5px] border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-hover disabled:opacity-50">
                          {linked ? t("unlink") : t("link")}
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="border-t border-line pt-6">
              <h3 className="mb-1 text-[14px] font-semibold text-heading">{t("sessions")}</h3>
              <p className="mb-4 text-[13px] text-muted">{t("sessionsHint")}</p>
              <form action={signOutEverywhereAction}>
                <button type="submit" className="rounded-lg border-[1.5px] border-line-strong px-4 py-2 text-[14px] font-medium text-fg hover:bg-hover" data-sign-out-everywhere>
                  {t("signOutEverywhere")}
                </button>
              </form>
            </div>
          </div>
        </Panel>
      </div>

      <div id="plan">
        <Panel
          title={t("planTitle", { plan: plans(profile.plan) })}
          actions={
            <a href={links.plans} className="text-[13px] font-medium text-accent-text hover:underline">
              {t("seePlans")}
            </a>
          }
        >
          <div className="flex flex-col gap-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              {rows.map((r) => (
                <div key={r.label} className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
                  <dt className="text-[12px] text-muted">{r.label}</dt>
                  <dd className="text-[15px] font-medium text-fg">{r.used}</dd>
                  {r.bar !== null && <Bar used={r.bar.used} limit={r.bar.limit} />}
                </div>
              ))}
            </dl>
            <p className="text-[12px] text-muted">{t("plan.monthNote")}</p>
            {profile.plan === "free" && (
              <div className="flex flex-col gap-2 border-t border-line pt-4">
                <p className="text-[13px] text-fg">{t("plan.paymentsSoon")}</p>
                {param(params, "notice") === "waitlist" && (
                  <p role="status" className="text-[13px] text-ok">
                    {t("plan.waitlistJoined")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(["pro", "team"] as const).map((p) =>
                    waiting.has(p) ? (
                      <span key={p} className="rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-[13px] text-muted">
                        {t("plan.onWaitlist", { plan: plans(p) })}
                      </span>
                    ) : (
                      <form key={p} action={joinWaitlistAction}>
                        <input type="hidden" name="plan" value={p} />
                        <button type="submit" className="rounded-lg border-[1.5px] border-panel-border px-3 py-1.5 text-[13px] font-medium text-accent-text hover:bg-hover">
                          {t("plan.notifyMe", { plan: plans(p) })}
                        </button>
                      </form>
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div id="data">
        <Panel title={t("data")}>
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="mb-1 text-[14px] font-semibold text-heading">{t("export.title")}</h3>
              <p className="mb-3 text-[13px] text-muted">{t("export.body")}</p>
              <a href="/api/account/export" className="inline-flex rounded-lg border-[1.5px] border-line-strong px-4 py-2 text-[14px] font-medium text-fg hover:bg-hover" data-export>
                {t("export.button")}
              </a>
            </div>
            <div className="border-t border-line pt-6">
              <h3 className="mb-3 text-[14px] font-semibold text-bad">{t("delete.title")}</h3>
              <DeleteAccountForm email={user.email} />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
