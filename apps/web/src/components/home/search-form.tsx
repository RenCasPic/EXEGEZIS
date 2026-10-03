"use client";

import { AlertTriangle, ChevronDown, Globe, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { PlansLink } from "@/components/account/plans-link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { meaningEstimateAction, startSearchAction, suggestAction, suggestEstimateAction, type SearchState, type Suggestion } from "@/app/search-actions";
import { EngineProblem } from "@/components/ui/copy-command";
import { buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useFormat } from "@/i18n/client";
import { BROWSER_CHANNEL_IDS, isLoopbackHost, type BrowserChannelId } from "@/lib/inspect-checks";
import { SEARCH_DEFAULTS } from "@/lib/search-defaults";
import { hostOf, remember, remembered } from "@/lib/site-permission";

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  origin: "repository" | "user";
  hasExact: boolean;
  hasMeaning: boolean;
}

const input = "h-9 w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-fg";
const MODES = ["exact", "meaning", "template"] as const;
type Mode = (typeof MODES)[number];

/** «Buscar» (docs/10-search.md §6): starts a real `exegezis search` job. */
export function SearchForm({ templates }: { templates: TemplateOption[] }) {
  const t = useTranslations("home.form");
  const tc = useTranslations("common");
  const usd = useFormat().usd;
  const [state, action, pending] = useActionState<SearchState, FormData>(startSearchAction, { error: null });
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("exact");
  const [terms, setTerms] = useState("");
  const [meaning, setMeaning] = useState("");
  const [template, setTemplate] = useState(templates[0]?.id ?? "");
  const [withMeaning, setWithMeaning] = useState(false);
  const [variants, setVariants] = useState(false);
  const [excludePage, setExcludePage] = useState(false);
  const [maxPages, setMaxPages] = useState("");
  const [maxDepth, setMaxDepth] = useState("");
  const [runs, setRuns] = useState("");
  const [includeHidden, setIncludeHidden] = useState(true);
  const [noSession, setNoSession] = useState(false);
  const [ignoreRobots, setIgnoreRobots] = useState(false);
  const [browserChannel, setBrowserChannel] = useState<BrowserChannelId>("auto");
  const [save, setSave] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [known, setKnown] = useState(false);

  // «Sugerir términos relacionados»: estimate first, then the model, then the person chooses.
  const [suggestStep, setSuggestStep] = useState<"idle" | "estimate" | "list">("idle");
  const [suggestEstimate, setSuggestEstimate] = useState<{ usd: number; model: string; configured: boolean } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [accepted, setAccepted] = useState<Suggestion[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestPending, startSuggest] = useTransition();

  const [meaningEstimate, setMeaningEstimate] = useState<{ usd: number; limitUsd: number; model: string; configured: boolean } | null>(null);

  const host = hostOf(url);
  const external = host !== null && !isLoopbackHost(new URL(url.trim()).hostname);
  useEffect(() => {
    setKnown(host !== null && remembered(host));
    setConfirmed(false);
  }, [host]);
  const needsPermission = external && !known;

  const chosen = templates.find((t) => t.id === template) ?? null;
  const usesModel = mode === "meaning" || (mode === "template" && withMeaning && chosen?.hasMeaning === true);
  const pagesNumber = maxPages === "" ? null : Number(maxPages);
  useEffect(() => {
    if (!usesModel) return;
    let live = true;
    void meaningEstimateAction(Number.isInteger(pagesNumber) ? pagesNumber : null).then((e) => {
      if (live) setMeaningEstimate(e);
    });
    return () => {
      live = false;
    };
  }, [usesModel, pagesNumber]);

  const defaultRuns = mode === "meaning" ? SEARCH_DEFAULTS.runsMeaning : SEARCH_DEFAULTS.runsExact;
  const chips = [
    t("chipPages", { count: Number(maxPages === "" ? SEARCH_DEFAULTS.maxPages : maxPages) }),
    t("chipDepth", { depth: maxDepth === "" ? SEARCH_DEFAULTS.maxDepth : maxDepth }),
    t("search.chipLoads", { count: runs === "" ? defaultRuns : Number(runs) }),
    includeHidden ? t("search.chipHidden") : t("search.chipVisible"),
    ...(mode === "exact" && variants ? [t("search.chipVariants")] : []),
    ...(mode === "exact" && excludePage ? [t("search.chipExcludePage")] : []),
    ...(noSession ? [t("chipAnonymous")] : []),
    ...(ignoreRobots ? [t("chipIgnoreRobots")] : []),
    ...(save.trim() !== "" ? [t("search.chipSave", { name: save.trim() })] : []),
  ];

  const askEstimate = () =>
    startSuggest(async () => {
      setSuggestError(null);
      const r = await suggestEstimateAction(terms);
      if ("error" in r) {
        setSuggestError(r.error);
        return;
      }
      setSuggestEstimate(r);
      setSuggestStep("estimate");
    });
  const askSuggestions = () =>
    startSuggest(async () => {
      setSuggestError(null);
      const r = await suggestAction(terms);
      if ("error" in r) {
        setSuggestError(r.error);
        return;
      }
      setSuggestions(r.suggestions);
      setSuggestStep("list");
    });
  const toggle = (s: Suggestion) => setAccepted((prev) => (prev.some((p) => p.term === s.term) ? prev.filter((p) => p.term !== s.term) : [...prev, s]));

  return (
    <form
      action={(data) => {
        if (host !== null && external && (known || confirmed)) remember(host);
        action(data);
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor="search-url" className="text-[13px] font-medium text-fg">
        {t("siteUrl")}
      </label>
      <div className="relative min-w-0">
        <Globe className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id="search-url"
          name="url"
          type="url"
          inputMode="url"
          required
          autoComplete="url"
          spellCheck={false}
          placeholder={t("urlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-12 w-full rounded-lg border border-line-strong bg-panel pr-4 pl-12 font-mono text-[15px] text-fg placeholder:font-sans placeholder:text-faint"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-fg">{t("search.type")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 text-[13px]", mode === m ? "border-accent-text bg-hover" : "border-line hover:bg-hover/50")}>
              <span className="flex items-center gap-2 font-medium text-fg">
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="size-4 accent-[var(--accent)]" />
                {t(`search.mode.${m}`)}
              </span>
              <span className="text-[12px] text-muted">{t(`search.mode.${m}Help`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "exact" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="search-terms" className="text-[13px] font-medium text-fg">
            {t("search.terms")}
          </label>
          <input
            id="search-terms"
            name="terms"
            value={terms}
            onChange={(e) => {
              setTerms(e.target.value);
              setSuggestStep("idle");
            }}
            placeholder={t("search.termsPlaceholder")}
            aria-describedby="search-terms-help"
            className={`${input} h-11 text-[14px]`}
          />
          <p id="search-terms-help" className="text-[12px] text-muted">
            {t.rich("search.termsHelp", {
              phrase: () => <code className="font-mono">{t("search.phrase")}</code>,
              exclude: () => <code className="font-mono">{t("search.exclude")}</code>,
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={askEstimate} disabled={suggestPending || terms.trim() === ""} className={buttonClass("secondary", "sm")}>
              {suggestPending && suggestStep === "idle" ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} {t("search.suggest")}
            </button>
            {accepted.map((s) => (
              <span key={s.term} className="inline-flex items-center gap-1 rounded-full border border-accent-text/40 bg-hover px-2 py-0.5 text-[12px] text-fg">
                <span translate="no">{s.term}</span>
                <button type="button" onClick={() => toggle(s)} aria-label={t("search.remove", { term: s.term })} className="text-muted hover:text-fg">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
          {suggestStep === "estimate" && suggestEstimate !== null && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-fg">
              {suggestEstimate.configured ? (
                <>
                  <span>{t("search.suggestInfo", { model: suggestEstimate.model, usd: usd(suggestEstimate.usd) })}</span>
                  <button type="button" onClick={askSuggestions} disabled={suggestPending} className={buttonClass("primary", "sm")}>
                    {suggestPending ? <Loader2 className="animate-spin" aria-hidden /> : null} {t("search.suggestGo")}
                  </button>
                  <button type="button" onClick={() => setSuggestStep("idle")} className={buttonClass("ghost", "sm")}>
                    {t("search.cancel")}
                  </button>
                </>
              ) : (
                <span>{t("search.suggestNoKey")}</span>
              )}
            </div>
          )}
          {suggestStep === "list" && (
            <fieldset className="rounded-md border border-line bg-sunken px-3 py-2">
              <legend className="px-1 text-[12px] text-muted">{t("search.pick")}</legend>
              {suggestions.length === 0 ? (
                <p className="text-[13px] text-muted">{t("search.nothingNew")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <label key={s.term} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[13px] text-fg">
                      <input type="checkbox" checked={accepted.some((a) => a.term === s.term)} onChange={() => toggle(s)} className="size-3.5 accent-[var(--accent)]" />
                      <span translate="no">{s.term}</span> <span className="text-[11px] text-faint">{t("search.suggestionFrom", { relation: s.relation, from: s.from })}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {suggestError !== null && (
            <p role="alert" className="text-[13px] text-bad">
              {suggestError}
            </p>
          )}
          <input type="hidden" name="suggested" value={accepted.length === 0 ? "" : JSON.stringify(accepted)} />
          <label className="flex items-start gap-2 text-[13px] text-fg">
            <input type="checkbox" name="variants" checked={variants} onChange={(e) => setVariants(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("search.variants")}</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg">
            <input type="checkbox" name="excludeScope" value="page" checked={excludePage} onChange={(e) => setExcludePage(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("search.excludePage")}</span>
          </label>
        </div>
      )}

      {mode === "meaning" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="search-meaning" className="text-[13px] font-medium text-fg">
            {t("search.what")}
          </label>
          <textarea
            id="search-meaning"
            name="meaning"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            rows={3}
            placeholder={t("search.meaningPlaceholder")}
            className="w-full rounded-md border border-line-strong bg-panel px-2.5 py-2 text-[14px] text-fg"
          />
        </div>
      )}

      {mode === "template" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="search-template" className="text-[13px] font-medium text-fg">
            {t("search.template")}
          </label>
          <select id="search-template" name="template" value={template} onChange={(e) => setTemplate(e.target.value)} className={input}>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
                {tpl.origin === "user" ? t("search.yours") : ""}
                {tpl.hasMeaning ? "" : t("search.noAi")}
              </option>
            ))}
          </select>
          {chosen !== null && (
            <p className="text-[12px] text-muted" translate="no">
              {chosen.description}
            </p>
          )}
          {chosen?.hasMeaning === true && (
            <label className="flex items-start gap-2 text-[13px] text-fg">
              <input type="checkbox" name="withMeaning" checked={withMeaning} onChange={(e) => setWithMeaning(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span>{t("search.withMeaning")}</span>
            </label>
          )}
        </div>
      )}

      {usesModel && meaningEstimate !== null && (
        <p className={cn("rounded-md border px-3 py-2 text-[13px]", meaningEstimate.configured ? "border-line bg-sunken text-fg" : "border-warn/30 bg-warn-bg text-fg")}>
          {meaningEstimate.configured
            ? t("search.estimate", { usd: usd(meaningEstimate.usd), pages: pagesNumber ?? SEARCH_DEFAULTS.maxPages, model: meaningEstimate.model, limit: usd(meaningEstimate.limitUsd) })
            : t("search.noKey")}
        </p>
      )}

      <ul className="flex flex-wrap gap-1.5" aria-label={t("search.options")}>
        {chips.map((c) => (
          <li key={c} className="rounded-full border border-line bg-sunken px-2.5 py-0.5 text-[12px] text-muted">
            {c}
          </li>
        ))}
      </ul>

      {needsPermission ? (
        <label className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-[13px] text-fg">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            {tc("permission.text")} {t.rich("search.confirm", { host: () => <span className="font-mono">{host}</span> })}
          </span>
        </label>
      ) : (
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {tc("permission.text")} {t("search.readonlyNote")}
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
              ["maxPages", t("pages"), maxPages, setMaxPages, 1, 500, SEARCH_DEFAULTS.maxPages],
              ["maxDepth", t("depth"), maxDepth, setMaxDepth, 0, 10, SEARCH_DEFAULTS.maxDepth],
              ["runs", t("search.loads"), runs, setRuns, 1, 20, defaultRuns],
            ] as const
          ).map(([name, label, value, set, min, max, def]) => (
            <label key={name} className="flex flex-col gap-1 text-[12px] text-muted">
              {label}
              <input name={name} type="number" min={min} max={max} placeholder={String(def)} value={value} onChange={(e) => set(e.target.value)} className={`${input} font-mono`} />
            </label>
          ))}
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="includeHidden" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("search.includeHidden")}</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="noSession" checked={noSession} onChange={(e) => setNoSession(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("search.anonymous")}</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="ignoreRobots" checked={ignoreRobots} onChange={(e) => setIgnoreRobots(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>{t("search.ignoreRobots")}</span>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-2">
            {t("search.save")}
            <input name="save" value={save} onChange={(e) => setSave(e.target.value)} maxLength={200} placeholder={t("search.savePlaceholder")} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            {t("browser")}
            <select name="browserChannel" value={browserChannel} onChange={(e) => setBrowserChannel(e.target.value as BrowserChannelId)} className={input}>
              {BROWSER_CHANNEL_IDS.map((c) => (
                <option key={c} value={c}>
                  {tc(`browserChannel.${c}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <button type="submit" disabled={pending || (needsPermission && !confirmed)} className={cn(buttonClass("primary"), "h-12 self-start px-6 text-[15px]")}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {t("search.submit")}
      </button>

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
