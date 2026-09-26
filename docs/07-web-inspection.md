# Inspección web + página de inicio (diseño aprobado)

`exegezis inspect --url <url>` abre una URL sin síntoma, la recorre en modo solo lectura y devuelve **hallazgos deterministas respaldados por evidencia**. Ningún modelo participa. Un hallazgo es `VERIFIED` solo si se repite N de N veces en contextos nuevos.

## 1. Schemas (core, `schemas/inspection.ts`)

- **`PageVisit`**: `url`, `finalUrl`, `depth`, `status`, `httpStatus`, `settled`, `redirects[]`, `blockedRequests` (por la política de solo lectura), `runPath` y `reason`.
  - Estados posibles: `OK`, `BLOCKED`, `UNREACHABLE` (DNS, TLS o conexión), `TIMEOUT`, `HTTP_ERROR`, `SKIPPED_BUDGET`, `SKIPPED_ROBOTS` y `DEGRADED`.
  - `DEGRADED` significa que la página necesitó una petición que no es GET y la política la bloqueó.
- **`CheckResult`**: `checkId`, `checkVersion`, `page`, `run`, `status` (`ran`, `skipped` o `error`) y `observations[]`.
  - Cada observación es la medición cruda: un `fingerprint`, el mensaje y referencias a evidencia (`EvidenceRef`, ya existente).
- **`Finding`**: `id`, `checkId`, `severity` (`critical`, `serious`, `moderate`, `minor` o `info`), `fingerprint`, `page`, `title`, `occurrences` (en qué ejecuciones apareció), `verdict`, `evidence[]`, `reproduction` (pasos) y `spec` (ruta del `.spec.ts`).
- **`InspectionReport`**: `target`, `options` (presupuesto, ejecuciones, comprobaciones), `status` (`COMPLETED`, `BLOCKED`, `UNREACHABLE`, `TIMEOUT` o `PARTIAL`), `pages[]`, `checks[]`, `findings[]` y `summary`.
  - Como en `RootCauseReport`, al cargar un `refine` **re-deriva** tres cosas a partir de `checks[].observations`:
    - el `verdict` de cada hallazgo: `VERIFIED` si aparece N de N, `INTERMITTENT` si aparece entre 1 y N−1;
    - los conteos del `summary`;
    - el `status`, a partir de `pages[]`.
  - Un reporte manipulado no carga.
- **Fingerprint** (función pura): `checkId` + URL normalizada + clave propia de cada comprobación. Por ejemplo, método, URL y estado de la petición; el mensaje de error sin números volátiles; o la regla de axe con su selector.

## 2. Flujo y reutilización

1. **Descubrimiento** (ejecución 1): recorrido BFS dentro del mismo origen, con `--max-pages 20`, `--max-depth 2`, `--page-timeout`, `--total-timeout` y `--delay 500ms` entre navegaciones. Los enlaces se leen de `a[href]` en el DOM y se visitan con `goto`. Nunca hay clics.
2. **Repetición** (ejecuciones 2..N): la **misma lista de páginas**, cada ejecución en un contexto nuevo. No se vuelve a recorrer el sitio, para que el conjunto de páginas sea estable.
3. En cada página, las comprobaciones (módulos puros) reciben la evidencia que ya captura el adaptador: consola, `pageerror`, red, árbol de accesibilidad, DOM, capturas y trace. Solo axe se ejecuta dentro de la página.
4. **Agregación:** fingerprint, luego ocurrencias, luego veredicto. Cada hallazgo `VERIFIED` tiene su spec.

Qué se reutiliza y qué es nuevo:

- **Se reutilizan:**
  - de adapter-browser: la sesión, los colectores, la redacción de cabeceras y del trace, y las capturas;
  - de core: `RunRecorder` (cada página de cada ejecución es un run, con el mismo formato de artefactos que hoy) y el manifest;
  - el compilador `compiler-playwright`;
  - el sistema de jobs de la UI.
