# Fase 0 / Iteración 2 — Verification Engine

> Don't trust the model. Verify the claim.

Objetivo: convertir una hipótesis de bug en una afirmación verificable
mediante ejecución, evidencia y un test independiente, sin LLM.

```text
OBSERVE → DEFINE EXPECTATION → EXECUTE → REPRODUCE → CAPTURE EVIDENCE → VERIFY → COMPILE TEST
```

## Comandos

| Comando | Qué hace | Exit code |
|---|---|---|
| `exegezis run --plan <p>` | Ejecuta el plan una vez, paso a paso, con evidencia | 0 pasó · 1 falló una expectativa · 4 error (inconcluso) |
| `exegezis reproduce --plan <p> --runs N` | N ejecuciones aisladas y secuenciales, clasificadas | 0 concluyente · 1 FLAKY · 4 INCONCLUSIVE |
| `exegezis compile --plan <p>` | Plan → `<id>.spec.ts` de Playwright independiente | 0 |
| `exegezis verify --plan <p> --runs N` | reproduce + compile + ejecuta el spec con Playwright + criterios → `bug-report.json` | 0 VERIFIED · 1 NOT VERIFIED |

Todos aceptan `--base-url` (el mismo plan contra otro entorno) y `--output`.

## Modelo

### TestPlan: una sola secuencia de pasos

```text
TestPlan { id, title, target.baseUrl, preconditions[], steps[], metadata }
step = action (navigate, click, fill, press, wait, screenshot)
     | assert (assertion + id + description + timeoutMs)
     | observe
```

Las acciones y las assertions comparten `steps[]` porque el orden es parte del
significado: una assertion verifica el estado que dejaron las acciones
anteriores. Dos listas separadas perderían eso. `preconditions` es solo
documentación: todo lo que haya que *hacer* es un paso, y cada ejecución
empieza con un contexto de navegador nuevo. `navigate` acepta rutas
(`/cart`) que se resuelven contra `baseUrl`, así el plan es portable entre
entornos.

### Assertions como datos

`text` (equals/contains/matches), `visibility`, `existence`, `attribute`,
`url`, `count` y `http` (status y/o un valor del body JSON mediante JSON
Pointer). Son JSON serializable validado con Zod: un LLM podrá escribirlas,
pero nunca decide si pasan.

**Extensibilidad:** evaluadores (adapter) y emisores (compilador) viven en
registros tipados `{ [K in AssertionKind]: ... }`. Si se añade un tipo al
schema, el proyecto no compila hasta que exista su evaluador y su emisor. Cada
adapter declara en su descriptor qué tipos evalúa, y el runner rechaza los que
no declara.

### Fallo ≠ bug

| Resultado | Significa | ¿Evidencia de bug? |
|---|---|---|
| `passed` | La expectativa se cumple | — |
| `failed` | Se observó el sujeto y contradice la expectativa | Candidato |
| `error` | No se pudo evaluar (`target_not_found`, `target_ambiguous`, `response_not_found`, `body_unavailable`, `value_redacted`, `unsupported`) | **Nunca** |

Regla para los targets que no se encuentran: si la assertion trata sobre una
*propiedad* (texto, atributo, respuesta HTTP) y el sujeto no existe, el
resultado es `error`, porque podría ser un selector equivocado. Si trata
sobre la *presencia* (visible, existe, count), la ausencia es un dato y el
resultado es `failed`.

A nivel de run hay dos ejes separados:
- `status` (`completed`/`failed`): si EXEGEZIS ejecutó y registró bien el run.
- `verdict` (`passed`/`failed`/`error`/`no_assertions`): lo que concluyó el plan.

Una acción que falla (timeout, app caída) produce `verdict: error`.

### Reproduction

`attempts`, `passes`, `failures`, `errors`, `rate = failures/attempts`,
`status` y `runs[]` (cada intento es un run completo en `attempts/<runId>/`).
Las reglas son deterministas y el schema las hace cumplir:

- **REPRODUCED:** todos los intentos fallaron **igual**. La firma del fallo es
  `step|assertion id|valor actual`.
