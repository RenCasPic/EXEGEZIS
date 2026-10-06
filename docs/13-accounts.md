# 13 — Cuentas de usuario

La app web de EXEGEZIS funciona como cualquier web app: tiene cuentas (Supabase Auth) y cada usuario solo ve lo suyo.

- Quien entra sin sesión ve primero la landing. Desde ella se registra o inicia sesión, y entonces usa las funcionalidades.
- Igual que Transcriptor: la app se conecta directamente a un proyecto de supabase.com con tres claves en `.env` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Sin Docker y sin contraseña de la base de datos.
- La base de datos se crea pegando `supabase/setup.sql` en el SQL Editor del panel (`pnpm db:setup` lo copia y abre el editor).
- `pnpm web` comprueba antes de arrancar que `.env` tiene las tres claves, y dice cuáles faltan.
- La app, sus páginas públicas (landing y legales) y el inicio de sesión están en un solo servidor y un solo dominio: http://127.0.0.1:4100 en tu equipo (ver `docs/12-site.md`).
- El CLI (`pnpm exegezis …`) y los benchmarks no usan cuentas: siguen escribiendo en `runs/` de este equipo.
- Los tests nunca leen `.env` ni necesitan Docker: arrancan su propia base de datos y un sustituto de Supabase (ver «Tests»).

## Arquitectura

```
Un servidor (apps/web, Next.js), un dominio                                        Supabase
 /producto · /product · /privacidad · …  estáticas: el proxy no pasa por ellas
 /  sin sesión ──▶ la landing (misma URL)    con sesión ──▶ la app
 /login, /signup, /auth/callback … ────────────────────────────────────────────▶  Auth (GoTrue): contraseñas,
 proxy.ts: refresca la sesión,                                                      emails, OAuth, sesiones
   /login?next=… si no hay
 Server actions / route handlers ──────────────────────────────────────────────▶  Data API (PostgREST) →
   (@supabase/supabase-js con la sesión del usuario)                                Postgres (RLS en todas
                                                                                    las tablas): profiles,
 EXEGEZIS_DATA_DIR/users/<id>/  runs/ access/ search/   (disco)                     consents, projects, runs,
                                                                                    waitlist, rate_limits
```

- **Autenticación:** Supabase Auth, con `@supabase/ssr` en el servidor.
  - El navegador no tiene cliente de Supabase. Las cookies de sesión son httpOnly, SameSite=Lax y Secure en https.
  - EXEGEZIS nunca ve ni guarda contraseñas: van directas a Supabase.
- **Datos:** a través de la API de datos de Supabase, con `@supabase/supabase-js` (`packages/accounts/src/store.ts`, con los tipos del esquema en `database.ts`), como cualquier app de Supabase.
  - Lo de cada usuario va con **su propia sesión** (la clave anon más su token): las políticas RLS deciden qué puede leer o escribir.
  - Solo las tareas de operador usan la **service role key**, y solo en el servidor: límites de intentos (`consume_rate_limit`), borrar una cuenta, asignar los datos del CLI y cambiar un plan.
- **Artefactos:** capturas, trazas y DOM siguen en disco, en una carpeta por usuario (`EXEGEZIS_DATA_DIR/users/<id>/`).
  - `currentWorkspace()` (`apps/web/src/lib/user-workspace.ts`) da esa carpeta a cada petición.
  - El descubrimiento, los trabajos, la CLI que lanza la app (`EXEGEZIS_RUNS_DIR`, `EXEGEZIS_ACCESS_DIR`, `EXEGEZIS_SEARCH_DIR`), los accesos y las búsquedas solo leen esa carpeta.
  - Los resultados del repositorio (`benchmarks/*/results`) no se muestran en la app: son del CLI.
  - El aislamiento es estructural: un id de otro usuario no se encuentra, así que la respuesta es 404 (páginas, `/api/artifacts`, descarga de specs, trabajos, exportación).
- **Accesos guardados:** siguen cifrados (AES-256-GCM), ahora uno por usuario.
  - En un servidor sin llavero del sistema, la clave de cada usuario se protege con `EXEGEZIS_ACCESS_KEY` (`ServerKeyProtector`).
  - La ventana visible para iniciar sesión en un sitio solo se abre con `pnpm web` en tu propio equipo. Un servidor compartido (una compilación de producción) la rechaza, porque allí nadie la vería; se pueden guardar un usuario HTTP o un token del WAF.
