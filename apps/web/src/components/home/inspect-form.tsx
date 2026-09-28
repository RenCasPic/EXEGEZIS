"use client";

import { AlertTriangle, ChevronDown, Globe, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { accessStatusAction } from "@/app/access-actions";
import { startInspectionAction, type InspectState } from "@/app/actions";
import { EngineProblem } from "@/components/ui/copy-command";
import { buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { hostOf, remember, remembered } from "@/lib/site-permission";
import { BROWSER_CHANNEL_IDS, INSPECT_CHECKS, INSPECT_DEFAULTS, isLoopbackHost, type BrowserChannelId } from "@/lib/inspect-checks";

const ACCESS_KINDS = ["session", "httpCredentials", "wafToken"] as const;

const input = "h-9 w-full rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg";

/**
 * Starts a real `exegezis inspect` job. Before the first inspection of an
 * external (non-loopback) host the user confirms, in one line, that they may
 * inspect it; the server refuses an external host without that confirmation.
 */
export function InspectForm() {
  const t = useTranslations("home.form");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState<InspectState, FormData>(startInspectionAction, { error: null });
  const [url, setUrl] = useState("");
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

  const chips = [
    t("chipPages", { count: Number(maxPages === "" ? INSPECT_DEFAULTS.maxPages : maxPages) }),
    t("chipDepth", { depth: maxDepth === "" ? INSPECT_DEFAULTS.maxDepth : maxDepth }),
    t("inspect.chipRuns", { count: Number(runs === "" ? INSPECT_DEFAULTS.runs : runs) }),
    strict ? t("inspect.chipStrict") : t("inspect.chipReadonly"),
    ...(checks.length > 0 && checks.length < INSPECT_CHECKS.length ? [t("inspect.chipChecks", { count: checks.length })] : []),
    ...(ignoreRobots ? [t("chipIgnoreRobots")] : []),
    ...(browserChannel === "auto" ? [] : [t("inspect.chipBrowser", { browser: browserChannel })]),
    ...(access !== null && accessKinds.length > 0 ? [noSession ? t("chipAnonymous") : t("chipSession")] : []),
  ];

  return (
    <form
      action={(data) => {
        if (host !== null && external && (known || confirmed)) remember(host);
        action(data);
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor="inspect-url" className="text-[13px] font-medium text-fg">
        {t("siteUrl")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Globe className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden />
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
            className="h-14 w-full rounded-lg border border-line-strong bg-panel pr-4 pl-12 font-mono text-[15px] text-fg placeholder:font-sans placeholder:text-faint"
          />
        </div>
        <button type="submit" disabled={pending || (needsPermission && !confirmed)} className={cn(buttonClass("primary"), "h-14 px-6 text-[15px]")}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t("inspect.submit")}
        </button>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label={t("inspect.options")}>
        {chips.map((c) => (
          <li key={c} className="rounded-full border border-line bg-sunken px-2.5 py-0.5 text-[12px] text-muted">
            {c}
          </li>
        ))}
      </ul>

      {access !== null && accessKinds.length > 0 && !noSession && (
        <p
          role={access.expired ? "alert" : undefined}
          className={cn("flex items-start gap-1.5 text-[13px]", access.expired ? "rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-fg" : "text-muted")}
        >
          {access.expired ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> : <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>
            {access.expired ? (
              t.rich("inspect.expired", {
                origin: () => <span className="font-mono">{access.origin}</span>,
                link: (chunks) => (
                  <Link href="/settings/access" className="text-accent-text underline">
                    {chunks}
                  </Link>
                ),
              })
            ) : (
              t.rich("inspect.willUse", { kinds: accessKinds.join(", "), origin: () => <span className="font-mono">{access.origin}</span> })
            )}
          </span>
        </p>
      )}

      {needsPermission ? (
        <label id="inspect-permission" className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-[13px] text-fg">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            {tc("permission.text")} {t.rich("inspect.confirm", { host: () => <span className="font-mono">{host}</span> })}
          </span>
        </label>
      ) : (
        <p id="inspect-permission" className="flex items-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {tc("permission.text")} {t("inspect.readonlyNote")}
        </p>
      )}
      <input type="hidden" name="permission" value={!external || known || confirmed ? "on" : ""} />

      <details className="group rounded-md border border-line">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[13px] text-muted hover:text-fg">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
          {t("advanced")}
        </summary>
        <div className="grid gap-4 border-t border-line p-3 sm:grid-cols-3">
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
      </details>

      {state.error !== null &&
        (state.remedy !== undefined ? (
          <EngineProblem message={state.error} remedy={state.remedy} />
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-bg p-3 text-[13px] text-bad">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.error}
          </div>
        ))}
    </form>
  );
}
