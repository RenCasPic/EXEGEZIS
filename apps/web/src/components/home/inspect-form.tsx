"use client";

import { AlertTriangle, ArrowRight, Globe, KeyRound, Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PlansLink } from "@/components/account/plans-link";
import { useActionState, useEffect, useState } from "react";
import { accessStatusAction } from "@/app/access-actions";
import { startInspectionAction, type InspectState } from "@/app/actions";
import { EngineProblem } from "@/components/ui/copy-command";
import { cn } from "@/lib/cn";
import { hostOf, remember, remembered } from "@/lib/site-permission";
import { BROWSER_CHANNEL_IDS, INSPECT_CHECKS, INSPECT_DEFAULTS, isLoopbackHost, type BrowserChannelId } from "@/lib/inspect-checks";

const ACCESS_KINDS = ["session", "httpCredentials", "wafToken"] as const;

const input = "h-9 w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-fg";

/**
 * Starts a real `exegezis inspect` job. Before the first inspection of an
 * external (non-loopback) host the user confirms, in one line, that they may
 * inspect it; the server refuses an external host without that confirmation.
 */
export function InspectForm({ initialUrl = "" }: { initialUrl?: string }) {
  const t = useTranslations("home.form");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState<InspectState, FormData>(startInspectionAction, { error: null });
  const [url, setUrl] = useState(initialUrl);
  const [maxPages, setMaxPages] = useState("");
  const [maxDepth, setMaxDepth] = useState("");
  const [runs, setRuns] = useState("");
  const [checks, setChecks] = useState<string[]>([]);
  const [storageState, setStorageState] = useState("");
  const [strict, setStrict] = useState(false);
  const [ignoreRobots, setIgnoreRobots] = useState(false);
  const [browserChannel, setBrowserChannel] = useState<BrowserChannelId>("auto");
  const [confirmed, setConfirmed] = useState(false);
  const [known, setKnown] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [access, setAccess] = useState<Awaited<ReturnType<typeof accessStatusAction>>>(null);
  const [advanced, setAdvanced] = useState(false);

  const host = hostOf(url);
  const external = host !== null && !isLoopbackHost(new URL(url.trim()).hostname);
  useEffect(() => {
    setKnown(host !== null && remembered(host));
    setConfirmed(false);
  }, [host]);
  const needsPermission = external && !known;

  // Saved access for this origin (metadata only), to say before launching whether it is used or has expired.
  useEffect(() => {
    setAccess(null);
    if (host === null) return;
    let live = true;
    const timer = setTimeout(() => {
      accessStatusAction(url.trim())
        .then((a) => {
          if (live) setAccess(a);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Only the origin matters: the url is read when the host changes.
  }, [host]);
  const accessKinds = access === null ? [] : access.kinds.map((k) => ((ACCESS_KINDS as readonly string[]).includes(k) ? t(`inspect.accessKind.${k as (typeof ACCESS_KINDS)[number]}`) : k));

  // The design's chips: pages, depth, repetitions and read-only; then whatever the advanced options change.
  const pages = Number(maxPages === "" ? INSPECT_DEFAULTS.maxPages : maxPages);
  const runCount = Number(runs === "" ? INSPECT_DEFAULTS.runs : runs);
  const chips: { key: string; wide: string; narrow?: string; lock?: boolean; desktopOnly?: boolean }[] = [
    { key: "pages", wide: t("chipUpTo", { count: pages }), narrow: t("chipPages", { count: pages }) },
    { key: "depth", wide: t("chipDepth", { depth: maxDepth === "" ? INSPECT_DEFAULTS.maxDepth : maxDepth }), desktopOnly: true },
    { key: "runs", wide: t("inspect.chipRuns", { count: runCount }) },
    { key: "readonly", wide: strict ? t("inspect.chipStrict") : t("inspect.chipReadonly"), lock: true },
    ...(checks.length > 0 && checks.length < INSPECT_CHECKS.length ? [{ key: "checks", wide: t("inspect.chipChecks", { count: checks.length }) }] : []),
    ...(ignoreRobots ? [{ key: "robots", wide: t("chipIgnoreRobots") }] : []),
    ...(browserChannel === "auto" ? [] : [{ key: "browser", wide: t("inspect.chipBrowser", { browser: browserChannel }) }]),
    ...(access !== null && accessKinds.length > 0 ? [{ key: "session", wide: noSession ? t("chipAnonymous") : t("chipSession") }] : []),
  ];

  return (
    <form
      action={(data) => {
        if (host !== null && external && (known || confirmed)) remember(host);
        action(data);
      }}
      className="flex flex-col gap-4 xl:gap-6"
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-end xl:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 xl:gap-2">
          <label htmlFor="inspect-url" className="text-[13px] font-medium text-fg">
            {t("siteUrl")}
          </label>
          <div className="flex h-[52px] items-center gap-2.5 rounded-xl border-[1.5px] border-line-strong bg-field px-3.5 focus-within:border-accent xl:h-14 xl:gap-3 xl:px-4">
            <Globe className="size-[18px] shrink-0 text-muted xl:size-5" strokeWidth={1.8} aria-hidden />
            <input
              id="inspect-url"
              name="url"
              type="url"
              inputMode="url"
              required
              autoComplete="url"
              spellCheck={false}
              placeholder={t("urlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-describedby="inspect-permission"
              className="min-w-0 flex-1 bg-transparent font-mono text-[15px] text-fg placeholder:text-muted xl:text-[16px]"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={pending || (needsPermission && !confirmed)}
          className="flex h-[52px] items-center justify-center gap-2.5 rounded-xl bg-accent px-7 text-[16px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60 xl:h-14"
        >
          {pending ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : null}
          {t("inspect.submit")}
          <ArrowRight className="hidden size-[18px] xl:block" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted xl:gap-2 xl:text-[13px]">
          <ul className="contents" aria-label={t("inspect.options")}>
            {chips.map((c) => (
              <li key={c.key} className={cn("flex items-center gap-1.5 rounded-full border border-line bg-sunken px-[9px] py-1 xl:px-2.5 xl:py-[5px]", c.desktopOnly === true && "max-xl:hidden")}>
                {c.lock === true && <Lock className="hidden size-3 xl:block" strokeWidth={2} aria-hidden />}
                {c.narrow === undefined ? (
                  c.wide
                ) : (
                  <>
                    <span className="xl:hidden">{c.narrow}</span>
                    <span className="max-xl:hidden">{c.wide}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} aria-controls="inspect-advanced" className="px-1 py-1 font-medium text-accent-text hover:underline xl:px-1.5 xl:py-[5px]">
            <span className="xl:hidden">{t("advancedShort")}</span>
            <span className="max-xl:hidden">{t("advanced")}</span>
          </button>
        </div>
        {!needsPermission && (
          <p id="inspect-permission" className="text-[13px] text-muted max-xl:sr-only">
            {tc("permission.text")}
          </p>
        )}
      </div>

      {access !== null && accessKinds.length > 0 && !noSession && (
        <p role={access.expired ? "alert" : undefined} className={cn("flex items-start gap-1.5 text-[13px]", access.expired ? "rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-fg" : "text-muted")}>
          {access.expired ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> : <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>
            {access.expired
              ? t.rich("inspect.expired", {
                  origin: () => <span className="font-mono">{access.origin}</span>,
                  link: (chunks) => (
                    <Link href="/settings/access" className="text-accent-text underline">
                      {chunks}
                    </Link>
                  ),
                })
              : t.rich("inspect.willUse", { kinds: accessKinds.join(", "), origin: () => <span className="font-mono">{access.origin}</span> })}
          </span>
        </p>
      )}

      {needsPermission && (
        <label id="inspect-permission" className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-[13px] text-fg">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            {tc("permission.text")} {t.rich("inspect.confirm", { host: () => <span className="font-mono">{host}</span> })}
          </span>
        </label>
      )}
      <input type="hidden" name="permission" value={!external || known || confirmed ? "on" : ""} />

      <div id="inspect-advanced" hidden={!advanced} className="rounded-xl border border-line">
        <p className="border-b border-line px-3 py-2 text-[12px] text-muted">{t("inspect.readonlyNote")}</p>
        <div className="grid gap-4 p-3 sm:grid-cols-3">
          {(
            [
              ["maxPages", t("pages"), maxPages, setMaxPages, 1, 500, INSPECT_DEFAULTS.maxPages],
              ["maxDepth", t("depth"), maxDepth, setMaxDepth, 0, 10, INSPECT_DEFAULTS.maxDepth],
              ["runs", t("inspect.runs"), runs, setRuns, 1, 20, INSPECT_DEFAULTS.runs],
            ] as const
          ).map(([name, label, value, set, min, max, def]) => (
            <label key={name} className="flex flex-col gap-1 text-[12px] text-muted">
              {label}
              <input name={name} type="number" min={min} max={max} placeholder={String(def)} value={value} onChange={(e) => set(e.target.value)} className={`${input} font-mono`} />
            </label>
          ))}
          <fieldset className="sm:col-span-3">
            <legend className="mb-1 text-[12px] text-muted">{t("inspect.checks")}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {INSPECT_CHECKS.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="checkbox"
                    name="checks"
                    value={c.id}
                    checked={checks.includes(c.id)}
                    onChange={(e) => setChecks((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)))}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {t(`inspect.checkLabel.${c.id}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-3">
            {t("inspect.storageState")}
            <input name="storageState" value={storageState} onChange={(e) => setStorageState(e.target.value)} placeholder={t("inspect.storagePlaceholder")} className={`${input} font-mono`} />
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="strictReadonly" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("inspect.strict")}</span>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-3">
            {t("browser")}
            <select name="browserChannel" value={browserChannel} onChange={(e) => setBrowserChannel(e.target.value as BrowserChannelId)} className={input}>
              {BROWSER_CHANNEL_IDS.map((c) => (
                <option key={c} value={c}>
                  {tc(`browserChannel.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="ignoreRobots" checked={ignoreRobots} onChange={(e) => setIgnoreRobots(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("inspect.ignoreRobots")}</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="noSession" checked={noSession} onChange={(e) => setNoSession(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("inspect.anonymous")}</span>
          </label>
        </div>
      </div>

      {state.error !== null &&
        (state.remedy !== undefined ? (
          <EngineProblem message={state.error} remedy={state.remedy} />
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-bg p-3 text-[13px] text-bad">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.error}
            <PlansLink href={state.plansUrl} />
          </div>
        ))}
    </form>
  );
}
