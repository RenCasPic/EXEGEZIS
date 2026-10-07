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

1. **Descubrimiento** (ejecución 1, primer dispositivo): recorrido BFS dentro del mismo origen, con `--max-pages 20`, `--max-depth 2`, `--page-timeout`, `--total-timeout` y `--delay 500ms` entre el inicio de dos navegaciones. Los enlaces se leen de `a[href]` en el DOM y se visitan con `goto`. Nunca hay clics.
   - **En paralelo** (`--concurrency`, 3 por defecto, nunca más de 3 a la vez en un sitio): se recorre **por niveles**, así el conjunto de páginas y su orden son los mismos que de una en una.
2. **Repetición** (ejecuciones 2..N, y todas las de los otros dispositivos): la **misma lista de páginas**, cada visita en un navegador nuevo. No se vuelve a recorrer el sitio, para que el conjunto de páginas sea estable.
3. **Dispositivos** (`--devices`, por defecto `desktop,mobile`): cada página se visita en cada dispositivo con todas las repeticiones.
   - Escritorio: 1280×800.
   - Móvil: 390×844, táctil, agente de usuario de Chrome en Android.
   - Tableta (opcional): 820×1180, táctil.
   - El agente de usuario siempre termina en `EXEGEZIS-Inspector/<versión>`.
   - Cada hallazgo guarda en qué dispositivos se vio y su veredicto en cada uno: la app y el CLI dicen «solo en móvil», «solo en escritorio» o «en ambos».
   - Las specs se generan para lo verificado en escritorio, porque se ejecutan en un navegador de escritorio.
4. En cada página, las comprobaciones (módulos puros) reciben la evidencia que ya captura el adaptador: consola, `pageerror`, red, árbol de accesibilidad, DOM, capturas y trace. Solo axe se ejecuta dentro de la página.
5. **Agregación:** fingerprint, luego ocurrencias por dispositivo, luego veredicto. Un hallazgo es `VERIFIED` si lo es en al menos un dispositivo.

Qué se reutiliza y qué es nuevo:

- **Se reutilizan:**
  - de adapter-browser: la sesión, los colectores, la redacción de cabeceras y del trace, y las capturas;
  - de core: `RunRecorder` (cada página de cada ejecución es un run, con el mismo formato de artefactos que hoy) y el manifest;
  - el compilador `compiler-playwright`;
  - el sistema de jobs de la UI.
- **Es nuevo:**
  - el paquete **`@exegezis/inspect`**, con el orquestador y `checks/`, una comprobación por archivo (`id`, `version`, `severity`, `run(evidence) → observations`) y su propio test;
  - en el adaptador: `readOnly`, `storageState`, `extractLinks()`, `runAxe()` y la clasificación de errores de navegación.

## 3. Estabilidad para SPAs: la página está lista por sus propias señales

Los anuncios, la analítica y los chats de terceros pueden impedir que una página «termine de cargar» (el evento `load` o la red en reposo) durante mucho tiempo. Las inspecciones (`readiness: "first-party"` en adapter-browser) no los esperan:

1. Se navega hasta `DOMContentLoaded`.
2. **Red propia en reposo:** ninguna petición en curso al propio sitio (el mismo dominio registrable: `www`, el dominio y sus subdominios) durante 500 ms. Las de terceros no cuentan.
3. **Contenido principal visible:** `main`, `[role=main]`, un `h1` o texto en la página.
4. **Hilo principal libre** (`requestIdleCallback`): la hidratación de React y similares ha terminado.
5. El evento `load`, como mucho 3 s más (`loadGraceMs`).
6. **DOM estable:** un `MutationObserver` sin mutaciones durante 500 ms.

El tope total es `readyTimeoutMs` (10 s). Si no se alcanzan las señales, la visita queda `settled: false`: sus hallazgos se registran igual, pero se muestran marcados. Las capturas de evidencia de terceros que siguen abiertas se esperan como mucho 1 s y no marcan la evidencia como incompleta.