- **Es nuevo:**
  - el paquete **`@exegezis/inspect`**, con el orquestador y `checks/`, una comprobación por archivo (`id`, `version`, `severity`, `run(evidence) → observations`) y su propio test;
  - en el adaptador: `readOnly`, `storageState`, `extractLinks()`, `runAxe()` y la clasificación de errores de navegación.

## 3. Estabilidad para SPAs

Se espera a `load` y después a que se cumplan **las dos anclas a la vez**:

- **Red inactiva:** 0 peticiones en curso durante 500 ms, ignorando websockets, EventSource y peticiones de más de 10 s.
- **DOM estable:** un `MutationObserver` sin mutaciones durante 500 ms.

El tope es `settleTimeoutMs`, que ya existe (3 s, configurable hasta 10 s). Si se alcanza el tope, la visita queda `settled: false`. Sus hallazgos se registran igual, pero se muestran marcados. No se usa ningún *sleep* fijo.

## 4. Modelo de seguridad (nivel `READ` de §13)

- **El límite está en lo que hace la inspección, no en lo que hace la página.**
  - **Prohibido a la inspección:** enviar formularios, hacer clic en elementos (solo se navega con `goto` a los `href`), escribir en inputs y hacer peticiones propias que no sean GET o HEAD. Las peticiones propias pasan por una sonda HTTP del adaptador que por construcción solo tiene `get` y `head`.
  - **Por defecto** se deja pasar el tráfico que la página lanza sola, incluido el `POST /api/session` de buggy-shop.
  - **Transparencia:** el reporte incluye una sección de **escrituras de la página** con cada petición no-GET que hizo la página (método, URL, estado y página de origen). En la UI aparece un aviso visible si hay alguna.
  - **`--strict-readonly`** bloquea también las escrituras de la página con `context.route`. Una página con peticiones bloqueadas queda `DEGRADED` y **sus hallazgos de esa ejecución se descartan**. Se cuentan como "descartados por la política", pero no se reportan: no se puede separar qué parte depende de lo bloqueado.
- **Dominios externos:** nunca se visitan. Los enlaces externos se listan en el reporte, pero no se comprueban.
- **`robots.txt`:** se respeta por defecto (`Disallow` para `*`) y `--ignore-robots` lo desactiva para sitios propios, como los staging con `Disallow: /`. **La URL inicial se visita siempre**: robots solo limita lo que se descubre recorriendo el sitio, incluidas las comprobaciones de enlaces. El reporte lista las páginas que se saltaron por robots.
- **User-Agent:** `EXEGEZIS-Inspector/<versión>` en todas las peticiones, tanto las del navegador como las de la sonda.
- **TLS:** un error de certificado da `UNREACHABLE`. `ignoreHTTPSErrors` existe solo como opción del adaptador, que usan los tests. El CLI no tiene ningún flag para ello.
- **Bloqueos:** hay heurísticas deterministas que devuelven `BLOCKED` con razón y captura, y **nunca se intenta saltarlos**:
  - estado 403, 429 o 503 acompañado de marcadores de challenge;
  - iframes de reCAPTCHA, hCaptcha o Turnstile;
  - redirección a login con campo de contraseña;
  - 451.
- **`--storage-state`:** Playwright lo lee del disco. No se copia a los artefactos, y cookies y tokens se redactan en red y trace, como hoy.
- La UI escucha solo en loopback. Se muestra un aviso de permiso la primera vez por dominio externo. El job se lanza con argumentos separados, sin shell.

## 5. UI

**`/` (nuevo inicio):**

```
[ https://…                        ] [Inspeccionar]
  ▸ Opciones avanzadas: páginas · profundidad · runs · comprobaciones · storageState
  (primera vez en un dominio externo) ⚠ Inspecciona solo sitios que sean tuyos o para los que tengas permiso. [Entendido]
Inspecciones recientes
  URL · fecha · ●crit ●serious ●moderate ●minor (solo VERIFIED) · estado
Accesos: Investigations · Root Causes · Benchmarks · Overview (el actual, en /overview)
```

