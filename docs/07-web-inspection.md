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

_(se completa tras la implementación)_