Medido en jesushealingministry.net con sesión (10 páginas × 3 repeticiones): 304 s antes; 158 s ahora solo en escritorio; 251 s en escritorio y móvil. Con 20 páginas × 3 en escritorio, 490 s antes y 264 s ahora, con los mismos 2 problemas verificados.

Las verificaciones y las investigaciones (planes con acciones) siguen esperando `load` y la red en reposo, como antes.

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

### 8.1 Arranque del navegador y ENGINE_ERROR (2026-09-26)

**El bug.** En un equipo Windows (CMD, Node 24.18.1), una inspección de https://www.jesushealingministry.net/ terminó con `UNREACHABLE · no response for the page`. La causa real era que faltaba el Chromium headless de Playwright (`chromium_headless_shell-1243`). El sitio sí había respondido (robots.txt se descargó bien), y aun así las repeticiones 2 y 3 siguieron.

**Ahora:**
- El navegador se resuelve en este orden: Chromium de Playwright → Chrome del sistema → Edge del sistema.
- Si ninguno arranca, el resultado es `ENGINE_ERROR` (código de salida 7) en el primer intento. No se marca ninguna página como UNREACHABLE ni se deriva nada sobre el sitio.
- Lo mismo vale para `verify`, `ai-verify`, `reproduce`, `benchmark` y `root-cause`: se detienen con código 7 en lugar de dar un veredicto INCONCLUSIVE o NOT VERIFIED.
- El informe de la inspección y cada ejecución registran qué navegador se usó de verdad.

**Cómo se reprodujo el bug.** En este equipo se reprodujo apuntando `PLAYWRIGHT_BROWSERS_PATH` a una carpeta vacía, que da exactamente el mismo mensaje (`Executable doesn't exist at …\chromium_headless_shell-1243\…`). Todos los comandos se lanzaron desde CMD (archivos `.cmd` con `set "PLAYWRIGHT_BROWSERS_PATH=…"`).

**Prueba real contra el sitio.** El comando fue `--max-pages 5 --max-depth 1 --runs 3`. El sitio es de René, inspeccionado con su permiso.

| Escenario | Navegador usado | Estado | Salida | VERIFIED | Intermitentes | Escrituras de la página | Tiempo |
|---|---|---|---|---|---|---|---|
| Equipo normal (`auto`) | Chromium (Playwright) 153.0.8010.12 | COMPLETED | 1 | 296 graves | 5 | 29 | 6 min 4 s |
| Sin Chromium de Playwright, `auto`, `--max-pages 1` | **Google Chrome 154.0.8037.57 (del sistema)** | COMPLETED | 1 | 199 graves (los mismos que `/` con Chromium) | 0 | — | ~1,5 min |
| Sin Chromium de Playwright, `--browser-channel chromium` | ninguno | **ENGINE_ERROR** | **7** | — | — | — | < 1 s |

**Detalle de la ejecución con el equipo normal:**
- **Páginas:** 5 visitadas (`/`, `/about`, `/live-prayer`, `/teachings`, `/books`), todas con 200. Ninguna llega a quedarse sin tráfico de red: la analítica no para, y cada página figura como «no asentada».
- **Presupuesto del recorrido:** 87 enlaces internos quedan fuera por el límite `--max-pages 5`; 4 enlaces externos se listan pero no se visitan. robots.txt se descargó y se respetó (33 reglas Disallow).
- **Hallazgos VERIFIED:** todos son de accesibilidad (axe): 294 `color-contrast` y 2 `link-in-text-block`. Hay uno por elemento: 199 en `/`, 79 en `/books`, 7 en `/live-prayer`, 6 en `/teachings` y 5 en `/about`.
- **Hallazgos INTERMITTENT (5):**
  - 2 `color-contrast` en un carrusel de testimonios que rota;
  - 3 `POST pagead2.googlesyndication.com/ccm/collect → ERR_NAME_NOT_RESOLVED`, un píxel publicitario de terceros cuyo DNS falla desde este equipo.
- **Escrituras de la página (29):** todas las hizo la propia página, ninguna la inspección. 15 son `POST www.google-analytics.com/g/collect` (204) y 14 son `POST pagead2…/ccm/collect` (DNS fallido).