**`/inspections/[id]`:**

```
URL · estado · 12 páginas · 3 runs · duración
[Critical 2] [Serious 5] [Moderate 1] [Minor 0] [Info 4]   · Intermitentes (1), aparte
Filtros: severidad · comprobación · página · texto
▸ Hallazgo: título · página · 3/3 · evidencia (captura con el elemento resaltado, DOM en iframe sandbox,
  petición/respuesta, consola, trace) · pasos para reproducir · [Descargar spec]
Páginas: estado (OK / BLOCKED / DEGRADED / …) por URL
```

Los jobs muestran un progreso por página, que se lee de un `progress.json` escrito por el CLI, y estados: en cola (un solo job de inspección a la vez), ejecutando, terminado, `BLOCKED`, error o `LOST`.

## 6. Decisiones aprobadas

1. **Solo lectura:** ver la sección 4. El criterio de aceptación queda así:
   - en un fixture con formularios y botones, la inspección no inicia ninguna petición no-GET, y cada no-GET registrado se atribuye a la página;
   - un segundo test comprueba que `--strict-readonly` las bloquea.
2. **Ampliación aditiva del contrato de aserciones** con cinco tipos: `console`, `page_error`, `request`, `link` y `a11y`.
   - Cada uno tiene su evaluador en el adaptador y su traducción en el compilador, con tests.
   - Los planes, reportes y benchmarks existentes cargan igual y dan los mismos veredictos.
   - `@axe-core/playwright` queda **fijado a 4.13.0** y se usa como dependencia sin modificarlo. MPL‑2.0 es copyleft por archivo.
   - El reporte guarda la versión de axe y los ids de las reglas ejecutadas.
   - `a11y` compara **regla + selector del nodo**, nunca el número total de violaciones.
3. **Contenido mixto:** HTTPS local con un certificado autofirmado **generado al montar los tests** (`selfsigned` como devDependency). No se guarda ningún certificado ni clave en el repo.
4. **Intermitente sembrado:** un endpoint que falla de forma determinista en llamadas alternas, lo que da 2 de 3 → `INTERMITTENT`.
5. **Pruebas manuales:** todas con `--max-pages 1`.
   - `example.com`;
   - `demo.playwright.dev/todomvc`;
   - `nowsecure.nl`: se espera `BLOCKED`, pero no se fuerza. Si un Chromium headless pasa la detección, se anota tal cual, sin añadir nada para esquivarla;
   - buggy-shop con la configuración por defecto;
   - buggy-shop con `--strict-readonly`.
6. **Evidencia:** el trace se guarda solo en la ejecución 1, que es la que aporta la evidencia de los hallazgos. Las ejecuciones 2..N sirven para contar ocurrencias.

## 7. Riesgos y qué dejo fuera

**Riesgos:**

- Falsos positivos por código de terceros (analítica, extensiones): se atribuye el origen y los de terceros se degradan a `minor`.
- Páginas que nunca se estabilizan.
- Heurísticas de bloqueo incompletas: preferible `BLOCKED` de más a hallazgos falsos.
- Coste: páginas × N ejecuciones × trace. Los traces se guardan solo en las visitas con hallazgos.

**Fuera, y por qué:**

- Rendimiento y Core Web Vitals: ruidosos y no se reproducen N de N.
- Regresión visual: no hay línea base.
- Cabeceras de seguridad y escaneo de vulnerabilidades: rozan el pentest sin autorización.
- Enlaces externos: saldrían del origen.
- Ortografía y contenido.

**Las comprobaciones genéricas no encuentran bugs de lógica como los de buggy-shop.** Para eso siguen existiendo `verify`, `ai-verify` y `root-cause`.

## 8. Resultados de las pruebas manuales

**Fecha:** 2026-09-26. **Comando:** `pnpm exegezis inspect --url <url> --max-pages 1` salvo que se indique lo contrario.

