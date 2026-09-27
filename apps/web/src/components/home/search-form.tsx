"use client";

import { AlertTriangle, ChevronDown, Globe, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { meaningEstimateAction, startSearchAction, suggestAction, suggestEstimateAction, type SearchState, type Suggestion } from "@/app/search-actions";
import { EngineProblem } from "@/components/ui/copy-command";
import { buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { BROWSER_CHANNEL_IDS, BROWSER_CHANNEL_LABEL, isLoopbackHost, type BrowserChannelId } from "@/lib/inspect-checks";
import { SEARCH_DEFAULTS } from "@/lib/search-defaults";
import { hostOf, PERMISSION_TEXT, remember, remembered } from "@/lib/site-permission";

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  origin: "repository" | "user";
  hasExact: boolean;
  hasMeaning: boolean;
}

const input = "h-9 w-full rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg";
const MODES = [
  { id: "exact", label: "Exacta", help: "Sin IA. Encuentra las palabras tal cual (sin importar acentos ni mayúsculas) y comprueba cada resultado en todas las cargas." },
  { id: "meaning", label: "Por significado", help: "La IA lee el texto y propone pasajes. Cada cita se comprueba letra por letra en la página; las que no están se descartan." },
  { id: "template", label: "Plantilla", help: "Búsquedas preparadas (salud, datos personales, fechas pasadas…) y las tuyas." },
] as const;
type Mode = (typeof MODES)[number]["id"];

const usd = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

/** «Buscar» (docs/10-search.md §6): starts a real `exegezis search` job. */
export function SearchForm({ templates }: { templates: TemplateOption[] }) {
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
    `${maxPages === "" ? SEARCH_DEFAULTS.maxPages : maxPages} páginas`,
    `profundidad ${maxDepth === "" ? SEARCH_DEFAULTS.maxDepth : maxDepth}`,
    `${runs === "" ? defaultRuns : runs} carga${(runs === "" ? defaultRuns : Number(runs)) === 1 ? "" : "s"} por página`,
    includeHidden ? "incluye texto no visible" : "solo texto visible",
    ...(mode === "exact" && variants ? ["con variantes"] : []),
    ...(mode === "exact" && excludePage ? ["excluir página entera"] : []),
    ...(noSession ? ["visitante anónimo"] : []),
    ...(ignoreRobots ? ["ignora robots.txt"] : []),
    ...(save.trim() !== "" ? [`se guarda como «${save.trim()}»`] : []),
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
        URL del sitio
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
          placeholder="https://tu-sitio.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-12 w-full rounded-lg border border-line-strong bg-panel pr-4 pl-12 font-mono text-[15px] text-fg placeholder:font-sans placeholder:text-faint"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-fg">Tipo de búsqueda</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m.id} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 text-[13px]", mode === m.id ? "border-accent-text bg-hover" : "border-line hover:bg-hover/50")}>
              <span className="flex items-center gap-2 font-medium text-fg">
                <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="size-4 accent-[var(--accent)]" />
                {m.label}
              </span>
              <span className="text-[12px] text-muted">{m.help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "exact" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="search-terms" className="text-[13px] font-medium text-fg">
            Términos
          </label>
          <input
            id="search-terms"
            name="terms"
            value={terms}
            onChange={(e) => {
              setTerms(e.target.value);
              setSuggestStep("idle");
            }}
            placeholder='medicina, médico, "tratamiento médico", -anuncio'
            aria-describedby="search-terms-help"
            className={`${input} h-11 text-[14px]`}
          />
          <p id="search-terms-help" className="text-[12px] text-muted">
            Separa con comas. <code className="font-mono">&quot;frase exacta&quot;</code> entre comillas · <code className="font-mono">-palabra</code> excluye el bloque de texto donde aparece. Da igual acentos y mayúsculas; la ñ cuenta (año ≠ ano).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={askEstimate} disabled={suggestPending || terms.trim() === ""} className={buttonClass("secondary", "sm")}>
              {suggestPending && suggestStep === "idle" ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} Sugerir términos relacionados
            </button>
            {accepted.map((s) => (
              <span key={s.term} className="inline-flex items-center gap-1 rounded-full border border-accent-text/40 bg-hover px-2 py-0.5 text-[12px] text-fg">
                {s.term}
                <button type="button" onClick={() => toggle(s)} aria-label={`Quitar ${s.term}`} className="text-muted hover:text-fg">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
          {suggestStep === "estimate" && suggestEstimate !== null && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-fg">
              {suggestEstimate.configured ? (
                <>
                  <span>
                    La IA ({suggestEstimate.model}) propondrá palabras de la misma familia y sinónimos. Solo se envían tus términos, nunca el texto del sitio. Coste estimado: hasta {usd(suggestEstimate.usd)}.
                  </span>
                  <button type="button" onClick={askSuggestions} disabled={suggestPending} className={buttonClass("primary", "sm")}>
                    {suggestPending ? <Loader2 className="animate-spin" aria-hidden /> : null} Sugerir
                  </button>
                  <button type="button" onClick={() => setSuggestStep("idle")} className={buttonClass("ghost", "sm")}>
                    Cancelar
                  </button>
                </>
              ) : (
                <span>Las sugerencias necesitan la clave de la IA (EXEGEZIS_ANTHROPIC_API_KEY en el archivo .env del repositorio).</span>
              )}
            </div>
          )}
          {suggestStep === "list" && (
            <fieldset className="rounded-md border border-line bg-sunken px-3 py-2">
              <legend className="px-1 text-[12px] text-muted">Marca los que quieras usar. La búsqueda sigue siendo exacta.</legend>
              {suggestions.length === 0 ? (
                <p className="text-[13px] text-muted">La IA no propuso nada nuevo.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <label key={s.term} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[13px] text-fg">
                      <input type="checkbox" checked={accepted.some((a) => a.term === s.term)} onChange={() => toggle(s)} className="size-3.5 accent-[var(--accent)]" />
                      {s.term} <span className="text-[11px] text-faint">({s.relation}, de «{s.from}»)</span>
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
            <span>
              Incluir variantes (plurales y formas del verbo: enfermedad → enfermedades, curar → curó). Cada resultado por variante dice por qué salió. Puede unir palabras distintas (casa/caso) y no une derivadas (curar/curación): para esas, usa las sugerencias.
            </span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg">
            <input type="checkbox" name="excludeScope" value="page" checked={excludePage} onChange={(e) => setExcludePage(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Con -palabra, excluir la página entera (por defecto solo el bloque). El informe dice siempre cuánto se excluyó.</span>
          </label>
        </div>
      )}

      {mode === "meaning" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="search-meaning" className="text-[13px] font-medium text-fg">
            Qué buscas
          </label>
          <textarea
            id="search-meaning"
            name="meaning"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            rows={3}
            placeholder="cualquier mención a la medicina, directa o indirecta"
            className="w-full rounded-md border border-line-strong bg-panel px-2.5 py-2 text-[14px] text-fg"
          />
        </div>
      )}

      {mode === "template" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="search-template" className="text-[13px] font-medium text-fg">
            Plantilla
          </label>
          <select id="search-template" name="template" value={template} onChange={(e) => setTemplate(e.target.value)} className={input}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.origin === "user" ? " (tuya)" : ""}
                {t.hasMeaning ? "" : " — sin IA"}
              </option>
            ))}
          </select>
          {chosen !== null && <p className="text-[12px] text-muted">{chosen.description}</p>}
          {chosen?.hasMeaning === true && (
            <label className="flex items-start gap-2 text-[13px] text-fg">
              <input type="checkbox" name="withMeaning" checked={withMeaning} onChange={(e) => setWithMeaning(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span>Incluir también la parte por significado (usa IA, con estimación de coste). Sin marcar, solo la parte exacta: sin IA.</span>
            </label>
          )}
        </div>
      )}

      {usesModel && meaningEstimate !== null && (
        <p className={cn("rounded-md border px-3 py-2 text-[13px]", meaningEstimate.configured ? "border-line bg-sunken text-fg" : "border-warn/30 bg-warn-bg text-fg")}>
          {meaningEstimate.configured
            ? `Estimación antes de leer el sitio: hasta ≈ ${usd(meaningEstimate.usd)} para ${pagesNumber ?? SEARCH_DEFAULTS.maxPages} páginas con ${meaningEstimate.model}. La cifra exacta se calcula tras leerlas; si supera el límite (${usd(meaningEstimate.limitUsd)}, en Ajustes → Búsquedas), no se llama a la IA y se te pide aprobarla.`
            : "La búsqueda por significado necesita la clave de la IA: añade EXEGEZIS_ANTHROPIC_API_KEY al archivo .env del repositorio."}
        </p>
      )}

      <ul className="flex flex-wrap gap-1.5" aria-label="Opciones de la búsqueda">
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
            {PERMISSION_TEXT} Confirmo que puedo revisar <span className="font-mono">{host}</span>.
          </span>
        </label>
      ) : (
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {PERMISSION_TEXT} La búsqueda es de solo lectura: no envía formularios ni pulsa botones.
        </p>
      )}
      <input type="hidden" name="permission" value={!external || known || confirmed ? "on" : ""} />

      <details className="group rounded-md border border-line">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[13px] text-muted hover:text-fg">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
          Opciones avanzadas
        </summary>
        <div className="grid gap-4 border-t border-line p-3 sm:grid-cols-3">
          {(
            [
              ["maxPages", "Páginas", maxPages, setMaxPages, 1, 500, SEARCH_DEFAULTS.maxPages],
              ["maxDepth", "Profundidad", maxDepth, setMaxDepth, 0, 10, SEARCH_DEFAULTS.maxDepth],
              ["runs", "Cargas por página", runs, setRuns, 1, 20, defaultRuns],
            ] as const
          ).map(([name, label, value, set, min, max, def]) => (
            <label key={name} className="flex flex-col gap-1 text-[12px] text-muted">
              {label}
              <input name={name} type="number" min={min} max={max} placeholder={String(def)} value={value} onChange={(e) => set(e.target.value)} className={`${input} font-mono`} />
            </label>
          ))}
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="includeHidden" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Incluir texto no visible (acordeones cerrados, pestañas ocultas, atributos alt/title, metadatos). Se marca como «no visible».</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="noSession" checked={noSession} onChange={(e) => setNoSession(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Buscar como visitante anónimo: no usar el acceso guardado de este sitio.</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="ignoreRobots" checked={ignoreRobots} onChange={(e) => setIgnoreRobots(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Ignorar robots.txt (la URL inicial se visita siempre).</span>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-2">
            Guardar como búsqueda (nombre, opcional)
            <input name="save" value={save} onChange={(e) => setSave(e.target.value)} maxLength={200} placeholder="p. ej. Salud en la web" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Navegador
            <select name="browserChannel" value={browserChannel} onChange={(e) => setBrowserChannel(e.target.value as BrowserChannelId)} className={input}>
              {BROWSER_CHANNEL_IDS.map((c) => (
                <option key={c} value={c}>
                  {BROWSER_CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <button type="submit" disabled={pending || (needsPermission && !confirmed)} className={cn(buttonClass("primary"), "h-12 self-start px-6 text-[15px]")}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Buscar
      </button>

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
