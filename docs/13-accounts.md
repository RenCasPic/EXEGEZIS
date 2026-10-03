# 13 — Cuentas de usuario y modo nube

EXEGEZIS funciona de dos maneras, según `EXEGEZIS_MODE`:

| Modo | Para qué | Cuentas | Datos |
|---|---|---|---|
| `local` (por defecto) | Una persona en su equipo | No hay login. Solo en 127.0.0.1 | `runs/`, accesos y búsquedas en las carpetas de siempre |
| `cloud` | Un servicio con muchas personas | Login obligatorio (Supabase Auth) | Cada usuario solo ve lo suyo |

El modo local no cambia nada de lo que existía: sin login, sin base de datos y con los mismos benchmarks.

## Arquitectura

```
Landing (apps/site, estática)          App (apps/web, Next.js)                    Supabase
 «Iniciar sesión» ───────────────────▶  /login, /signup, …  ───────────────────▶  Auth (GoTrue): contraseñas,
 «Empieza gratis / Probar…» ─────────▶  /signup?plan=…                            emails, OAuth, sesiones
 «Inspeccionar gratis» + URL ────────▶  /signup?next=/?url=…
 cabecera: fetch /api/session ◀──────  (CORS solo para la landing)
                                        proxy.ts: refresca la sesión,             Postgres (RLS en todas
                                        /login?next=… si no hay                    las tablas)
                                        Server actions / route handlers ──────▶   profiles, consents, projects,
                                        (rol `authenticated` + claims del          runs, waitlist, rate_limits
                                        usuario en cada transacción)
                                        EXEGEZIS_DATA_DIR/users/<id>/             (disco)
                                          runs/ access/ search/
```

- **Autenticación:** Supabase Auth, con `@supabase/ssr` en el servidor.
  - El navegador no tiene cliente de Supabase. Las cookies de sesión son httpOnly, SameSite=Lax y Secure en https.
  - EXEGEZIS nunca ve ni guarda contraseñas: van directas a Supabase.
- **Datos:** la app se conecta a Postgres con `DATABASE_URL`, como propietaria de la base de datos.
  - Todo lo que hace por un usuario va dentro de `asUser()` (`packages/accounts/src/store.ts`).
  - Dentro de esa transacción pone `set local role authenticated` y las claims del usuario (`request.jwt.claims`), las mismas que pondría PostgREST. Así las políticas RLS deciden qué puede leer o escribir.
  - Solo las tareas de operador usan la conexión de propietario directamente: límites de intentos, borrar una cuenta y asignar los datos locales.
- **Artefactos:** capturas, trazas y DOM siguen en disco, en una carpeta por usuario (`EXEGEZIS_DATA_DIR/users/<id>/`).
  - `currentWorkspace()` (`apps/web/src/lib/user-workspace.ts`) da esa carpeta a cada petición.
  - El descubrimiento, los trabajos, la CLI que lanza la app (`EXEGEZIS_RUNS_DIR`, `EXEGEZIS_ACCESS_DIR`, `EXEGEZIS_SEARCH_DIR`), los accesos y las búsquedas solo leen esa carpeta.
  - Los resultados del repositorio (`benchmarks/*/results`) no se muestran en modo nube.
  - El aislamiento es estructural: un id de otro usuario no se encuentra, así que la respuesta es 404 (páginas, `/api/artifacts`, descarga de specs, trabajos, exportación).
- **Accesos guardados:** siguen cifrados (AES-256-GCM), ahora uno por usuario.
  - En un servidor sin llavero del sistema, la clave de cada usuario se protege con `EXEGEZIS_ACCESS_KEY` (`ServerKeyProtector`).
  - La ventana visible para iniciar sesión en un sitio solo existe en modo local: en un servidor nadie la vería. En la nube se pueden guardar un usuario HTTP o un token del WAF.
- **Planes:** `packages/accounts/src/pricing.ts` es el mismo archivo que muestra la landing (`apps/site/content/pricing.ts` lo reexporta).
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
- **SSRF:** en modo nube la app no visita direcciones privadas.
  - Se rechazan loopback, redes privadas, link-local (169.254.x, metadatos de la nube), CGNAT y multicast, comprobando todas las IP a las que resuelve el nombre.
  - También se rechazan rutas de archivos del servidor (`storageState`).
  - Riesgo restante: el *DNS rebinding* (el navegador vuelve a resolver el nombre). En producción, bloquea también la salida hacia redes privadas en el cortafuegos del servidor.
  - `EXEGEZIS_ALLOW_PRIVATE_TARGETS=1` existe solo para los tests y para probar el modo nube en local. Una compilación de producción lo ignora.
- **Lo que se oculta en la nube:** las rutas del servidor, el repositorio y los comandos de terminal.

## Landing ↔ app

- La landing es estática. Con `NEXT_PUBLIC_EXEGEZIS_MODE=cloud`, sus botones van a la app:
  - «Iniciar sesión» → `/login?lang=…`;
  - «Empieza gratis» y «Probar Pro/Equipo» → `/signup?plan=…&lang=…`;
  - «Inspeccionar gratis» con URL → `/signup?next=/?url=…`. Quien ya tiene sesión pasa directo a la app, porque el proxy le salta `/signup`.
