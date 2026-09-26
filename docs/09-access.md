# 09 — Accesos: bloqueos clasificados y soluciones legítimas

Estado: **aprobado por René el 2026-09-26**, con las decisiones y los ajustes de la §7.

**Principios:**
1. EXEGEZIS no evade nada. No resuelve CAPTCHAs, no cambia el User-Agent ni la huella del navegador, no usa plugins stealth ni proxies. Siempre se identifica como `EXEGEZIS-Inspector/<versión>`.
2. Lo que requiere a una persona lo hace la persona, en una ventana visible.
3. Sesiones, credenciales y tokens se tratan como contraseñas.
4. Un bloqueo nunca genera hallazgos sobre el sitio.

## 1. Tipos de bloqueo

En el informe, la página y la inspección siguen en `BLOCKED`, el código de salida sigue siendo 4 y los informes antiguos cargan igual. Lo nuevo es un campo `block` con el tipo, la evidencia (URL final, estado HTTP, las cabeceras relevantes, los *nombres* de cookies —nunca sus valores—, los marcadores DOM y una captura) y la solución. La UI y el CLI muestran el tipo: «BLOCKED · LOGIN_WALL».

**Orden de detección.** Se aplica el primero que coincide:

HTTP_AUTH → BOT_CHALLENGE → SESSION_EXPIRED → LOGIN_WALL → CONSENT_WALL → RATE_LIMITED → FORBIDDEN

| Tipo | Se detecta por | Solución |
|---|---|---|
| HTTP_AUTH | 401 + `WWW-Authenticate: Basic\|Digest` en el documento | Formulario «usuario y contraseña de este sitio». Lo rellena la persona, se guarda cifrado y se usa como `httpCredentials` |
| BOT_CHALLENGE | Marcadores DOM: iframe o `.cf-turnstile` de `challenges.cloudflare.com`, `#challenge-form`, `.g-recaptcha`, `.h-captcha`, `captcha-delivery.com` (DataDome), `#px-captcha`, «Access Denied… Reference #» (Akamai). Cabeceras: `cf-mitigated: challenge`, `x-datadome`. Cookies conocidas (`cf_clearance`, `__cf_bm`, `datadome`, `_abck`, `_px*`) | **A (recomendada, sitio propio):** token del WAF (§3). **B:** la persona pasa la verificación en la ventana visible, tras confirmar «sitio propio o con permiso». Si el desafío reaparece, se para. Nunca hay reintentos contra el desafío |
| SESSION_EXPIRED | Había una sesión guardada para el origen y aparece un muro de login (según la regla de LOGIN_WALL) o un 401 | Botón «Renovar acceso». Al guardarse, la inspección se relanza sola con las mismas opciones |
| LOGIN_WALL | Solo en uno de estos dos casos: **(1)** se pidió una URL que no es de login y se acabó en una ruta de login (`/login`, `/sign-in`, `/signin`, `/auth`, `/account/login`, `/users/sign_in`, o parámetros `?next=` / `?returnUrl=`); **(2)** el contenido pedido no está y la página es principalmente un formulario de login: un campo de contraseña visible y poco más (menos de 60 palabras fuera del formulario y ningún `main`/`article` con contenido). Un 401 sin `WWW-Authenticate` también cuenta. **No es un muro:** una caja de login en la cabecera con el contenido visible, ni inspeccionar directamente una URL de login (p. ej. `/sign-in`), que se inspecciona como cualquier página | «Abrir ventana para acceder»: la persona inicia sesión y se guarda la sesión |
| CONSENT_WALL | Diálogo visible de un gestor de consentimiento conocido (OneTrust, Cookiebot, Didomi, Usercentrics, Quantcast, TrustArc, CookieYes, Complianz) que cubre ≥ 30 % de la vista, o un elemento fijo con texto de cookies o consentimiento que cubre ≥ 50 % y bloquea el scroll | «Abrir ventana para elegir». La persona elige en el banner; la opción por defecto que se recomienda es la más privada. La elección se guarda como sesión. La inspección nunca pulsa el banner |
| RATE_LIMITED | 429, o 503 con `Retry-After` | Automática: respeta `Retry-After`, reduce el ritmo con backoff exponencial (tope: 60 s por espera y 5 minutos en total) y continúa. Si se supera el tope, para y dice cuánto esperar |
| FORBIDDEN | 403 sin marcadores de desafío | Explica la causa probable (IP, país, WAF) y qué hacer: lista blanca de IP u opción A de BOT_CHALLENGE. Sin reintentos |
| ROBOTS_EXCLUDED | Páginas `SKIPPED_ROBOTS`: es por página, no bloquea la inspección | Ajuste por sitio, que se recuerda: «Este sitio es mío: inspeccionar también lo que robots.txt excluye» |

