"use client";

import { AlertTriangle, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useActionState } from "react";
import { saveHttpAuthAction, wafTokenAction, type AccessState } from "@/app/access-actions";
import { CopyCommand } from "@/components/ui/copy-command";
import { buttonClass } from "@/components/ui/primitives";

const input = "h-9 w-full rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg";

function Result({ state }: { state: AccessState }) {
  if (state.error !== null)
    return (
      <p role="alert" className="flex items-start gap-1.5 text-[13px] text-bad">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  if (state.done !== undefined) return <p className="text-[13px] text-ok">{state.done}</p>;
  return null;
}

/** HTTP_AUTH: the person types the site's username and password. Sent to the CLI through stdin; saved encrypted. */
export function HttpAuthForm({ url, relaunch }: { url: string; relaunch?: string }) {
  const [state, action, pending] = useActionState<AccessState, FormData>(saveHttpAuthAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="url" value={url} />
      {relaunch !== undefined && <input type="hidden" name="relaunch" value={relaunch} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Usuario
          <input name="username" autoComplete="username" required className={input} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Contraseña
          <input name="password" type="password" autoComplete="current-password" required className={input} />
        </label>
      </div>
      <p className="text-[12px] text-muted">Se guardan cifrados en este equipo (solo este usuario de Windows puede abrirlos) y solo se envían a este sitio. Nunca aparecen en los informes ni en los registros.</p>
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
        Guardar{relaunch !== undefined ? " y volver a inspeccionar" : ""}
      </button>
      <Result state={state} />
    </form>
  );
}

/** BOT_CHALLENGE, option A: a token for the site's own WAF rule. Shown once, with the steps. */
export function WafTokenForm({ url, hasToken }: { url: string; hasToken: boolean }) {
  const [state, action, pending] = useActionState<AccessState, FormData>(wafTokenAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="url" value={url} />
      {state.token === undefined ? (
        <>
          <p className="text-[12px] text-muted">
            Solo para un sitio tuyo. EXEGEZIS genera un secreto, lo guarda cifrado y lo envía como cabecera <code className="font-mono">X-Exegezis-Token</code> solo a este sitio. Tú creas en el WAF una regla que deja pasar las peticiones con ese secreto.
          </p>
          {hasToken && (
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" name="rotate" className="size-4 accent-[var(--accent)]" /> Ya hay un token: crear uno nuevo (el anterior dejará de valer)
            </label>
          )}
          <button type="submit" disabled={pending} className={`${buttonClass("secondary")} self-start`}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
            {hasToken ? "Mostrar los pasos con el token" : "Crear el token del WAF"}
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="font-medium text-fg">Token para {state.token.origin} (se muestra ahora; guárdalo como una contraseña):</p>
          <CopyCommand command={state.token.value} label="Copiar token" />
          <ol className="list-decimal space-y-1 pl-5 text-[12px] text-muted">
            <li>
              Cloudflare: <strong>Security → WAF → Custom rules → Create rule</strong>.
            </li>
            <li>Expresión (cópiala):</li>
          </ol>
          <CopyCommand command={`(http.request.headers["x-exegezis-token"][0] eq "${state.token.value}")`} label="Copiar expresión" />
          <ol start={3} className="list-decimal space-y-1 pl-5 text-[12px] text-muted">
            <li>
              Acción: <strong>Skip</strong>, y marca Bot Fight Mode / Super Bot Fight Mode, Managed Challenge y las reglas de rate limiting. Guarda la regla.
            </li>
            <li>Vuelve a inspeccionar el sitio. En Vercel es igual: Firewall → Custom rules, la misma condición sobre la cabecera, acción Bypass.</li>
          </ol>
        </div>
      )}
      <Result state={state} />
    </form>
  );
}
