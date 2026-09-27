"use client";

import { AlertTriangle, ChevronDown, Globe, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { accessStatusAction } from "@/app/access-actions";
import { startInspectionAction, type InspectState } from "@/app/actions";
import { EngineProblem } from "@/components/ui/copy-command";
import { buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { BROWSER_CHANNEL_IDS, BROWSER_CHANNEL_LABEL, INSPECT_CHECKS, INSPECT_DEFAULTS, isLoopbackHost, type BrowserChannelId } from "@/lib/inspect-checks";

const PERMISSION_PREFIX = "exegezis-inspect-permission:";
const PERMISSION_TEXT = "Inspecciona solo sitios que sean tuyos o para los que tengas permiso.";

function hostOf(value: string): string | null {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
}

function remembered(host: string): boolean {
  try {
    return window.localStorage.getItem(PERMISSION_PREFIX + host) === "1";
  } catch {
    return false;
  }
}

function remember(host: string): void {
  try {
    window.localStorage.setItem(PERMISSION_PREFIX + host, "1");
  } catch {
    // Storage unavailable: the confirmation is asked again next time.
  }
}

const ACCESS_KIND: Record<string, string> = { session: "sesión", httpCredentials: "usuario y contraseña HTTP", wafToken: "token del WAF" };

const input = "h-9 w-full rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg";

/**
 * Starts a real `exegezis inspect` job. Before the first inspection of an
 * external (non-loopback) host the user confirms, in one line, that they may
 * inspect it; the server refuses an external host without that confirmation.
 */
export function InspectForm() {
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
  const accessKinds = access === null ? [] : access.kinds.map((k) => ACCESS_KIND[k] ?? k);

  const chips = [
    `${maxPages === "" ? INSPECT_DEFAULTS.maxPages : maxPages} páginas`,
    `profundidad ${maxDepth === "" ? INSPECT_DEFAULTS.maxDepth : maxDepth}`,
    `${runs === "" ? INSPECT_DEFAULTS.runs : runs} repeticiones`,
    strict ? "solo lectura estricta" : "solo lectura",
    ...(checks.length > 0 && checks.length < INSPECT_CHECKS.length ? [`${checks.length} comprobaciones`] : []),
    ...(ignoreRobots ? ["ignora robots.txt"] : []),
    ...(browserChannel === "auto" ? [] : [`navegador: ${browserChannel}`]),
    ...(access !== null && accessKinds.length > 0 ? [noSession ? "visitante anónimo" : "con sesión"] : []),
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
        URL del sitio
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
            placeholder="https://tu-sitio.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-describedby="inspect-permission"
            className="h-14 w-full rounded-lg border border-line-strong bg-panel pr-4 pl-12 font-mono text-[15px] text-fg placeholder:font-sans placeholder:text-faint"
          />
        </div>
        <button type="submit" disabled={pending || (needsPermission && !confirmed)} className={cn(buttonClass("primary"), "h-14 px-6 text-[15px]")}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Inspeccionar
        </button>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="Opciones de la inspección">
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
              <>
                La sesión guardada para <span className="font-mono">{access.origin}</span> ha caducado. Renuévala en{" "}
                <Link href="/settings/access" className="text-accent-text underline">
                  Ajustes → Accesos
                </Link>{" "}
                antes de inspeccionar, o marca «Inspeccionar como visitante anónimo» en las opciones avanzadas.
              </>
            ) : (
              <>
                Se usará el acceso guardado para <span className="font-mono">{access.origin}</span> ({accessKinds.join(", ")}), en solo lectura estricta.
              </>
            )}
          </span>
        </p>
      )}

      {needsPermission ? (
        <label id="inspect-permission" className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-[13px] text-fg">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            {PERMISSION_TEXT} Confirmo que puedo inspeccionar <span className="font-mono">{host}</span>.
          </span>
        </label>
      ) : (
        <p id="inspect-permission" className="flex items-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {PERMISSION_TEXT} La inspección es de solo lectura: no envía formularios ni pulsa botones.
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
              ["maxPages", "Páginas", maxPages, setMaxPages, 1, 500, INSPECT_DEFAULTS.maxPages],
              ["maxDepth", "Profundidad", maxDepth, setMaxDepth, 0, 10, INSPECT_DEFAULTS.maxDepth],
              ["runs", "Repeticiones", runs, setRuns, 1, 20, INSPECT_DEFAULTS.runs],
            ] as const
          ).map(([name, label, value, set, min, max, def]) => (
            <label key={name} className="flex flex-col gap-1 text-[12px] text-muted">
              {label}
              <input name={name} type="number" min={min} max={max} placeholder={String(def)} value={value} onChange={(e) => set(e.target.value)} className={`${input} font-mono`} />
            </label>
          ))}
          <fieldset className="sm:col-span-3">
            <legend className="mb-1 text-[12px] text-muted">Comprobaciones (ninguna marcada = todas)</legend>
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
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-3">
            storageState (ruta a un archivo de sesión de Playwright en esta máquina; su contenido no se muestra ni se guarda en el informe)
            <input name="storageState" value={storageState} onChange={(e) => setStorageState(e.target.value)} placeholder="p. ej. ./auth/state.json" className={`${input} font-mono`} />
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="strictReadonly" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              Solo lectura estricta: bloquear también las escrituras que haga la propia página. Esas páginas quedan DEGRADED y sus hallazgos se descartan.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-3">
            Navegador
            <select name="browserChannel" value={browserChannel} onChange={(e) => setBrowserChannel(e.target.value as BrowserChannelId)} className={input}>
              {BROWSER_CHANNEL_IDS.map((c) => (
                <option key={c} value={c}>
                  {BROWSER_CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="ignoreRobots" checked={ignoreRobots} onChange={(e) => setIgnoreRobots(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Ignorar robots.txt (la URL inicial se visita siempre; robots.txt solo limita el descubrimiento).</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-fg sm:col-span-3">
            <input type="checkbox" name="noSession" checked={noSession} onChange={(e) => setNoSession(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Inspeccionar como visitante anónimo: no usar el acceso guardado para este sitio (sesión, usuario HTTP o token del WAF).</span>
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