- Tras el registro y la verificación, la app abre en la página Inspeccionar con la dirección escrita. Hace falta un clic en «Inspeccionar»: la app pide confirmar el permiso para cada dominio nuevo, y la inspección no se lanza sin ese paso.
- La cabecera de la landing pregunta a `/api/session` (CORS solo para `EXEGEZIS_SITE_URL`, con credenciales). Con sesión, muestra «Ir a la app» y las iniciales del usuario.
- `next` lleva a la página que el usuario quería ver (validado).
- En la app, el menú del usuario ofrece «Mi cuenta», «Ver planes» (`#pricing` de la landing), «Ayuda» (`#faq`) y «Cerrar sesión».
- **Dominios:**
  - Landing en `exegezis.com` y app en `app.exegezis.com`: son del mismo sitio, así que la cookie SameSite=Lax viaja en las peticiones de la landing a `/api/session` sin compartirla entre dominios.
  - `EXEGEZIS_COOKIE_DOMAIN=.exegezis.com` solo hace falta si otra parte necesita la sesión.
  - En local: 4200 (landing) y 4100 (app).
- **Legal:** `/es/privacidad`, `/es/terminos`, `/en/privacy` y `/en/terms` son **borradores marcados** («Borrador pendiente de revisión legal»).
  - El registro exige aceptarlos y guarda la fecha y la versión (`packages/accounts/src/legal.ts`). Cuando cambien los textos, cambia la versión.
  - El contacto de privacidad es `NEXT_PUBLIC_EXEGEZIS_PRIVACY_EMAIL`.

## Asignar los datos locales a una cuenta

```bat
pnpm exegezis account claim-local --dry-run
pnpm exegezis account claim-local
```

- Da a la primera cuenta creada (o a la de `--email`) lo que hay en este equipo: `runs/`, los ajustes de búsqueda y los accesos guardados.
- Los copia a su carpeta y vuelve a cifrar los accesos con `EXEGEZIS_ACCESS_KEY`.
- Registra las ejecuciones en `runs` como suyas.
- Los originales se quedan para el modo local. Repetirlo no duplica nada.

## Desplegar en producción

1. **Supabase:** crea el proyecto y aplica la migración.
   - Con la CLI: `npx supabase link --project-ref <ref>` y `npx supabase db push`.
   - O pega `supabase/migrations/*.sql` en el SQL Editor.
2. **Auth** (Dashboard):
   - Site URL = la URL de la app.
   - Redirect URLs = `https://app.exegezis.com/auth/callback`.
   - Email confirmations ON, longitud mínima 10, Manual linking ON y, si tu plan lo permite, Leaked password protection ON.
   - SMTP propio para que los emails salgan de tu dominio.
   - Para OAuth: proveedores Google y GitHub con callback `https://<ref>.supabase.co/auth/v1/callback`.
