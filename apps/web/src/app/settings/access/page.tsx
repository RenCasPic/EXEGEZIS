import { AppWindow, KeyRound, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteAccessAction, openAccessWindowAction, robotsOwnerAction } from "@/app/access-actions";
import { HttpAuthForm, WafTokenForm } from "@/components/access/forms";
import { buttonClass, EmptyState, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { accessState, listAccess } from "@/lib/access";
import { absoluteTime, haceTiempo } from "@/lib/format";
import { displayPath } from "@/lib/workspace";

export const metadata: Metadata = { title: "Accesos · Ajustes" };

const KIND_LABEL = { session: "Sesión (cookies)", httpCredentials: "Usuario y contraseña HTTP", wafToken: "Token del WAF" } as const;

const STATE = {
  active: { label: "ACTIVO", tone: "ok" },
  expired: { label: "CADUCADO", tone: "bad" },
  none: { label: "SIN ACCESO", tone: "q" },
} as const;

const input = "h-9 w-full rounded-md border border-line-strong bg-panel px-2.5 font-mono text-[13px] text-fg";

/**
 * Settings → Accesos (docs/09-access.md §5): metadata of the saved access
 * (index.json) only. The web never decrypts or shows a secret.
 */
export default async function AccessSettingsPage() {
  const { dir, entries } = await listAccess();
  const windows = process.platform === "win32";
  return (
    <div lang="es" className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="text-[12px] text-accent-text hover:underline">
            ← Ajustes
          </Link>
        }
        title="Accesos"
        description="Sesiones, usuarios HTTP y tokens del WAF guardados para inspeccionar sitios con acceso. Aquí solo se ven sus datos generales, nunca su contenido."
      />

      <p className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-fg">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <span>
          {windows
            ? "Se guardan cifrados y solo se abren con este usuario de Windows en este equipo (DPAPI). En otro equipo, o con otro usuario, hay que volver a iniciar sesión."
            : "Se guardan cifrados con una clave protegida por el llavero del sistema de este usuario. En otro equipo hay que volver a iniciar sesión."}{" "}
          Carpeta: <Mono>{displayPath(dir)}</Mono>
        </span>
      </p>

      {entries.length === 0 ? (
        <Panel title="Sitios">
          <EmptyState icon={<KeyRound />} title="No hay accesos guardados">
            Cuando una inspección encuentre un inicio de sesión, un banner de cookies o una verificación anti-bot, te ofrecerá abrir una ventana para resolverlo; el acceso se guardará aquí.
          </EmptyState>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Sitios con acceso guardado">
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
                      <dt className="text-[12px] text-muted">Tipos de acceso</dt>
                      <dd className="text-fg">{e.kinds.length === 0 ? "—" : e.kinds.map((k) => KIND_LABEL[k]).join(" · ")}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Último uso</dt>
                      <dd className="text-fg" title={e.lastUsedAt === null ? undefined : absoluteTime(e.lastUsedAt)}>
                        {e.lastUsedAt === null ? "nunca" : haceTiempo(e.lastUsedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Caducidad estimada de la sesión</dt>
                      <dd className="text-fg">
                        {e.expired ? "caducada: la última inspección encontró el inicio de sesión" : e.expiresAt === null ? "sin fecha (cookies de sesión)" : absoluteTime(e.expiresAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Guardado</dt>
                      <dd className="text-fg">{absoluteTime(e.updatedAt)}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={openAccessWindowAction}>
                      <input type="hidden" name="url" value={`${e.origin}/`} />
                      <input type="hidden" name="block" value={state === "expired" ? "SESSION_EXPIRED" : "LOGIN_WALL"} />
                      <button type="submit" className={buttonClass(state === "expired" ? "primary" : "secondary")}>
                        <AppWindow aria-hidden /> {e.kinds.includes("session") ? "Renovar sesión" : "Iniciar sesión"}
                      </button>
                    </form>
                    <form action={deleteAccessAction}>
                      <input type="hidden" name="url" value={`${e.origin}/`} />
                      <button type="submit" className={buttonClass("secondary")}>
                        <Trash2 aria-hidden /> Borrar
                      </button>
                    </form>
                  </div>

                  <form action={robotsOwnerAction} className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-fg">
                    <input type="hidden" name="url" value={`${e.origin}/`} />
                    <input type="hidden" name="robotsOwner" value={e.settings.robotsOwner ? "no" : "yes"} />
                    <span>
                      Este sitio es mío: inspeccionar también lo que excluye robots.txt —{" "}
                      <strong>{e.settings.robotsOwner ? "sí" : "no"}</strong>
                    </span>
                    <button type="submit" className={buttonClass("ghost")}>
                      {e.settings.robotsOwner ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                  {e.settings.unsafeLinkPatterns.length > 0 && (
                    <p className="mt-2 text-[12px] text-muted">
                      Enlaces que nunca se visitan, además de los de siempre: <Mono>{e.settings.unsafeLinkPatterns.join(", ")}</Mono>
                    </p>
                  )}

                  <details className="mt-4 rounded-md border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">Usuario y contraseña HTTP</summary>
                    <div className="border-t border-line p-3">
                      <HttpAuthForm url={`${e.origin}/`} />
                    </div>
                  </details>
                  <details className="mt-2 rounded-md border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">Token del WAF (sitio propio)</summary>
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

      <Panel title="Añadir un sitio">
        <form action={openAccessWindowAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted">
            URL de la página de inicio de sesión
            <input name="url" type="url" required placeholder="https://tu-sitio.com/login" className={input} />
          </label>
          <input type="hidden" name="block" value="LOGIN_WALL" />
          <button type="submit" className={buttonClass("primary")}>
            <AppWindow aria-hidden /> Abrir ventana para iniciar sesión
          </button>
        </form>
        <p className="mt-2 text-[12px] text-muted">Se abre una ventana visible en este equipo. Tú inicias sesión; EXEGEZIS no teclea ni guarda tu contraseña, solo las cookies de ese sitio y sus subdominios.</p>
      </Panel>
    </div>
  );
}
