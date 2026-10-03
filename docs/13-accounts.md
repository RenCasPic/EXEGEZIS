# 13 — Cuentas de usuario

La app web de EXEGEZIS funciona como cualquier web app: tiene cuentas (Supabase Auth) y cada usuario solo ve lo suyo.

- Quien entra sin sesión ve primero la landing. Desde ella se registra o inicia sesión, y entonces usa las funcionalidades.
- Hay un solo modo y un solo archivo de configuración: `.env` (desde `.env.example`), con las variables de Supabase.
- `pnpm web` comprueba antes de arrancar que `.env` tiene `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL` y `EXEGEZIS_APP_URL`, y dice cuáles faltan.
- La app, sus páginas públicas (landing y legales) y el inicio de sesión están en un solo servidor y un solo dominio: http://127.0.0.1:4100 en tu equipo (ver `docs/12-site.md`).
- El CLI (`pnpm exegezis …`) y los benchmarks no usan cuentas: siguen escribiendo en `runs/` de este equipo.
- Los tests nunca leen `.env`: arrancan su propia base de datos y un sustituto de Supabase Auth (ver «Tests»).

## Arquitectura

```
Un servidor (apps/web, Next.js), un dominio                                        Supabase
 /producto · /product · /privacidad · …  estáticas: el proxy no pasa por ellas
 /  sin sesión ──▶ la landing (misma URL)    con sesión ──▶ la app
 /login, /signup, /auth/callback … ────────────────────────────────────────────▶  Auth (GoTrue): contraseñas,
 proxy.ts: refresca la sesión,                                                      emails, OAuth, sesiones
   /login?next=… si no hay
 Server actions / route handlers ──────────────────────────────────────────────▶  Postgres (RLS en todas
   (rol `authenticated` + claims del usuario en cada transacción)                   las tablas): profiles,
 EXEGEZIS_DATA_DIR/users/<id>/  runs/ access/ search/   (disco)                     consents, projects, runs,
                                                                                    waitlist, rate_limits
```

- **Autenticación:** Supabase Auth, con `@supabase/ssr` en el servidor.
  - El navegador no tiene cliente de Supabase. Las cookies de sesión son httpOnly, SameSite=Lax y Secure en https.
  - EXEGEZIS nunca ve ni guarda contraseñas: van directas a Supabase.
- **Datos:** la app se conecta a Postgres con `DATABASE_URL`, como propietaria de la base de datos.
  - Todo lo que hace por un usuario va dentro de `asUser()` (`packages/accounts/src/store.ts`).
  - Dentro de esa transacción pone `set local role authenticated` y las claims del usuario (`request.jwt.claims`), las mismas que pondría PostgREST. Así las políticas RLS deciden qué puede leer o escribir.
  - Solo las tareas de operador usan la conexión de propietario directamente: límites de intentos, borrar una cuenta y asignar los datos del CLI.
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

- Solo necesita `DATABASE_URL` en `.env`.
- Da a la primera cuenta creada (o a la de `--email`) lo que el CLI tiene en este equipo: `runs/`, los ajustes de búsqueda y los accesos guardados.
- Los copia a su carpeta y vuelve a cifrar los accesos con `EXEGEZIS_ACCESS_KEY`.
- Registra las ejecuciones en `runs` como suyas.
- Los originales se quedan para el CLI. Repetirlo no duplica nada.

## Desplegar en producción

1. **Supabase:** crea el proyecto y aplica la migración.
   - Con la CLI: `npx supabase link --project-ref <ref>` y `npx supabase db push`.
   - O pega `supabase/migrations/*.sql` en el SQL Editor.
2. **Auth** (Dashboard):
   - Site URL = la URL de la app.
   - Redirect URLs = `https://app.exegezis.com/**`. Los enlaces vuelven a `/auth/callback?next=…`, y el patrón tiene que admitir esa consulta.
   - Email confirmations ON, longitud mínima 10, Manual linking ON y, si tu plan lo permite, Leaked password protection ON.
   - SMTP propio para que los emails salgan de tu dominio.
   - Para OAuth: proveedores Google y GitHub con callback `https://<ref>.supabase.co/auth/v1/callback`.