**NETWORK_RESTRICTED no es un bloqueo del sitio.** Es un subtipo de UNREACHABLE: «UNREACHABLE · NETWORK_RESTRICTED». Se detecta por `ERR_NAME_NOT_RESOLVED` sobre un nombre de dominio, un dominio que resuelve a una IP privada o errores de proxy o túnel. Se explica la causa (VPN, intranet, DNS privado) y no hay reintentos. Un puerto que simplemente no responde sigue siendo UNREACHABLE sin subtipo.

## 2. Almacenamiento de accesos (cifrado)

**Ubicación.** Todo va fuera del repositorio:
- Windows: `%LOCALAPPDATA%\EXEGEZIS\access\`;
- macOS: `~/Library/Application Support/EXEGEZIS/access/`;
- Linux: `$XDG_DATA_HOME/exegezis/access/`.

**Qué se guarda por origen.** Un archivo `<sha256(origen)>.bin`: un JSON con `{storageState?, httpCredentials?, wafToken?}` cifrado con AES-256-GCM (`node:crypto`, nonce aleatorio, sin dependencias nuevas). Aparte, `index.json` contiene solo metadatos, sin nada secreto: origen, tipos de acceso, fecha de creación, último uso, caducidad estimada (la cookie de sesión que caduque antes) y los ajustes del sitio (robots, patrones de enlaces peligrosos).

**Alcance de la sesión.** Solo se guardan las cookies y el storage del origen inspeccionado y sus subdominios. Si el login pasa por un proveedor externo (Google, Microsoft, Auth0…), sus cookies y su storage **no** se guardan.

**Clave maestra.** Son 32 bytes aleatorios, creados una vez y protegidos por el sistema operativo:
- **Windows, DPAPI** (ámbito del usuario actual). Se usa llamando a `powershell.exe -NoProfile -NonInteractive` con `ProtectedData.Protect/Unprotect`. La clave y los datos van **siempre por stdin, nunca como argumento** (los argumentos los pueden ver otros procesos). Si una política del sistema bloquea PowerShell, se da un error claro con esa causa. Es un subproceso interno: René sigue usando solo CMD.
  - Una sesión cifrada con DPAPI **solo se abre con este usuario de Windows en este equipo**. En otro equipo u otro usuario hay que volver a iniciarla. Así se dice en Ajustes → Accesos y en el mensaje, nunca como un error críptico.
- **macOS, Keychain**: `security add-generic-password` / `find-generic-password`.
- **Linux, libsecret**: `secret-tool store` / `lookup`. Si `secret-tool` no está, **no se guarda nada** y se dice cómo instalarlo (`sudo apt install libsecret-tools` o el equivalente de la distribución). No hay frase de paso.

**Uso.** Solo el proceso del CLI descifra, y en memoria. La sesión se pasa a Playwright como objeto (`newContext({ storageState: objeto, httpCredentials })`), sin archivos temporales. El token del WAF se añade como `X-Exegezis-Token` con `context.route`, solo en las peticiones a ese origen; nunca va a terceros. La web solo lee `index.json`.

**Borrado.** «Borrar» elimina el archivo cifrado y su entrada en el índice.

## 3. Ventana visible y token del WAF

**`exegezis session login --url <sitio>`** (también el botón «Abrir ventana para acceder»):
1. Abre una ventana **visible** del mismo canal que resuelve el motor (`auto`: Chromium de Playwright, si no Chrome, si no Edge), con el mismo User-Agent y sin tocar la huella.
2. La persona inicia sesión, pasa la verificación o elige en el banner. EXEGEZIS no teclea, no lee los campos y no guarda la contraseña: solo el estado final del navegador (cookies y almacenamiento del origen), que Playwright exporta.
3. Termina cuando la persona pulsa «Listo» en la UI de EXEGEZIS (o Enter en el terminal) o cierra la ventana.
4. Antes de guardar, recarga la URL en ese mismo contexto y la clasifica. Solo si el bloqueo ya no está se guarda cifrado. Si sigue, no se guarda nada y se dice qué se detectó.

**Otros comandos:** `session list`, `session delete --url`, `session http-auth --url` (pide la contraseña en el terminal sin mostrarla) y `session waf-token --url` (crea o rota el token y muestra una vez los pasos).

**Token del WAF (opción A).** EXEGEZIS genera 32 bytes aleatorios en base64url y los guarda cifrados. Pasos documentados para Cloudflare: *Security → WAF → Custom rules → Create rule*, con la expresión `(http.request.headers["x-exegezis-token"][0] eq "<token>")` y la acción *Skip*, que omite Bot Fight Mode, Super Bot Fight Mode, Managed Challenge y el rate limiting. Para Vercel la regla es equivalente, en *Firewall → Custom rules*.

## 4. Recorrer un sitio con sesión

- **Solo lectura estricta por defecto** (`--strict-readonly`). Se desactiva solo de forma explícita, con aviso.
- **Enlaces peligrosos por GET.** Nunca se visitan enlaces cuya ruta o texto coincida con `logout, log-out, sign-out, signout, cerrar-sesion, salir, delete, remove, destroy, unsubscribe, cancel, revoke, deactivate, borrar, eliminar, darse-de-baja`. La lista se puede configurar por sitio. El informe los lista como «omitidos por seguridad».
- **Redacción.** En red, DOM y trace se redactan las cookies, `Authorization`, `X-Exegezis-Token` y los parámetros de token. Si `trace.zip` no se puede redactar, esa inspección no guarda trace y el informe lo dice. La redacción actual de las cabeceras se amplía para que cubra `X-Exegezis-Token`.
- **Etiqueta visible.** El informe y la UI dicen «con sesión» (sin el contenido de la sesión). `--no-session` inspecciona como visitante anónimo.

## 5. Interfaz

- **Aviso de bloqueo** en el detalle de la inspección, en la página del job y en la home: el tipo en lenguaje llano, la evidencia (captura, URL final, estado) y el botón de la solución. Al pulsarlo se abre un diálogo con los pasos y «Listo». Al terminar, la inspección se relanza con las mismas opciones.
- **Ajustes → Accesos**: sitio, tipos de acceso (sesión, HTTP, token del WAF), estado (activo o caducado), último uso y los botones Renovar y Borrar, con la nota de que las sesiones solo se abren con este usuario en este equipo.
- **Antes de lanzar**, la home avisa si la sesión del origen ha caducado.

## 6. Pruebas

Un fixture local por tipo:
- login con cookie, con un enlace de logout y un GET destructivo;
- Basic Auth;
- una página que imita un desafío anti-bot;
- 429 con `Retry-After`;
- 403;
- un banner de cookies que tapa el contenido;
- una sesión que caduca;
- SSO simulado: un login que pasa por un segundo origen, cuyas cookies no deben guardarse;
- los tres casos de LOGIN_WALL: una redirección a login (sí es muro), una caja de login en la cabecera con contenido visible (no es muro) y la inspección directa de `/sign-in` (no es muro).

El orden de detección tiene su propio test: una página que cumple dos tipos a la vez se clasifica según el orden. En los tests, la ventana visible la «maneja» un script que hace de persona (inyectado solo en los tests).

Comprobaciones:
- en ningún archivo de `runs/`, en los logs ni en las respuestas de la API aparecen valores de cookies, contraseñas o tokens;
- los archivos de acceso están cifrados;
- el User-Agent y la huella no cambian;
- nowsecure.nl sigue saliendo BOT_CHALLENGE.

## 7. Decisiones de René (2026-09-26)

1. **DPAPI mediante `powershell.exe` interno:** aprobado, con `-NoProfile -NonInteractive`, la clave y los datos siempre por stdin y un error claro si una política lo bloquea.
2. **Linux sin `secret-tool`:** no se guarda nada, con un mensaje y la instrucción de instalación. Sin frase de paso por ahora.
3. **`BLOCKED` + tipo concreto:** aprobado. NETWORK_RESTRICTED va como subtipo de UNREACHABLE.
4. **Prueba real en `/prayer`:** la hace René. Se le dará el comando exacto para CMD y los pasos en la ventana.

**Ajustes:**
- (a) La sesión se limita al origen y sus subdominios; nada de proveedores de SSO.
- (b) Reglas contra los falsos LOGIN_WALL, con tests.
- (c) Aviso de que las sesiones con DPAPI solo se abren con este usuario en este equipo.
- (d) El orden de detección, documentado y con tests.
