import { DEFAULT_AI_BASE_URL, MAX_RUNS } from "./args.js";
import { cliLocale } from "./i18n.js";

/*
 * `exegezis --help`, in English and Spanish. Commands, options, codes
 * (VERIFIED, BLOCKED…), paths and URLs are the same in both languages.
 */

const SEARCH_HELP_EN = `
  search      Search the text of a site (same crawl, limits, robots.txt, saved
              access and read-only mode as inspect). Output: runs/searches/<id>/.
                exegezis search --url <site> --terms "a, \\"a phrase\\", -excluded"
                    [--variants] [--exclude-scope block|page] [--regex <re>]
                exegezis search --url <site> --meaning "<what you look for>"
                    [--max-cost <USD>] [--model <id>]
                exegezis search --url <site> --template <id> [--with-meaning]
                exegezis search suggest --terms "a, b" [--json]
                exegezis search export --search <id|dir> --format csv|pdf [--sep ";"|","|tab]
                exegezis search templates [--json]
              Common: --max-pages 20 --max-depth 2 --runs 3 (1 by meaning)
              --no-session --no-hidden --save "<name>" --saved <id> --reuse <dir>.
              Exact: deterministic, accents and capitals ignored (ñ kept),
              whole words; VERIFIED in every load, INTERMITTENT otherwise.
              Meaning: the model proposes quotes; a quote that is not literally
              in the page is discarded and counted. Never VERIFIED. The cost is
              estimated first; above the limit (Settings, default 1 USD) the
              model is not called (exit 8). The model writes its reasons in the
              language of --lang; quotes stay as they are on the page.`;

const SEARCH_HELP_ES = `
  search      Busca en el texto de un sitio (mismo recorrido, límites, robots.txt,
              acceso guardado y modo de solo lectura que inspect). Resultado:
              runs/searches/<id>/.
                exegezis search --url <sitio> --terms "a, \\"una frase\\", -excluida"
                    [--variants] [--exclude-scope block|page] [--regex <re>]
                exegezis search --url <sitio> --meaning "<lo que buscas>"
                    [--max-cost <USD>] [--model <id>]
                exegezis search --url <sitio> --template <id> [--with-meaning]
                exegezis search suggest --terms "a, b" [--json]
                exegezis search export --search <id|carpeta> --format csv|pdf [--sep ";"|","|tab]
                exegezis search templates [--json]
              Comunes: --max-pages 20 --max-depth 2 --runs 3 (1 por significado)
              --no-session --no-hidden --save "<nombre>" --saved <id> --reuse <carpeta>.
              Exacta: determinista, sin importar acentos ni mayúsculas (la ñ
              cuenta), palabras completas; VERIFIED si aparece en todas las
              cargas, INTERMITTENT si no.
              Por significado: el modelo propone citas; una cita que no está
              literalmente en la página se descarta y se cuenta. Nunca VERIFIED.
              El coste se estima antes; por encima del límite (Ajustes, 1 USD por
              defecto) no se llama al modelo (salida 8). El modelo escribe sus
              motivos en el idioma de --lang; las citas quedan como están en la página.`;