- **Planes:** `packages/accounts/src/pricing.ts` es el mismo archivo que muestra la landing (`src/site`, en la propia app).
  - Los `limits` de cada plan se aplican en el servidor, en `lib/plan-gate.ts`, dentro de `lib/jobs.ts`, así que ningún formulario ni ruta se los salta. Se comprueban sitios, páginas por inspección, inspecciones al mes, búsqueda por significado y saldo de IA.
  - Al llegar a un límite sale un mensaje claro con «Ver planes».
  - Todavía no hay pagos: los planes de pago llevan a una lista de espera.

## Modelo de datos (`supabase/migrations/20261003000000_accounts.sql`)

| Tabla | Qué guarda | Políticas (rol `authenticated`) |
|---|---|---|
| `profiles` | Nombre, idioma, tema, plan, versión y fecha de los términos aceptados | Leer y editar el suyo. Solo puede cambiar nombre, idioma y tema (privilegios por columna): el plan no |
| `consents` | Historial de aceptaciones (documento, versión, fecha) | Leer las suyas. Las escribe un disparador o `accept_legal()` |
| `projects` | Proyectos del usuario | CRUD de los suyos |
| `runs` | Metadatos de cada inspección, búsqueda, investigación y acceso: URL, sitio, estado, páginas, coste de IA | CRUD de los suyos. Insertar con `user_id` ajeno falla |
| `waitlist` | Lista de espera de los planes de pago | Leer, insertar y borrar los suyos |
| `rate_limits` | Intentos por clave (IP, email) | RLS activo y ninguna política: nadie puede tocarla |

- Además de las políticas, a `anon` y `authenticated` se les quitan todos los permisos que Supabase da por defecto y solo se conceden los necesarios.
- El disparador `on_auth_user_created` crea el perfil y registra la versión de los términos y de la privacidad que llegó con el registro.
- Un registro con Google o GitHub no pasa por el formulario. `/welcome` pide aceptar los textos (`accept_legal`) antes de entrar.
- Borrar la cuenta (`delete from auth.users`) borra en cascada todas sus filas. La app borra además su carpeta de artefactos.

## Seguridad

- **CSRF:** las server actions solo aceptan POST con el `Origin` de la app (la comprobación propia de Next) y, además, `sameOrigin()` en cada acción de cuenta. Las cookies son SameSite=Lax. `/api/account/export` rechaza peticiones con `Sec-Fetch-Site` de otro sitio.
- **Límite de intentos:**
  - Inicio de sesión: 30 por IP y 10 por email cada 15 min.
  - Registro, recuperación y reenvío: 10 por IP y 3 por email por hora.
  - Se suman los límites propios de Supabase.
  - La IP es la entrada de `X-Forwarded-For` que añade el proxy de confianza más cercano (`EXEGEZIS_PROXY_HOPS`, contando desde la derecha). Un cliente no puede falsearla.
- **Contraseñas:** al menos 10 caracteres, como mucho 72 bytes (límite de bcrypt), sin el email y sin repetir uno o dos caracteres.
  - Supabase comprueba la longitud otra vez (`minimum_password_length`).
  - La comprobación contra contraseñas filtradas (HaveIBeenPwned) es una opción de Supabase en los planes de pago (Authentication → Policies → «Leaked password protection»). Si está activa, la app muestra su error.
- **Sin enumeración:** contraseña incorrecta y email desconocido dan el mismo mensaje. Registrarse con un email existente lleva a la misma página. La recuperación responde igual a cualquier email.
- **`next`:** solo rutas de la propia app (`safeNext`). `//host`, `/\host`, esquemas y caracteres de control llevan a `/`. Las redirecciones usan `EXEGEZIS_APP_URL`, nunca la cabecera Host.
- **SSRF:** en un servidor compartido (una compilación de producción) la app no visita direcciones privadas.
  - Se rechazan loopback, redes privadas, link-local (169.254.x, metadatos de la nube), CGNAT y multicast, comprobando todas las IP a las que resuelve el nombre.
  - También se rechazan rutas de archivos del servidor (`storageState`).
  - Riesgo restante: el *DNS rebinding* (el navegador vuelve a resolver el nombre). En producción, bloquea también la salida hacia redes privadas en el cortafuegos del servidor.
  - Con `pnpm web` (desarrollo, en tu propio equipo) sí se permiten: así puedes inspeccionar tu app en `localhost`, usar un `storageState` y la ventana visible.
- **Lo que la app no muestra:** las rutas del servidor, el repositorio y los comandos de terminal.

## Landing ↔ app (el mismo servidor)

- `/`: sin sesión, la landing, en el idioma de la cookie o del navegador. La URL no cambia, y sin cookie de sesión ni se consulta a Supabase. Con sesión, la app.
- **Botones de la landing:**
  - «Iniciar sesión» → `/login?lang=…`;
  - «Empieza gratis» y «Probar Pro/Equipo» → `/signup?plan=…&lang=…`;
  - «Inspeccionar gratis» con URL → `/signup?next=/?url=…`. Quien ya tiene sesión pasa directo, porque el proxy le salta `/signup`.
  - Todo en el mismo dominio: sin CORS y sin cookies compartidas entre dominios.
