# UI local de EXEGEZIS

`apps/web` es la interfaz de EXEGEZIS. Es una app Next.js 16 (App Router, Tailwind 4, Lucide) que corre solo en `127.0.0.1:4100`:

```bash
pnpm web
```

## Principio

La UI **no tiene datos propios**. Todo lo que muestra sale de archivos que el motor ya escribió y se valida con los schemas Zod de `@exegezis/core` (`BugReport`, `Reproduction`, `PlanValidation`, `TestPlan`, `BenchmarkResult`, `Timeline`, `NetworkFile`, `ConsoleFile`, `ObservationsFile`, `AccessibilityFile`, `AssertionsFile`, `ArtifactManifest`, `RunMetadata`).

- Si un archivo existe pero no cumple su schema, la UI lo dice y no lo muestra.
- Las etapas que el motor todavía no tiene aparecen como `NOT IMPLEMENTED`. Nunca con un resultado de ejemplo.
- **No hay datos DEMO.** Ninguna pantalla los necesitó.

El único archivo que no tiene schema en core es `generation.json`, que el CLI escribe tras cada llamada al planner. Su lector (`src/lib/evidence/generation.ts`) comprueba en tiempo de compilación que sus estados coinciden con `PlanGenerationResult` del planner, y valida el plan que contiene con el `TestPlan` canónico.

## Fuentes de datos

| Fuente | Qué contiene | Evidencia |
|---|---|---|
| `runs/**` (ignorado por git) | Benchmarks, `verify`, `ai-verify`, `generate-plan` y runs lanzados desde la UI | Completa: intentos, timeline, red, consola, DOM, capturas, accesibilidad, trace |
| `benchmarks/*/results/*` (en el repo) | Resultados archivados (checkpoint de la Iteración 3) | Solo reportes: la etapa Evidence dice `NOT ARCHIVED` |

**Descubrimiento.** No hay registro. Un directorio es una investigación si contiene `bug-report.json` o `generation.json`, y es un run de benchmark si contiene `benchmark-result.json`. Los ids de las URL solo se resuelven a través de ese índice. La ruta `/api/artifacts/<id>/<path>` sirve archivos de solo lectura, siempre dentro del directorio de esa investigación. Los intentos de salir con `..` devuelven 404.

## Cadena de una investigación

| Etapa | Estado posible | Fuente |
|---|---|---|
| Symptom | PROVIDED / NOT PROVIDED | `case.json`, metadata del plan o el formulario de la UI |
| AI Plan | GENERATED / DECLINED / INVALID GENERATION / ERROR / HUMAN PLAN | `generation.json`, provenance |
| Reproduction | VERIFIED / NOT VERIFIED / INCONCLUSIVE / FLAKY / INVALID PLAN / UNSUPPORTED / NOT RUN | `bug-report.json` |
| Evidence | AVAILABLE / NOT ARCHIVED / AWAITING EVIDENCE | directorios `attempts/` |
| Investigation, Root Cause, Fix, Verification | NOT IMPLEMENTED | — |

Un caso que el planner rechazó muestra Reproduction `NOT RUN`, aunque el benchmark registre `INCONCLUSIVE`: no se ejecutó nada.

El panel de **Claims** muestra la `evidenceChain` del BugReport, con la expectativa como `DECLARED` y lo demás como `OBSERVED`. Hipótesis, experimento y causa validada se dibujan con trazo discontinuo como `NOT IMPLEMENTED`.

## Nueva investigación

`/investigations/new` lanza el **CLI real** (`exegezis ai-verify`) como proceso hijo:

- Se lanza sin shell: el síntoma va como un solo argumento.
- Se ejecuta con `cwd` en la raíz del repo, para que cargue el mismo `.env`.
- La salida va a `runs/web/jobs/<id>/`.
- La UI solo guarda `job.json` (estado, pid, código de salida) y el log. El resultado son los artefactos del propio CLI, descubiertos como cualquier otro run.
- Si el servidor de la UI se reinicia a mitad de un run, el job aparece como `LOST`.

Cada run cuesta una llamada al planner. Sin credenciales, el formulario se desactiva. La UI solo comprueba si la clave existe; nunca lee su valor.

## Seguridad local

- El DOM capturado es contenido no confiable de la página objetivo. Se sirve con `Content-Security-Policy: sandbox` y se muestra en un `<iframe sandbox="">`, sin scripts.
- El servidor escucha solo en loopback.
- No hay autenticación: es una herramienta local para un solo usuario (Settings → Permissions: `NOT IMPLEMENTED`).

## Límites conocidos

- Proyectos: son las apps de `examples/*`. No hay registro, conexión con GitHub ni análisis de repositorio.
- Entornos: se derivan de la URL objetivo; las direcciones loopback se muestran como `Local`.
- Notificaciones: solo existe el aviso de runs en curso lanzados desde la UI.
- `next build` emite dos avisos de *file tracing* en `packages/core/dist/recorder.js`. Solo afectan a despliegues empaquetados, no a esta app local. Core no se modificó.