- **NOT_REPRODUCED:** todos pasaron.
- **FLAKY:** algunos pasaron y otros fallaron.
- **INCONCLUSIVE:** algún intento dio error, o todos fallaron pero de formas
  distintas. Un error nunca cuenta como fallo.

### Verified Bug

`evaluateVerification` comprueba cuatro criterios contra resultados observables:

1. **Expectativa definida:** el plan declara al menos una assertion.
2. **Reproducible:** `REPRODUCED` con al menos `minAttempts` intentos (3 por defecto).
3. **Evidencia:** la assertion fallida está enlazada a una screenshot y un
   snapshot de accesibilidad; el manifest del intento está completo y contiene
   timeline, assertions, screenshot, accessibility, console, network y trace,
   sin redacción fallida.
4. **Test ejecutable que falla:** el spec compilado, ejecutado por el runner
   estándar de Playwright, falla **en el mismo paso** que observó EXEGEZIS.
   Dos ejecutores independientes deben coincidir.

`BugReport.status` es `verified` **si y solo si** se cumplen los cuatro. El
schema rechaza cualquier otro caso, así que no existe una entrada por la que
un modelo pueda declarar "verified".

### Cadena de evidencia

Cada assertion fallida enlaza: el evento de la última acción, el evento de la
assertion, una observación tomada justo después (screenshot + árbol de
accesibilidad + DOM) y los ids de red, consola y errores de página
registrados entre la acción y el fallo. El bug report la expone como:

```text
expectation → action → observation → assertion → failure → evidence
```

## Compilador

`TestPlan → emisores tipados → TypeScript`. **No hay una IR aparte:** el plan
validado ya es una representación declarativa e independiente del target, y
una IR adicional duplicaría el modelo sin aportar nada todavía. Lo que sí está
separado es el modelo (core), la ejecución (runner + adapter) y el compilador
(`@exegezis/compiler-playwright`).

- La salida es determinista (sin timestamps): compilar el mismo plan produce
  bytes idénticos. Los specs de buggy-shop están versionados en
  `benchmarks/buggy-shop/cases/BUG-00N/` y un test comprueba que coinciden con la
  compilación.
- Solo importa `@playwright/test`. Fija `baseURL` (sobrescribible con
  `BASE_URL`), viewport, locale, timezone y timeouts iguales a los del motor.
- Usa locators idiomáticos (`getByRole` → `getByLabel` → `getByText` →
  `getByPlaceholder` → `getByTestId` → `locator(css)`) y assertions web-first
  con el mismo timeout que el plan.
- Cada paso va en un `test.step("N. ...")`. El compilador registra el rango de
  líneas de cada paso, y así la línea del error de Playwright se traduce al
  paso del plan.
- Los valores sensibles nunca se escriben en el spec: se leen de
  `EXEGEZIS_SECRET_STEP_<n>`.

**Paridad motor ↔ spec:** el motor evalúa con los mismos locators de
Playwright, la misma normalización de whitespace y el mismo
reintento-hasta-timeout que `expect`.

**Independencia (verificada):** los tres specs se ejecutaron con
`npx playwright test` en un proyecto vacío fuera del repo, con
`@playwright/test` como única dependencia. Fallaron con los mismos
expected/actual, y el de BUG-001 pasó con el fix aplicado.

## Fuentes de no-determinismo (documentadas)

| Fuente | Tratamiento |
|---|---|
| Timing (renders y respuestas asíncronas) | Assertions con reintento hasta timeout; esperas explícitas en los planes |
| Estado del servidor entre intentos | Cada intento usa un contexto de navegador nuevo, así que buggy-shop crea una sesión y un carrito nuevos. El estado global del servidor (número de pedido `ORD-1001`, `ORD-1002`...) cambia entre intentos, y por eso ningún plan lo compara |
| Ejecución paralela | No existe: los intentos son secuenciales a propósito |
| Locale, timezone y viewport de la máquina | Fijados (`en-US`, `UTC`, 1280×720) en el motor y en el spec |
| `NODE_PATH` de los shims de pnpm | Se ignora al resolver y ejecutar el spec (ver problemas encontrados) |
| Máquina lenta o carga | Puede convertir un `passed` en `failed` por timeout: un falso REPRODUCED es posible si el timeout es menor que la latencia real. Mitigación: timeouts explícitos por assertion |
