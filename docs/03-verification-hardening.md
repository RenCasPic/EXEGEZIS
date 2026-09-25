# Fase 0 / Iteración 2.5 — Verification hardening

> Un modelo puede equivocarse. El Verification Engine debe detectar que el
> plan es incorrecto en lugar de convertir ese error en un Verified Bug.

Esta iteración no hace a EXEGEZIS más inteligente. Lo hace **más difícil de
engañar**, antes de que un LLM empiece a escribir los planes.

```text
PLAN ERROR  ≠  EXECUTION ERROR  ≠  ASSERTION TIMEOUT  ≠  ASSERTION FAILURE  ≠  VERIFIED BUG
```

## Pipeline de `verify`

```text
TestPlan (schema)
   ↓
preflight: observación determinista de cada URL del plan (árbol de accesibilidad + latencia)
   ↓
validación semántica ──► unsupported → UNSUPPORTED   (no se ejecuta)
   │                 └─► invalid     → INVALID_PLAN  (no se ejecuta)
   ↓ valid / weakly_anchored
reproduce (N runs) → compile → Playwright ejecuta el spec → 6 criterios
   ↓
outcome (determinista) → bug-report.json (con provenance)
```

## Estados

### Resultado de una assertion (adapter)

| Estado | Condición |
|---|---|
| `passed` | La expectativa se cumplió en algún intento dentro del timeout |
| `failed` | El sujeto **se observó**, contradice la expectativa y su valor estuvo **estable** al menos `stabilityMs` antes del deadline |
| `timeout` · `subject_absent` | El sujeto (elemento o respuesta) nunca apareció. **La ausencia nunca es evidencia positiva**: puede ser lentitud, un target equivocado o un bug, y no se pueden distinguir |
| `timeout` · `value_unsettled` | El sujeto se observó, pero su valor seguía cambiando al vencer el timeout |
| `error` | No se pudo evaluar: target ambiguo, body no capturado, valor redactado, tipo no soportado |

La presencia contradictoria sí es evidencia. `expected: "absent"` con el
elemento presente da `failed`, y `expected: "hidden"` con el elemento visible,
también.

### Veredicto de un run

`passed` · `failed` · `timeout` · `error` · `no_assertions`. Es independiente
de `status` (`completed`/`failed`), que dice si EXEGEZIS ejecutó y registró el
run correctamente. Un timeout de assertion da `verdict: timeout` con
`status: completed`: no es un error de ejecución. Una acción que excede su
timeout, o un run que excede `runMs`, da `verdict: error`.

### Reproducción

| Estado | Condición |
|---|---|
| `NOT_RUN` | 0 intentos (el plan no se ejecutó) |
| `REPRODUCED` | Todos los intentos fallaron **igual** (mismo paso, misma assertion, mismo valor) |
| `NOT_REPRODUCED` | Todos los intentos pasaron |
| `FLAKY` | Unos intentos pasaron y otros fallaron |
| `INCONCLUSIVE` | Algún intento dio timeout o error, o los fallos fueron distintos entre sí |

### Outcome de verificación

La precedencia es determinista: `UNSUPPORTED > INVALID_PLAN > FLAKY > NOT_VERIFIED > INCONCLUSIVE > VERIFIED`.

| Outcome | Condición | Exit |
|---|---|---|
| `UNSUPPORTED` | La validación encontró acciones o assertions que el adapter no declara. No se ejecuta | 6 |
| `INVALID_PLAN` | La validación demostró que el plan es incorrecto (target inexistente en la página observada, no navega primero, ids duplicados, sin expectation). No se ejecuta | 5 |
| `FLAKY` | Reproducción `FLAKY` | 1 |
| `NOT_VERIFIED` | Reproducción `NOT_REPRODUCED`: la expectativa se cumplió siempre | 1 |
| `INCONCLUSIVE` | Reproducción `INCONCLUSIVE` o `NOT_RUN`, o `REPRODUCED` con algún criterio sin cumplir (anclaje débil, anchor fallido, evidencia incompleta, menos de `minAttempts`, spec que no falla o falla en otro paso) | 4 |
| `VERIFIED` | Reproducción `REPRODUCED` **y** los 6 criterios cumplidos | 0 |

### Criterios de VERIFIED

1. **plan_valid:** la validación semántica da `valid` o `weakly_anchored`.
2. **expectation_defined:** al menos una assertion con `purpose: "expectation"`.
3. **anchored:** si la política lo exige (`requireStrongAnchoring`, activo por
   defecto), el plan no está débilmente anclado; la assertion que falla es una
   expectation, no un anchor, y todos los anchors anteriores pasaron.
4. **reproduced:** `REPRODUCED` con al menos `minAttempts` intentos (3 por defecto).
5. **evidence_captured:** screenshot y accessibility enlazados a la assertion
   fallida; manifest completo con timeline, assertions, screenshot,
   accessibility, console, network y trace; ninguna redacción fallida.
6. **executable_test:** el spec compilado, ejecutado por el runner estándar de
   Playwright, falla en el mismo paso que el motor.

El schema de `BugReport` exige `outcome = VERIFIED ⇔ los 6 criterios se
cumplen`. Ninguna entrada permite declararlo.

## Política de timeouts (`TimeoutPolicy`)