const HELP_EN = `EXEGEZIS — Software that explains itself.

Usage:
  exegezis observe   --url <url> [--actions <plan.json>] [options]
  exegezis run       --plan <test-plan.json> [--base-url <url>] [options]
  exegezis reproduce --plan <test-plan.json> [--runs 10] [--base-url <url>] [options]
  exegezis compile   --plan <test-plan.json> [--output <dir>]
  exegezis verify    --plan <test-plan.json> [--runs 10] [--base-url <url>] [options]
  exegezis validate  --plan <test-plan.json> [--base-url <url>] [options]
  exegezis benchmark --suite <name|suite.json> [--runs N] [--case <id>]... [--base-url <url>]
                     [--planner anthropic|mock] [--model <id>] [--no-examples] [options]
  exegezis generate-plan --symptom "<text>" [--base-url <url>] [--planner ...] [--examples <suite>] [options]
  exegezis ai-verify     --symptom "<text>" [--runs 10] [--base-url <url>] [--planner ...] [--examples <suite>] [options]
  exegezis root-cause    [--suite buggy-shop-root-cause] [--case <id>]... [--runs 5] [options]
  exegezis inspect       --url <url> [--runs 3] [--max-pages 20] [--max-depth 2] [--checks a,b]
                         [--storage-state <file>] [--strict-readonly] [--ignore-robots] [options]
  exegezis doctor        [--install] [--json]
  exegezis session login|list|delete|http-auth|waf-token|set --url <site> [options]
  exegezis search        --url <site> (--terms "a, b" | --meaning "<text>" | --template <id>) [options]
  exegezis search suggest|export|templates …
  exegezis --help | --version
  Every command also takes --lang en|es.

Commands:
  observe     Open <url>, run optional actions and record the evidence.
  run         Execute a test plan once: actions + assertions + evidence.
  reproduce   Execute a test plan N times in isolation and classify the result
              (REPRODUCED, NOT_REPRODUCED, FLAKY, INCONCLUSIVE).
  compile     Compile a test plan into a standalone Playwright spec.
  verify      preflight + semantic validation + reproduce + compile + run the
              compiled spec with Playwright + criteria -> bug report with one
              outcome: VERIFIED, NOT_VERIFIED, INCONCLUSIVE, FLAKY,
              INVALID_PLAN or UNSUPPORTED.
  validate    Semantic validation of a plan against a preflight observation.
  benchmark   Verify every case of a suite (e.g. benchmarks/buggy-shop) and
              score each outcome against its known answer. Suites whose plans
              are generated (e.g. buggy-shop-ai) need --planner.
  generate-plan  A planner (LLM) turns a symptom into a TestPlan, which is
              validated but NOT executed.
  ai-verify   symptom -> planner -> TestPlan -> the same verification as
              "verify". The planner proposes; only the engine decides.
  inspect     Open a URL without a symptom, walk it read-only (same origin,
              GET only, no clicks or forms) and report deterministic findings:
              JS exceptions, console errors, failed requests, broken internal
              links, accessibility (axe-core, WCAG 2.1 A/AA), mixed content and
              basic metadata. A finding is VERIFIED only if it appears in every
              run (fresh contexts); others are INTERMITTENT. Each VERIFIED finding
              gets evidence and a standalone Playwright spec. Anti-bot, CAPTCHA
              and login walls give BLOCKED; nothing tries to get past them.
  session     Saved access for a site, encrypted on this computer (Windows:
              %LOCALAPPDATA%\\EXEGEZIS\\access, protected with DPAPI; only this
              Windows user on this computer can open it). Never in runs/ or logs.
                login      open a visible window: you sign in, pass the
                           verification or choose in the cookie banner, then
                           press Enter (or close the window). Saved only if the
                           block is gone. EXEGEZIS never types or keeps passwords.
                list       sites with saved access, their state and expiry
                delete     forget a site's saved access
                http-auth  save a username and password for HTTP (Basic/Digest)
                           authentication; the password is asked without echo
                waf-token  create the X-Exegezis-Token for your own site's WAF
                           rule and show the Cloudflare steps (--rotate: new one)
                set        --robots-owner yes|no ("this site is mine: also
                           inspect what robots.txt excludes"),
                           --unsafe-pattern <text> (repeatable)
              inspect uses a site's saved access automatically (--no-session
              to inspect as an anonymous visitor); with a session it is
              strict read-only unless --allow-page-writes.
${SEARCH_HELP_EN.slice(1)}
  doctor      Check this machine: Node.js, pnpm and the browsers EXEGEZIS can
              drive (Playwright's Chromium, Google Chrome, Microsoft Edge), with
              their versions, and say what is missing and how to install it.
              Nothing is downloaded unless you pass --install, which downloads
              Playwright's Chromium (~150 MB).
  root-cause  For each case: reproduce the bug on an isolated copy of the app
              (baseline), then apply each hypothesis' code mutation to its own
              copy and reproduce again. A cause is VALIDATED only if its
              intervention removed the bug in every run and the competing
              hypotheses were refuted. The source tree is never modified.

Options:
  --lang en|es       Language of the messages, the help and the exports.
                     Default: EXEGEZIS_LANG, else the system's language, else English.
  --output <dir>     Where results are written. Default: ./runs
  --runs <n>         Attempts for reproduce/verify/benchmark (1-${MAX_RUNS}). Default: 10
                     (benchmark: the suite's default)
  --suite <s>        Benchmark suite name (benchmarks/<s>/suite.json) or path.
  --case <id>        Only this benchmark case (repeatable).
  --symptom <text>   The reported problem, in plain language (AI commands).
  --planner <p>      anthropic (default; needs ANTHROPIC_API_KEY) or mock.
  --model <id>       Model for the anthropic planner. Default: claude-opus-5.
  --mock-response <f>  Mock planner: file with a recorded model answer.
  --examples <suite> Show that suite's solved cases to the planner (AI commands).
  --no-examples      Benchmark of generated plans: no examples in the prompt.
  AI commands target ${DEFAULT_AI_BASE_URL} unless --base-url is given.
  --base-url <url>   Run the plan against another environment.
  --headed           Show the browser window.
  --browser-channel <c>  Which browser to drive: auto (default: Playwright's
                     Chromium if installed, else Google Chrome, else Microsoft
                     Edge, which comes with Windows), chromium, chrome or msedge.
                     The browser actually used is recorded in every run.
  --verbose          Also stream structured logs to stderr.

Exit codes:
  0  success (run passed, reproduction conclusive, VERIFIED, plan valid,
     all benchmark cases passed, observe completed)
  1  expectation not met (assertion failed, NOT_VERIFIED, FLAKY, weakly
     anchored plan, benchmark case failed)
  2  usage error          3  internal error
  4  inconclusive (execution error, timeout, INCONCLUSIVE)
  5  invalid plan (not executed)
  6  unsupported plan (not executed)
  7  engine error: no browser could be started on this machine. Nothing was
     concluded about the site or the application. Run "pnpm exegezis doctor"
     (the same command works in Windows CMD, PowerShell, macOS and Linux).
  8  search: the model was not called, its estimate was over the cost
     limit (the exact part, if any, ran)
`;