- Tras el registro y la verificación, la app abre en la página Inspeccionar con la dirección escrita. Hace falta un clic en «Inspeccionar»: la app pide confirmar el permiso para cada dominio nuevo, y la inspección no se lanza sin ese paso.
- **Cabecera de la landing con sesión:** muestra «Ir a la app» y las iniciales.
  - Las lee de `EXEGEZIS_SIGNED_IN`, una cookie que no es secreta: solo lleva las iniciales, no la sesión, que sigue siendo httpOnly.
  - El proxy la pone al ver una sesión válida y la quita al cerrarla.
  - Así la landing sigue siendo estática y no existe `/api/session`.
- `next` lleva a la página que el usuario quería ver (validado: solo rutas de la propia app).
- En la app, el menú del usuario ofrece «Mi cuenta», «Ver planes» (`/producto#pricing`), «Ayuda» (`/producto#faq`) y «Cerrar sesión».
- **Legal:** `/privacidad`, `/terminos`, `/privacy` y `/terms` son **borradores marcados** («Borrador pendiente de revisión legal»).
  - El registro exige aceptarlos y guarda la fecha y la versión (`packages/accounts/src/legal.ts`). Cuando cambien los textos, cambia la versión.
  - El contacto de privacidad es `EXEGEZIS_PRIVACY_EMAIL`.

## Dar a una cuenta lo que ya hizo el CLI

```bat
pnpm exegezis account claim-local --dry-run
pnpm exegezis account claim-local
```

- Usa el mismo proyecto de Supabase que la app (`.env`): su URL y la service role key.
- Da a la primera cuenta creada (o a la de `--email`) lo que el CLI tiene en este equipo: `runs/`, los ajustes de búsqueda y los accesos guardados.
- Los copia a su carpeta y vuelve a cifrar los accesos con `EXEGEZIS_ACCESS_KEY`.
- Registra las ejecuciones en `runs` como suyas.
- Los originales se quedan para el CLI. Repetirlo no duplica nada.

## Desplegar en producción

1. **Supabase:** crea el proyecto y pega `supabase/setup.sql` en el SQL Editor (`pnpm db:setup`). Se puede repetir: solo crea lo que falta.
2. **Auth** (Dashboard):
   - Site URL = la URL de la app.
   - Redirect URLs = `https://app.exegezis.com/**`. Los enlaces vuelven a `/auth/callback?next=…`, y el patrón tiene que admitir esa consulta.
   - Email confirmations ON, longitud mínima 10, Manual linking ON y, si tu plan lo permite, Leaked password protection ON.
   - SMTP propio para que los emails salgan de tu dominio.
   - Para OAuth: proveedores Google y GitHub con callback `https://<ref>.supabase.co/auth/v1/callback`.
3. **App** (`apps/web`), en un servidor Node 22+ con Chromium:
   - Ejecuta `pnpm install`, `pnpm build:web` y `pnpm --filter @exegezis/web start`.
   - Configura detrás de un proxy https que ponga `X-Forwarded-For`.
   - Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secreta), `EXEGEZIS_APP_URL`, `EXEGEZIS_DATA_DIR` (un volumen persistente), `EXEGEZIS_ACCESS_KEY` (secreta), `EXEGEZIS_OAUTH_PROVIDERS`, `EXEGEZIS_PROXY_HOPS`, `EXEGEZIS_PRIVACY_EMAIL` y `EXEGEZIS_SALES_URL`.
   - `pnpm build:web` genera las páginas públicas como HTML estático.
   - Bloquea en el cortafuegos la salida a redes privadas y al servicio de metadatos.
4. **Comprobación:** `GET /api/health` responde `{ "ok": true }`.
5. **Copias de seguridad:** de Postgres se encarga Supabase. Tú, de `EXEGEZIS_DATA_DIR` y de `EXEGEZIS_ACCESS_KEY`, guardada aparte.

Fuera de esta versión: pagos (Stripe), equipos con varios usuarios y roles, SSO de empresa e inspecciones en paralelo. La cola de navegadores es de uno en uno por proceso.

## Tests

Sin Docker y sin proyecto de Supabase: todo corre en este equipo.