3. **App** (`apps/web`), en un servidor Node 22+ con Chromium:
   - Ejecuta `pnpm install`, `pnpm build:web` y `pnpm --filter @exegezis/web start`.
   - Configura detrás de un proxy https que ponga `X-Forwarded-For`.
   - Variables: `EXEGEZIS_MODE=cloud`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL` (secreta), `EXEGEZIS_APP_URL`, `EXEGEZIS_SITE_URL`, `EXEGEZIS_DATA_DIR` (un volumen persistente), `EXEGEZIS_ACCESS_KEY` (secreta), `EXEGEZIS_OAUTH_PROVIDERS` y `EXEGEZIS_PROXY_HOPS`.
   - Bloquea en el cortafuegos la salida a redes privadas y al servicio de metadatos.
4. **Landing** (`apps/site`):
   - Compila con `NEXT_PUBLIC_EXEGEZIS_MODE=cloud`, `NEXT_PUBLIC_EXEGEZIS_APP_URL`, `NEXT_PUBLIC_EXEGEZIS_SITE_URL` y `NEXT_PUBLIC_EXEGEZIS_PRIVACY_EMAIL` (`pnpm build:site`).
   - Sube `apps/site/out/` a cualquier alojamiento estático.
5. **Comprobación:** `GET /api/health` responde `{ "ok": true, "mode": "cloud" }`.
6. **Copias de seguridad:** de Postgres se encarga Supabase. Tú, de `EXEGEZIS_DATA_DIR` y de `EXEGEZIS_ACCESS_KEY`, guardada aparte.

Fuera de esta versión: pagos (Stripe), equipos con varios usuarios y roles, SSO de empresa e inspecciones en paralelo. La cola de navegadores es de uno en uno por proceso.

## Tests

- `packages/accounts/test/accounts.test.ts` usa un Postgres real (PGlite) con las migraciones. Comprueba con dos usuarios:
  - lecturas, ediciones, borrados e inserciones a nombre de otro;
  - el plan, los consentimientos, los límites de intentos, `anon`, la exportación y el borrado en cascada;
  - además, los límites del plan, `next` y las reglas de contraseña.
- `apps/cli/test/account.test.ts` prueba `claim-local`.
- `apps/web/test/cloud.e2e.test.ts` usa un navegador real y la app real en modo nube:
  - registro → email → login → inspección → logout;
  - recuperación de contraseña y OAuth simulado con la pantalla de términos;
  - aislamiento entre dos usuarios en páginas, API, artefactos, specs, trabajos y exportación;
  - límites del plan Gratis, límite de intentos, `next` y cierre de sesión en todos los dispositivos;
  - exportación y borrado de cuenta;
  - accesibilidad AA (axe) y ausencia de scroll horizontal a 375 px en las pantallas nuevas, en los dos idiomas y temas.
- Sin Docker, ese test usa PGlite y un sustituto de Supabase Auth (`apps/web/test/support/auth-standin.ts`). Habla la misma API HTTP que Supabase y guarda los emails como Mailpit.
- Con un Supabase local de verdad corre lo mismo, salvo el OAuth simulado:

  ```bat
  npx supabase start
  set EXEGEZIS_TEST_SUPABASE=1
  set SUPABASE_URL=http://127.0.0.1:54321
  set SUPABASE_ANON_KEY=<anon key de supabase status>
  set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
  set MAILPIT_URL=http://127.0.0.1:54324
  pnpm vitest run apps/web/test/cloud.e2e.test.ts
  ```

## Paso a paso en Windows (CMD), desde la carpeta del repositorio

### 1. Supabase en tu equipo (para probar)

1. Instala **Docker Desktop** (docker.com → Docker Desktop for Windows) y ábrelo. Espera a que diga «Engine running».
2. Arranca Supabase. La primera vez descarga sus imágenes (unos minutos) y aplica `supabase/migrations`:

   ```bat
   npx supabase start
   ```

   Al terminar imprime `API URL`, `anon key` y `DB URL`. Para verlos de nuevo: `npx supabase status`.
3. Crea tu `.env`:

   ```bat
   copy .env.example .env
   notepad .env
   ```

   Rellena:
   - `EXEGEZIS_MODE=cloud`;
   - `SUPABASE_URL=http://127.0.0.1:54321`;
   - `SUPABASE_ANON_KEY=` con la «anon key»;
   - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`;
   - `NEXT_PUBLIC_EXEGEZIS_MODE=cloud`;
   - `EXEGEZIS_ACCESS_KEY=` con lo que imprime:

   ```bat
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

4. Arranca la app y la landing, cada una en su ventana de CMD:

   ```bat
   pnpm web
   ```

   ```bat
   pnpm site
   ```

5. Prueba el registro de principio a fin:
   1. Abre http://127.0.0.1:4200/es/ y pulsa «Empieza gratis». Rellena el registro y acepta los términos.
   2. Abre el buzón local en http://127.0.0.1:54324, abre el email «Confirm your signup» y pulsa el enlace. Entras en la app con tu cuenta.
   3. Haz una inspección de una web pública.
   4. Cierra la sesión desde el menú del usuario (arriba a la derecha).
   5. Prueba «¿Has olvidado tu contraseña?» y vuelve a mirar el buzón.
6. Da a tu cuenta lo que ya tenías en modo local:

   ```bat
   pnpm exegezis account claim-local --dry-run
   pnpm exegezis account claim-local
   ```

7. Para volver al modo local, pon `EXEGEZIS_MODE=local` y `NEXT_PUBLIC_EXEGEZIS_MODE=local` en `.env`. Para parar Supabase:

   ```bat
   npx supabase stop
   ```

### 2. Tu proyecto de Supabase en la nube

1. En https://supabase.com crea una cuenta y un proyecto (región en la UE si tus usuarios están en Europa). Guarda la contraseña de la base de datos.
2. Aplica la migración:

   ```bat
   npx supabase login
   npx supabase link --project-ref TU_REF
   npx supabase db push
   ```

   `TU_REF` es lo que va entre `https://` y `.supabase.co` en la URL del proyecto.
3. En el panel del proyecto:
   - Project Settings → API: copia la URL y la «anon public» key en `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
   - Connect → Session pooler: copia la cadena de conexión en `DATABASE_URL`, con tu contraseña.
   - Authentication → URL Configuration:
     - Site URL = la URL de la app;
     - Redirect URLs = `<URL de la app>/auth/callback`.
   - Authentication → Providers → Email:
     - «Confirm email» activado;
     - «Minimum password length» = 10.
   - Authentication → Policies (si tu plan lo permite): «Leaked password protection» activado.
   - Authentication → Sign In / Up: «Manual linking» activado.
   - Authentication → Emails → SMTP: tu servidor de correo. El de Supabase sirve para probar, pero envía pocos emails por hora.
   - Google y GitHub (opcional): Authentication → Providers. Crea la app en Google Cloud o GitHub con el callback que muestra Supabase y pega su id y su secreto. Luego pon `EXEGEZIS_OAUTH_PROVIDERS=google,github` en `.env`.
4. Pon esos valores en `.env`, arranca `pnpm web` y prueba como en el paso 1.5.