const HELP_ES = `EXEGEZIS — Software que se explica a sí mismo.

Uso:
  exegezis observe   --url <url> [--actions <plan.json>] [opciones]
  exegezis run       --plan <test-plan.json> [--base-url <url>] [opciones]
  exegezis reproduce --plan <test-plan.json> [--runs 10] [--base-url <url>] [opciones]
  exegezis compile   --plan <test-plan.json> [--output <carpeta>]
  exegezis verify    --plan <test-plan.json> [--runs 10] [--base-url <url>] [opciones]
  exegezis validate  --plan <test-plan.json> [--base-url <url>] [opciones]
  exegezis benchmark --suite <nombre|suite.json> [--runs N] [--case <id>]... [--base-url <url>]
                     [--planner anthropic|mock] [--model <id>] [--no-examples] [opciones]
  exegezis generate-plan --symptom "<texto>" [--base-url <url>] [--planner ...] [--examples <suite>] [opciones]
  exegezis ai-verify     --symptom "<texto>" [--runs 10] [--base-url <url>] [--planner ...] [--examples <suite>] [opciones]
  exegezis root-cause    [--suite buggy-shop-root-cause] [--case <id>]... [--runs 5] [opciones]
  exegezis inspect       --url <url> [--runs 3] [--max-pages 20] [--max-depth 2] [--checks a,b]
                         [--storage-state <archivo>] [--strict-readonly] [--ignore-robots] [opciones]
  exegezis doctor        [--install] [--json]
  exegezis session login|list|delete|http-auth|waf-token|set --url <sitio> [opciones]
  exegezis search        --url <sitio> (--terms "a, b" | --meaning "<texto>" | --template <id>) [opciones]
  exegezis search suggest|export|templates …
  exegezis --help | --version
  Todos los comandos aceptan también --lang en|es.

Comandos:
  observe     Abre <url>, ejecuta acciones opcionales y registra la evidencia.
  run         Ejecuta un plan de prueba una vez: acciones + aserciones + evidencia.
  reproduce   Ejecuta un plan de prueba N veces de forma aislada y clasifica el
              resultado (REPRODUCED, NOT_REPRODUCED, FLAKY, INCONCLUSIVE).
  compile     Compila un plan de prueba en un spec de Playwright independiente.
  verify      preflight + validación semántica + reproducción + compilación +
              ejecución del spec compilado con Playwright + criterios -> informe
              del bug con un resultado: VERIFIED, NOT_VERIFIED, INCONCLUSIVE,
              FLAKY, INVALID_PLAN o UNSUPPORTED.
  validate    Validación semántica de un plan contra una observación previa.
  benchmark   Verifica cada caso de un benchmark (p. ej. benchmarks/buggy-shop) y
              compara cada resultado con su respuesta conocida. Los benchmarks
              con planes generados (p. ej. buggy-shop-ai) necesitan --planner.
  generate-plan  Un planner (LLM) convierte un síntoma en un TestPlan, que se
              valida pero NO se ejecuta.
  ai-verify   síntoma -> planner -> TestPlan -> la misma verificación que
              "verify". El planner propone; solo el motor decide.
  inspect     Abre una URL sin síntoma, la recorre en solo lectura (mismo origen,
              solo GET, sin clics ni formularios) y da hallazgos deterministas:
              excepciones JS, errores de consola, peticiones fallidas, enlaces
              internos rotos, accesibilidad (axe-core, WCAG 2.1 A/AA), contenido
              mixto y metadatos básicos. Un hallazgo es VERIFIED solo si aparece
              en todas las repeticiones (contextos limpios); si no, INTERMITTENT.
              Cada hallazgo VERIFIED lleva evidencia y un spec de Playwright
              independiente. Anti-bot, CAPTCHA y muros de inicio de sesión dan
              BLOCKED; nada intenta saltárselos.
  session     Acceso guardado para un sitio, cifrado en este equipo (Windows:
              %LOCALAPPDATA%\\EXEGEZIS\\access, protegido con DPAPI; solo este
              usuario de Windows en este equipo puede abrirlo). Nunca en runs/
              ni en los registros.
                login      abre una ventana visible: inicias sesión, pasas la
                           verificación o eliges en el banner de cookies, y
                           pulsas Enter (o cierras la ventana). Solo se guarda si
                           el bloqueo ha desaparecido. EXEGEZIS nunca teclea ni
                           guarda contraseñas.
                list       sitios con acceso guardado, su estado y caducidad
                delete     olvida el acceso guardado de un sitio
                http-auth  guarda un usuario y contraseña para autenticación
                           HTTP (Basic/Digest); la contraseña se pide sin eco
                waf-token  crea el X-Exegezis-Token para la regla del WAF de tu
                           propio sitio y muestra los pasos de Cloudflare
                           (--rotate: uno nuevo)
                set        --robots-owner yes|no ("este sitio es mío: inspeccionar
                           también lo que excluye robots.txt"),
                           --unsafe-pattern <texto> (repetible)
              inspect usa el acceso guardado de un sitio automáticamente
              (--no-session para inspeccionar como visitante anónimo); con
              sesión es solo lectura estricta salvo con --allow-page-writes.
${SEARCH_HELP_ES.slice(1)}
  doctor      Comprueba este equipo: Node.js, pnpm y los navegadores que EXEGEZIS
              puede usar (Chromium de Playwright, Google Chrome, Microsoft Edge),
              con sus versiones, y dice qué falta y cómo instalarlo. No se
              descarga nada salvo con --install, que descarga el Chromium de
              Playwright (~150 MB).
  root-cause  Para cada caso: reproduce el bug en una copia aislada de la
              aplicación (línea base), aplica la mutación de código de cada
              hipótesis a su propia copia y vuelve a reproducir. Una causa queda
              VALIDATED solo si su intervención eliminó el bug en todas las
              ejecuciones y las hipótesis rivales quedaron refutadas. El código
              fuente nunca se modifica.

Opciones:
  --lang en|es       Idioma de los mensajes, la ayuda y las exportaciones.
                     Por defecto: EXEGEZIS_LANG; si no, el idioma del sistema; si no, inglés.
  --output <carpeta> Dónde se escriben los resultados. Por defecto: ./runs
  --runs <n>         Intentos de reproduce/verify/benchmark (1-${MAX_RUNS}). Por defecto: 10
                     (benchmark: el del propio benchmark)
  --suite <s>        Nombre del benchmark (benchmarks/<s>/suite.json) o ruta.
  --case <id>        Solo este caso del benchmark (repetible).
  --symptom <texto>  El problema que se reporta, en lenguaje llano (comandos de IA).
  --planner <p>      anthropic (por defecto; necesita ANTHROPIC_API_KEY) o mock.
  --model <id>       Modelo del planner de anthropic. Por defecto: claude-opus-5.
  --mock-response <a>  Planner mock: archivo con una respuesta del modelo grabada.
  --examples <suite> Muestra al planner los casos resueltos de ese benchmark (comandos de IA).
  --no-examples      Benchmark de planes generados: sin ejemplos en el prompt.
  Los comandos de IA apuntan a ${DEFAULT_AI_BASE_URL} salvo que se indique --base-url.
  --base-url <url>   Ejecuta el plan contra otro entorno.
  --headed           Muestra la ventana del navegador.
  --browser-channel <c>  Qué navegador usar: auto (por defecto: el Chromium de
                     Playwright si está instalado; si no, Google Chrome; si no,
                     Microsoft Edge, que viene con Windows), chromium, chrome o
                     msedge. El navegador usado queda registrado en cada ejecución.
  --verbose          Envía también los registros estructurados a stderr.

Códigos de salida:
  0  éxito (la ejecución pasó, reproducción concluyente, VERIFIED, plan válido,
     todos los casos del benchmark correctos, observe completado)
  1  expectativa no cumplida (aserción fallida, NOT_VERIFIED, FLAKY, plan
     débilmente anclado, caso del benchmark fallido)
  2  error de uso         3  error interno
  4  inconcluso (error de ejecución, tiempo agotado, INCONCLUSIVE)
  5  plan no válido (no se ejecutó)
  6  plan no soportado (no se ejecutó)
  7  error del motor: ningún navegador pudo arrancar en este equipo. No se
     concluyó nada sobre el sitio ni la aplicación. Ejecuta "pnpm exegezis doctor"
     (el mismo comando funciona en CMD de Windows, PowerShell, macOS y Linux).
  8  search: no se llamó al modelo, su estimación superaba el límite de
     coste (la parte exacta, si la había, sí se ejecutó)
`;

/** The help in the current language. */
export function helpText(): string {
  return cliLocale() === "es" ? HELP_ES : HELP_EN;
}