**Limitación visible aquí.** axe informa una violación por elemento, así que un sitio con un componente de bajo contraste repetido muchas veces da cientos de hallazgos. Son correctos y todos tienen spec, pero la lista aún no los agrupa por regla.

**Benchmarks tras el cambio:** A da 9/9 (3 VP, 6 VN, 0 FP) y B mock 7/7 (3 VP, 4 VN, 0 FP), con los mismos veredictos que antes. BUG-001 y HEALTHY-001 también se ejecutaron con Chrome como único navegador:
- BUG-001 sale VERIFIED 3/3, y el spec compilado se ejecuta en Chrome mediante una configuración mínima del runner, con un 100 % de concordancia con Playwright;
- HEALTHY-001 sale NOT_VERIFIED, como se espera.

### 8.2 Hallazgos agrupados (2026-09-26)

Nueva inspección de https://www.jesushealingministry.net/ con `--max-pages 5 --max-depth 1 --runs 3`, desde CMD, con el Chromium de Playwright 153.0.8010.12. El informe es v2 y la salida es 1.

| | Antes (una fila por elemento) | Ahora (por problema) |
|---|---|---|
| Verificados | 296 hallazgos | **9 problemas** (295 elementos en 5 páginas), todos graves |
| Intermitentes | 5 hallazgos | 2 problemas (4 elementos) |

El recuento varía en uno de una inspección a otra, porque el sitio cambia un poco entre visitas (el carrusel de testimonios). Los ids de grupo son los mismos que se derivaron del informe v1 del día anterior (`G-27a9b638d473`, `G-30400d0e080f`…): son estables entre inspecciones reales.

**Los 5 problemas principales**, en el orden de impacto del informe. El color sugerido está calculado, no verificado en la página:

1. **Texto naranja #C4862A sobre casi blanco #FBF7F0**: contraste 2,89:1, mínimo 4,5:1. Afecta a 134 elementos en `/`, `/books` y `/teachings`. Sugerencia: #986821 (4,53:1).
2. **Texto gris azulado #6B7A99 sobre casi blanco #FBF7F0**: contraste 4,03:1, mínimo 4,5:1. Afecta a 72 elementos en 3 páginas; 1 de ellos es intermitente, así que el grupo es MIXED. Sugerencia: #63718F (4,58:1).
3. **Texto gris azulado #6B7A99 sobre blanco #FFFFFF**: contraste 4,31:1, mínimo 4,5:1. Afecta a 56 elementos en las 5 páginas. Sugerencia: #677695 (4,56:1).
4. **Texto naranja #C4862A sobre blanco #FFFFFF**: contraste 3,09:1, mínimo 4,5:1. Afecta a 25 elementos en las 5 páginas. Sugerencia: #9E6C22 (4,54:1).
5. **Texto azul oscuro #1B3157 sobre azul oscuro #0B1729**: contraste 1,38:1, mínimo 4,5:1. Afecta a 4 elementos en 4 páginas, probablemente el pie de página. Sugerencia: #5580CA (4,55:1).

**Los otros 4 problemas verificados:**
- #6B7A99 sobre #FBF8F3 (2 elementos);
- #C4862A sobre #FAEFD8 (1 elemento);
- dos enlaces de privacidad que solo se distinguen por el color (`link-in-text-block`).

**Intermitente aparte:** `POST pagead2…/ccm/collect → ERR_NAME_NOT_RESOLVED` (3 elementos), un píxel publicitario de terceros.

En la práctica, arreglar 4 colores (los dos tonos de texto, sobre blanco y sobre crema) resuelve 286 de los 295 elementos verificados.

## 9. Agrupación de hallazgos

Los hallazgos (uno por elemento y página) siguen siendo la fuente de verdad. Los **grupos** son una vista derivada y determinista (`packages/core/src/issue-groups.ts`) que responde a «¿qué tengo que arreglar?».