3. **App** (`apps/web`), en un servidor Node 22+ con Chromium:
   - Ejecuta `pnpm install`, `pnpm build:web` y `pnpm --filter @exegezis/web start`.
   - Configura detrás de un proxy https que ponga `X-Forwarded-For`.
   - Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL` (secreta), `EXEGEZIS_APP_URL`, `EXEGEZIS_DATA_DIR` (un volumen persistente), `EXEGEZIS_ACCESS_KEY` (secreta), `EXEGEZIS_OAUTH_PROVIDERS`, `EXEGEZIS_PROXY_HOPS`, `EXEGEZIS_PRIVACY_EMAIL` y `EXEGEZIS_SALES_URL`.
   - `pnpm build:web` genera las páginas públicas como HTML estático.
   - Bloquea en el cortafuegos la salida a redes privadas y al servicio de metadatos.
4. **Comprobación:** `GET /api/health` responde `{ "ok": true }`.
5. **Copias de seguridad:** de Postgres se encarga Supabase. Tú, de `EXEGEZIS_DATA_DIR` y de `EXEGEZIS_ACCESS_KEY`, guardada aparte.

Fuera de esta versión: pagos (Stripe), equipos con varios usuarios y roles, SSO de empresa e inspecciones en paralelo. La cola de navegadores es de uno en uno por proceso.

## Tests

- `packages/accounts/test/accounts.test.ts` usa un Postgres real (PGlite) con las migraciones. Comprueba con dos usuarios:
  - lecturas, ediciones, borrados e inserciones a nombre de otro;
  - el plan, los consentimientos, los límites de intentos, `anon`, la exportación y el borrado en cascada;
  - además, los límites del plan, `next` y las reglas de contraseña.
- `apps/cli/test/account.test.ts` prueba `claim-local`.
- Las pruebas de extremo a extremo de la app arrancan la app real (`next dev`) con `apps/web/test/support/app.ts`:
  - sin Docker, con PGlite y un sustituto de Supabase Auth (`apps/web/test/support/auth-standin.ts`), que habla la misma API HTTP que Supabase y guarda los emails como Mailpit;
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
- Con un Supabase local de verdad corre lo mismo, salvo el OAuth simulado:

  ```bat
  npx supabase start
  set EXEGEZIS_TEST_SUPABASE=1
  set SUPABASE_URL=http://127.0.0.1:54321
  set SUPABASE_ANON_KEY=<anon key de supabase status>
  set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
  set MAILPIT_URL=http://127.0.0.1:54324
  pnpm vitest run apps/web/test/accounts.e2e.test.ts
  ```

## Paso a paso en Windows (CMD), desde la carpeta del repositorio

### 1. Con tu proyecto de Supabase

1. En https://supabase.com abre tu proyecto (o crea uno; región en la UE si tus usuarios están en Europa). Ten a mano la contraseña de la base de datos.
2. Aplica la migración de EXEGEZIS (crea las tablas, las políticas RLS y el disparador de perfiles):

   ```bat
   npx supabase login
   npx supabase link --project-ref TU_REF
   npx supabase db push
   ```

   `TU_REF` es lo que va entre `https://` y `.supabase.co` en la URL del proyecto.
3. En el panel del proyecto:
   - Authentication → URL Configuration:
     - Site URL = `http://127.0.0.1:4100` (o la URL donde publiques la app);
     - Redirect URLs = `http://127.0.0.1:4100/**`.
   - Authentication → Providers → Email:
     - «Confirm email» activado;
     - «Minimum password length» = 10.
   - Authentication → Sign In / Up: «Manual linking» activado.
   - Authentication → Policies (si tu plan lo permite): «Leaked password protection» activado.
   - Authentication → Emails → SMTP: tu servidor de correo. El de Supabase sirve para probar, pero envía pocos emails por hora.
4. Pon los datos en tu `.env` (si no existe: `copy .env.example .env`):

   ```bat
   notepad .env
   ```

   - `SUPABASE_URL=` y `SUPABASE_ANON_KEY=`: Project Settings → API (la URL y la clave «anon public»).
   - `DATABASE_URL=`: Connect → Session pooler, con tu contraseña.
   - `EXEGEZIS_APP_URL=http://127.0.0.1:4100`
   - `EXEGEZIS_ACCESS_KEY=`: lo que imprime

     ```bat
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     ```

   Tu `EXEGEZIS_ANTHROPIC_API_KEY` se queda como está.
5. Arranca la app (landing, inicio de sesión y app en un solo servidor):

   ```bat
   pnpm web
   ```

6. Prueba de principio a fin:
   1. Abre http://127.0.0.1:4100. Sin sesión verás la landing; pulsa «Empieza gratis», rellena el registro y acepta los términos.
   2. Abre el email «Confirm your signup» y pulsa el enlace. Entras en la app con tu cuenta.
   3. Haz una inspección.
   4. Cierra la sesión desde el menú del usuario (arriba a la derecha). En http://127.0.0.1:4100 vuelves a ver la landing.
   5. Prueba «¿Has olvidado tu contraseña?».
7. Da a tu cuenta lo que ya habías hecho con el CLI:

   ```bat
   pnpm exegezis account claim-local --dry-run
   pnpm exegezis account claim-local
   ```

8. Google y GitHub (opcional): Authentication → Providers. Crea la app en Google Cloud o GitHub con el callback que muestra Supabase y pega su id y su secreto. Luego pon `EXEGEZIS_OAUTH_PROVIDERS=google,github` en `.env`.

### 2. Con Supabase en tu equipo (sin internet, para probar)

1. Instala **Docker Desktop** (docker.com → Docker Desktop for Windows) y ábrelo. Espera a que diga «Engine running».
2. Arranca Supabase. La primera vez descarga sus imágenes (unos minutos) y aplica `supabase/migrations`:

   ```bat
   npx supabase start
   ```

   Al terminar imprime `API URL`, `anon key` y `DB URL`. Para verlos de nuevo: `npx supabase status`.
3. En `.env`:
   - `SUPABASE_URL=http://127.0.0.1:54321`
   - `SUPABASE_ANON_KEY=` la «anon key»
   - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
   - `EXEGEZIS_APP_URL=http://127.0.0.1:4100`
4. `pnpm web` y prueba como en el paso 1.6. Los emails llegan al buzón local: http://127.0.0.1:54324.
5. Para parar Supabase:

   ```bat
   npx supabase stop
   ```