**Configuración común:** 3 repeticiones, axe-core 4.13.0, User-Agent `EXEGEZIS-Inspector/0.1.0`, robots.txt respetado.

Los informes están en `runs/inspections/<id>/`; esa carpeta no se versiona.

| Sitio | Estado | Salida | VERIFIED | Intermitentes | Escrituras de la página | Tiempo |
|---|---|---|---|---|---|---|
| example.com | COMPLETED | 0 | 0 | 0 | 0 | 9.8 s |
| demo.playwright.dev/todomvc | COMPLETED | 1 | 6 graves + 1 info | 0 | 0 | 11.1 s |
| nowsecure.nl | **BLOCKED** (`.cf-turnstile`) | 4 | — | — | 2 (Cloudflare) | 22.5 s |
| buggy-shop (`localhost:3000`, configuración por defecto: 20 páginas, sin `--max-pages`) | COMPLETED | 0 | 0 | 0 | 3 × `POST /api/session` (201) | 9.9 s |
| buggy-shop `--strict-readonly` | COMPLETED, 3/3 visitas DEGRADED | 0 | 0 | 0 | 3 × `POST /api/session`, bloqueadas | 9.4 s |

**example.com.** Sin hallazgos. Un enlace externo (iana.org) se lista sin visitarlo.

**todomvc.** Los hallazgos VERIFIED, todos 3/3:
- 6 violaciones axe `color-contrast` (graves), en `h1`, en los tres párrafos del pie y en dos enlaces;
- `The page has no meta viewport` (info).

Tres enlaces externos se listan sin visitarlos. La propia app no hizo peticiones de escritura.

**nowsecure.nl.** El Chromium headless **no** pasó la detección. El informe marca la página BLOCKED por el marcador `.cf-turnstile`, sin hallazgos y sin repetir las visitas; la salida es 4. No se añadió nada para esquivar la detección. Las 2 escrituras son de Cloudflare (`/cdn-cgi/rum` y `challenge-platform`), lanzadas por la propia página y atribuidas a ella.

**nowsecure.nl destapó un fallo real.** En el primer intento la inspección se quedó colgada más de 10 minutos en la primera visita. La causa: `request.allHeaders()` de Playwright nunca resuelve para ciertas peticiones `blob:` hechas dentro del iframe del reto, y el adaptador esperaba sin límite a que terminaran todas las capturas de red. Corregido en `779a7e4`:
- la espera tiene un plazo (`captureDrainTimeoutMs`, 10 s);
- pasado el plazo, el colector de red queda marcado como incompleto en lugar de esperar para siempre.

No se pudo reproducir con fixtures locales (un blob worker o un `fetch(blob:)` en un iframe de otro origen sí resuelven), así que el test es unitario (`drainWithDeadline`) y la comprobación de extremo a extremo es esta ejecución real.

**buggy-shop, por defecto.** La inspección no envió formularios ni pulsó nada. La única escritura es el `POST /api/session` que la app lanza al cargar, una por repetición; se atribuye a la página y aparece en «Escrituras de la página». No hay hallazgos. buggy-shop es una SPA sin enlaces internos, así que se visita 1 página.

**buggy-shop, `--strict-readonly`.** Se bloquean los 3 `POST /api/session`, y la app no arranca («[shop] failed to start»). Las 3 visitas quedan DEGRADED y sus 6 observaciones (errores de consola y la petición bloqueada) se descartan por política. No hay hallazgos.

**Las comprobaciones genéricas no detectan los bugs de lógica de buggy-shop** (BUG-001 contador del carrito, BUG-002 cupón por cantidad, BUG-003 artículos comprados que reaparecen): la página carga sin errores, sin peticiones fallidas y sin violaciones axe. Esos bugs los verifican `verify`, `ai-verify` y `root-cause`: en esta misma fecha, el Benchmark A dio 9/9 y el Benchmark B (replay) 7/7, con los mismos veredictos de siempre.