Es una sola fuente, con defaults sobrescribibles por plan (`plan.timeouts`) y
por paso (`step.timeoutMs`):

| Campo | Default | Uso |
|---|---|---|
| `actionMs` | 10 000 | click, fill, press, wait |
| `navigationMs` | 30 000 | navigate |
| `assertionMs` | 5 000 | reintento de assertions |
| `stabilityMs` | 250 (con tope en la mitad del timeout de la assertion) | un `failed` exige un valor estable durante este tiempo |
| `runMs` | 120 000 | presupuesto total del run: si se excede, error de ejecución (`phase: run`) |

Motor y spec compilado leen la misma política: `actionTimeout`,
`navigationTimeout`, `test.setTimeout(runMs)` y el timeout de cada `expect`.

**Calibración:** el preflight mide el tiempo de carga y la respuesta fetch/XHR
más lenta. La validación avisa (`TIMEOUT_BELOW_OBSERVED_LATENCY`) si un
timeout de assertion es menor que el doble de esa respuesta, o si el de
navegación es menor que el doble del tiempo de carga.

## Validación semántica

Es determinista: solo afirma lo que puede demostrar.

| Código | Severidad | Detecta |
|---|---|---|
| `UNSUPPORTED_ACTION` / `UNSUPPORTED_ASSERTION` | unsupported | El descriptor del adapter no lo declara |
| `FIRST_STEP_NOT_NAVIGATE` | error | Empezaría en una página en blanco |
| `DUPLICATE_STEP_ID` | error | Las ids de assertion deben ser únicas (identifican el fallo) |
| `NO_EXPECTATION` | error (verification) / warning (execution) | No hay nada que pueda demostrar un bug |
| `TARGET_NOT_IN_REFERENCE` | error si la acción o `visible` lo necesitan; warning si no | Un target del **segmento inicial** (antes de la primera acción que cambia estado) no existe en el árbol de accesibilidad observado |
| `EXPECTATION_WITHOUT_ANCHOR` / `EXPECTATION_WITHOUT_ACTION` | anchoring | La expectation no está precedida por un anchor y una acción: `WEAKLY_ANCHORED` |
| `ANCHOR_AFTER_LAST_EXPECTATION` | warning | Un anchor que no puede sostener nada |
| `TIMEOUT_BELOW_OBSERVED_LATENCY` | warning | Ver calibración |

Qué **no** hace: no juzga targets posteriores a un cambio de estado (la
referencia ya no describe la página), no juzga `testId` ni `css`, no intenta
corregir selectores. El matching sigue la semántica por defecto de Playwright:
subcadena, sin distinguir mayúsculas, con whitespace normalizado.

## Anclaje

Cada assertion tiene `purpose`: `anchor` (establece que la app está en el
estado que el plan cree) o `expectation` (el comportamiento bajo prueba; el
default). Así, un fallo tiene tres lecturas distintas:

- **Falla una expectation, con anchors previos que pasaron:** candidato a bug.
- **Falla un anchor:** la premisa del plan es falsa. `INCONCLUSIVE`, nunca un bug.
- **Falla una expectation sin anchor o sin acción previa (anclaje débil):** que
  expected sea distinto de actual es reproducible, pero no demuestra nada
  sobre un comportamiento. `INCONCLUSIVE`.

## Provenance

`plan.provenance = { source: human | model | tool | unknown, generator, model,
version, promptVersion, createdAt }`. Todo es opcional y nada se infiere: un
plan sin provenance es `unknown`, nunca "human". Se propaga a `run metadata →
reproduction.planProvenance → bugReport.provenance → benchmark result`.

## Benchmark

```text
benchmarks/buggy-shop/
  suite.json                 cómo arrancar la app, runs por defecto, casos
  cases/<ID>/case.json       id, kind (positive|negative), symptom, expectedBug, plan, expected {outcome, step, value}
  cases/<ID>/plan.json       plan de referencia (provenance: human)
  cases/BUG-00N/BUG-00N.spec.ts  spec compilado versionado (golden)
```

`exegezis benchmark --suite buggy-shop` (o `pnpm benchmark`) arranca la app en
un puerto libre, pasa cada caso por el **mismo** pipeline que `verify` y
compara outcome, paso y valor. Escribe `benchmark-result.json` con el
resultado por caso y el resumen (true/false positives/negatives). En la
iteración 3 bastará con añadir planes generados junto al de referencia: el
motor no cambia.

| Caso | Tipo | Esperado | Qué demuestra |
|---|---|---|---|
| BUG-001/002/003 | positive | VERIFIED | Los tres bugs del laboratorio |
| HEALTHY-001 | negative | NOT_VERIFIED | Comportamiento correcto |
| BAD-SELECTOR-001 | negative | INVALID_PLAN | Target que no existe (detectado sin ejecutar el plan) |
| TIMEOUT-001 | negative | INCONCLUSIVE | Elemento que nunca aparece |
| UNSUPPORTED-001 | negative | UNSUPPORTED | Assertion `visual`, sin adapter que la implemente |
| WEAK-ANCHOR-001 | negative | INCONCLUSIVE | Fallo reproducible, pero sin anclaje |
| WRONG-PREMISE-001 | negative | INCONCLUSIVE | Un anchor falla: la premisa del plan es falsa |