- `packages/accounts/test/setup-sql.test.ts`: `supabase/setup.sql` está al día con `supabase/migrations` y se puede aplicar dos veces.
- `packages/accounts/test/accounts.test.ts`: un Postgres real (PGlite) con `supabase/setup.sql`, a través de un sustituto de la API de datos de Supabase (`packages/accounts/test/rest-standin.ts`), con dos usuarias, cada una con su sesión, y el operador con la service role key. Comprueba:
  - lecturas, ediciones, borrados e inserciones a nombre de otra;
  - el plan, los consentimientos, los límites de intentos, `anon`, la exportación y el borrado en cascada;
  - además, los límites del plan, `claim-local`, `next` y las reglas de contraseña.
- `apps/cli/test/account.test.ts` prueba `claim-local`.
- Las pruebas de extremo a extremo de la app arrancan la app real (`next dev`) con `apps/web/test/support/app.ts`:
  - PGlite y un sustituto de Supabase (`apps/web/test/support/auth-standin.ts`: Auth, la API de datos y un buzón con los emails que enviaría);
  - cada archivo con su propia carpeta de compilación, de datos y base de datos: un `pnpm web` en marcha no se toca.
- `apps/web/test/accounts.e2e.test.ts` (cuentas), con un navegador real:
  - registro → email → login → inspección → logout;
  - recuperación de contraseña y OAuth simulado con la pantalla de términos;
  - aislamiento entre dos usuarios en páginas, API, artefactos, specs, trabajos y exportación;
  - límites del plan Gratis, límite de intentos, `next` y cierre de sesión en todos los dispositivos;
  - exportación y borrado de cuenta;
  - accesibilidad AA (axe) y ausencia de scroll horizontal a 375 px en las pantallas de cuenta, en los dos idiomas y temas.
- `apps/web/test/site.e2e.test.ts` (páginas públicas) e `i18n-e2e.test.ts` (toda la app en los dos idiomas). La de idiomas inicia sesión con un usuario de prueba cuya carpeta de ejecuciones enlaza a `runs/` del repositorio.
- Los scripts de capturas (`pnpm design:compare`, `apps/web/scripts/screenshots.mjs`, `site-screenshots.mjs`) usan el mismo arnés.

## Paso a paso en Windows (CMD)

Igual que en Transcriptor: un proyecto en supabase.com, tres claves en `.env` y un archivo SQL pegado en el panel. EXEGEZIS tiene **su propio proyecto**: no uses el de Transcriptor.

### 1. Crea el proyecto

1. Entra en https://supabase.com/dashboard y pulsa **New project**.
2. Elige una organización gratuita (Free), ponle de nombre `exegezis` y pulsa **Create new project**. La contraseña de la base de datos no la vas a necesitar.
3. Espera un par de minutos a que diga que está listo.

### 2. Copia las claves en `.env`

En el proyecto: **Project Settings → API Keys**.

```bat
cd C:\Users\PC_SYSTEM\Documents\GitHub\EXEGEZIS
notepad .env
```

Pega estas tres líneas con tus valores (si ya tienes `SUPABASE_URL` y `SUPABASE_ANON_KEY` de antes, también sirven; solo añade la tercera):

```
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=la clave anon public
SUPABASE_SERVICE_ROLE_KEY=la clave service_role
```

- La URL está arriba en esa misma página (o en **Project Settings → Data API**).
- Las claves están en la pestaña **Legacy API Keys**: `anon` `public` y `service_role` (pulsa **Reveal** para verla). También sirven las nuevas `publishable` y `secret`.
- La `service_role` es secreta: no la compartas. `.env` no se sube a GitHub.

Guarda y cierra el Bloc de notas.

### 3. Crea las tablas

```bat
pnpm db:setup
```

Se abre el SQL Editor de tu proyecto con todo copiado: pega con **Ctrl+V** y pulsa **Run**. Debe decir «Success. No rows returned». Se puede repetir sin problema.

### 4. Direcciones de retorno

En el proyecto: **Authentication → URL Configuration**.

- **Site URL:** `http://127.0.0.1:4100`
- **Redirect URLs:** pulsa **Add URL** y pon `http://127.0.0.1:4100/**`

En **Authentication → Sign In / Providers**: deja **Confirm email** activado y, en **Email**, pon **Minimum password length** en `10`.

### 5. Arranca y regístrate

```bat
pnpm web
```

1. Abre http://127.0.0.1:4100: verás la landing.
2. Pulsa **Empieza gratis**, rellena el registro y acepta los términos.
3. Abre el correo de confirmación y pulsa el enlace: entras en la app.

El correo de prueba de Supabase envía pocos mensajes por hora. Si no llega, espera unos minutos y usa «Reenviar».

### Opcional

- Lo que ya hiciste con el CLI, a tu cuenta: `pnpm exegezis account claim-local`.
- Google o GitHub: **Authentication → Providers**, y luego `EXEGEZIS_OAUTH_PROVIDERS=google,github` en `.env`.