**Clave de agrupación:**
- `color-contrast`: regla + color del texto + color de fondo + tamaño. «Grande» cuando axe exige 3:1 (≥ 18 pt, o ≥ 14 pt en negrita).
- Otras reglas de axe: regla + selector normalizado, sin `:nth-child` ni otras posiciones y sin ids con dígitos.
- Objetivos táctiles pequeños (`mobile-tap-targets`): selector normalizado + tamaño medido (redondeado al píxel). Un lado que ya llega a 24 px no cuenta, así que los enlaces de texto de anchos distintos y la misma altura quedan juntos. El título lo dice en lenguaje llano, por ejemplo «Enlaces del menú de 18×18 px: el mínimo es 24×24 px», y el grupo lleva el tipo (enlace, botón, campo), el lugar (menú, cabecera, pie, página) y el padding que falta por lado.
- Errores de consola y excepciones JS: el mensaje normalizado (sin números, hashes ni query strings).
- Peticiones fallidas: método + URL sin query + estado.
- Enlaces rotos: la URL de destino.
- Contenido mixto y SEO: el recurso o el campo.

**Cada grupo lleva:**
- un id estable: `G-` + sha256 de la clave;
- la severidad máxima de sus hallazgos;
- los elementos, las páginas y hasta 5 ejemplos (primero uno por página);
- el veredicto: **VERIFIED** solo si todos sus hallazgos lo son, **INTERMITTENT** si ninguno lo es y **MIXED** en los demás casos. Un intermitente nunca queda escondido en un grupo verificado;
- en los de contraste: el peor ratio medido, el ratio exigido y una **sugerencia de color** (la luminosidad más cercana que cumple, con el mismo tono y saturación), rotulada como no verificada;
- en los táctiles: la sugerencia de tamaño (24×24 px, con el padding que falta) o de separación (24 px entre centros).

La app marca **«En todas las páginas»** un grupo que aparece en todas las páginas inspeccionadas: casi siempre es una plantilla compartida y se corrige en un solo sitio.

**Orden por impacto:** severidad, luego número de elementos, luego número de páginas.

**Esquema:** `InspectionReport` v2 guarda los grupos. Al cargar un informe:
- los grupos guardados tienen que ser una agrupación honesta de los hallazgos: cada hallazgo en un solo grupo, y los recuentos, páginas, veredicto, severidad y ejemplos de cada grupo salen de sus propios hallazgos. Si no, el informe no carga;
- después se vuelven a derivar con la regla actual. Así un informe escrito antes de una agrupación mejor (por ejemplo, los táctiles de uno en uno) carga y se agrupa igual que uno nuevo;
- los informes v1 cargan y reciben los grupos derivados.

**Desviación respecto al diseño pedido.** Los datos de contraste (colores, tamaño y ratio) se leen del texto que axe guarda en cada hallazgo, no de campos nuevos del informe. Es la única forma de que los informes v1 obtengan también sus grupos. El texto es estable porque axe-core está fijado a 4.13.0.

## 10. Comprobaciones de móvil

Solo en las visitas de móvil y tableta. Son funciones puras de los datos de diseño que se miden en la página (`LAYOUT_FACTS_SCRIPT`, en `inspection.json` → `layout`):

| Comprobación | Qué detecta | Severidad |
|---|---|---|
| `mobile-scroll` | La página es más ancha que la pantalla, y qué elemento sobresale (sin contar los que están dentro de un contenedor con scroll) | serious |
| `mobile-tap-targets` | Objetivos táctiles de menos de 24×24 px (WCAG 2.2, 2.5.8). Los enlaces dentro de un texto están exentos | moderate |
| `mobile-text-size` | Texto visible de menos de 12 px | minor |
| `mobile-viewport` | Sin `<meta name="viewport">` (serious), o uno que impide hacer zoom: `user-scalable=no` o `maximum-scale` < 2 (WCAG 1.4.4) | serious |
| `mobile-fixed-overlap` | Elementos fijos o pegajosos que tapan más del 30 % de la pantalla | moderate |

El sitio de prueba `examples/inspect-lab` tiene `/devices/`, con todos estos problemas, y `/devices/fine`, sin ninguno.
