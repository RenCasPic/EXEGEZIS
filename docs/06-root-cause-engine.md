# Root Cause Engine: causa raíz por intervención

> Proof over plausibility. Una causa no se valida porque parezca correcta. Se valida cuando intervenimos, predijimos el resultado y el resultado ocurrió.

## Qué significa VALIDATED ROOT CAUSE

Una hipótesis nombra una causa y trae consigo una **intervención**: una mutación de código que neutraliza esa causa. También trae una **predicción**: si la causa es real, el bug desaparece. El motor aplica la intervención a una copia aislada de la app y repite la misma reproducción que la línea base. Después compara los conteos.

Una causa es `VALIDATED` solo si se cumplen **todos** estos puntos (`decideRootCause`, en `packages/core/src/schemas/root-cause.ts`):

1. **Línea base estable.** La reproducción verificada del bug falla la expectativa en **todas** las ejecuciones: N de N, con N ≥ `runsPerArm` (5 por defecto).
2. **Una sola hipótesis confirmada.** Aplicar su intervención deja el bug en 0 de N ejecuciones, sin ninguna ejecución inválida. Un ancla fallida, un timeout o un error hacen el experimento `INCONCLUSIVE`: no cuentan como "el bug desapareció".
3. **Ninguna hipótesis sin resolver.** Una hipótesis sin probar o con un experimento inconcluso bloquea la validación.
4. **Alternativas refutadas.** Al menos `minRefutedAlternatives` hipótesis competidoras (1 por defecto) fueron refutadas por **su propia** intervención: el bug siguió en N de N. Esto demuestra que cambiar código relacionado no basta para que desaparezca.
5. **Aislamiento probado.** El hash del árbol fuente es idéntico antes y después.

Si no se cumplen, el resultado es:

- `REFUTED` si todas las hipótesis fueron refutadas: la causa sigue siendo desconocida.
- `INSUFFICIENT_EVIDENCE` en cualquier otro caso: dos hipótesis confirmadas (los experimentos no discriminan), hipótesis sin resolver, falta de alternativas refutadas o una línea base inestable.

**No validan nada:** la seguridad del LLM, un código que parece sospechoso, que el síntoma desaparezca una vez, ni una correlación. El schema `RootCauseReport` **vuelve a derivar** la decisión a partir de la línea base y de los resultados de cada hipótesis. Un reporte que diga `VALIDATED` sin ese soporte no se puede ni cargar: ni la UI ni otra herramienta lo aceptan.

## Métrica

Cada ejecución de un brazo (línea base o intervención) se clasifica así:

| Clase | Significado |
|---|---|
| `reproduced` | Falló una aserción de propósito `expectation`: el bug apareció. |
| `not_reproduced` | Todas las aserciones se cumplieron. |
| `invalid` | Falló un ancla, hubo timeout o error: la premisa del plan no se cumplió y la ejecución no dice nada sobre el bug. |

Se registran los conteos de cada brazo, la tasa (`reproduced / runs`) y el delta (tasa de la intervención menos tasa de la línea base). Con un N tan pequeño **no se calcula significancia estadística**. La regla es de todo o nada:

- **Confirmada:** el resultado es exactamente el que se predijo, en todas las ejecuciones.
- **Falsada:** el resultado es exactamente el contrario, en todas las ejecuciones.
- **Inconclusa:** cualquier efecto parcial (por ejemplo, 2 de 5), que se reporta como tal.

## Modelo de claims

El modelo de evidencia existente no se modificó. Se añadió `schemas/root-cause.ts`:

| Pregunta | Campo |
|---|---|
| ¿Qué afirmamos? | `Hypothesis.statement` |
| ¿Por qué lo creemos? | `Hypothesis.rationale` (razonamiento, no evidencia) |
| ¿Qué evidencia lo apoya? | `Hypothesis.observations` → `CausalObservation` (qué se vio en la reproducción verificada y en qué artefacto) |
| ¿Qué experimento lo probó? | `Experiment` (con su `intervention`, un `CodeMutation`) |
| ¿Qué predijimos? | `Hypothesis.prediction` (`eliminates`) |
| ¿Qué pasó? | `Experiment.arm.counts` y `Experiment.result` (`CONFIRMED` / `FALSIFIED` / `INCONCLUSIVE`) |
| ¿Qué alternativas quedan? | `RootCauseReport.outcomes` (`SUPPORTED` / `REFUTED` / `UNRESOLVED` por hipótesis) |

Cada experimento contiene explícitamente sus cuatro partes: la línea base (`baseline`), la intervención (`intervention` y `arm.mutation`, con el diff aplicado), la predicción (`prediction`) y el resultado (`result`).

## Intervención: una sola familia

Solo existe `CodeMutation { kind: "replace", file, find, replace }`:

- El texto a reemplazar debe aparecer **exactamente una vez** en el archivo, y el cambio debe modificar algo; si no, el experimento no se ejecuta.
- La mutación debe tocar el archivo que la hipótesis señala como ubicación.

## Aislamiento

Cada brazo sigue este ciclo:

1. `createWorkspace` copia `package.json`, `src` y `public` a `runs/root-cause/<run>/cases/<id>/workspaces/<brazo>/`. **No copia tests ni docs**: `KNOWN_BUGS.md` contiene las respuestas.
2. `applyMutation` modifica solo esa copia.
3. Se arranca la app con un **entorno mínimo** (`minimalEnv`): PATH, variables del sistema y nada más. Ninguna API key del usuario llega a la app mutada.
4. Se ejecuta `reproducePlan` con el plan verificado del bug.
5. Se para el proceso, se borra la copia y se conservan los artefactos: `reproduction.json`, todos los intentos con su evidencia y `mutation.diff`.

Se calcula `hashTree` del árbol fuente antes y después. El working tree del usuario nunca se modifica, y así lo prueban un test y el campo `isolation` de cada reporte. No hacen falta Docker ni microVMs: la app objetivo solo usa módulos `node:`.

## Frontera LLM / determinista

| Puede proponer (humano o LLM) | Solo código determinista |
|---|---|
| Hipótesis, ubicación, observaciones en las que se apoya, mutación, explicación | Aplicar la mutación, arrancar la app, reproducir, capturar artefactos, clasificar ejecuciones, contar, evaluar la predicción, decidir el estado |

**En esta iteración las hipótesis del benchmark las escribió el equipo de EXEGEZIS**, que conoce las causas verdaderas (su procedencia es `human`). El benchmark mide si el **protocolo de validación** separa causas verdaderas de hipótesis plausibles. **No** mide la generación de hipótesis. La generación con un LLM queda como `NOT IMPLEMENTED`.

## Superficie experimental de buggy-shop

| Bug | Superficie | Por qué |
|---|---|---|
| BUG-001 | Limpia | Falta una llamada (`renderBadge`) en una función; una mutación de una línea la neutraliza y hay señuelos plausibles en el mismo flujo. |
| BUG-002 | Limpia | Función pura en el backend (`discountBase`); la expectativa es la respuesta de la API. |
| BUG-003 | Existe, pero **no discrimina** | Es un bug de contrato: dos intervenciones distintas (servidor y cliente) eliminan el síntoma. Por diseño, el resultado honesto es `INSUFFICIENT_EVIDENCE`. |

Ningún bug quedó marcado como `INSUFFICIENT_EXPERIMENTAL_SURFACE`.

## Benchmark: `benchmarks/buggy-shop-root-cause`

Cada caso tiene dos archivos:

- `investigation.json`: la entrada del motor (hipótesis y plan).
- `ground-truth.json`: el ground truth, que **solo lee el evaluador y después de escribir el reporte**. El test end-to-end ejecuta el motor sin ese archivo.

Un `VALIDATED` es correcto si la mutación de la hipótesis ganadora se solapa, en el archivo original, con el fragmento de código del ground truth.

```bash
pnpm exegezis root-cause                       # 4 cases, 5 runs per arm
pnpm exegezis root-cause --case BUG-002 --runs 5
```

### Resultados (5 ejecuciones por brazo, 25-09-2026)

| Caso | Línea base | Hipótesis (con intervención) | Decisión | Ground truth |
|---|---|---|---|---|
| BUG-001 | 5/5 | H1 0/5 CONFIRMED · H2 5/5 FALSIFIED · H3 5/5 FALSIFIED | VALIDATED (H1) | correcto |
| BUG-002 | 5/5 | H1 0/5 CONFIRMED · H2 5/5 FALSIFIED · H3 5/5 FALSIFIED | VALIDATED (H1) | correcto |
| BUG-003 | 5/5 | H1 0/5 CONFIRMED · H2 0/5 CONFIRMED · H3 5/5 FALSIFIED | INSUFFICIENT_EVIDENCE | esperado |
| BUG-001-ADVERSARIAL | 5/5 | H1 0/5 CONFIRMED · H2 5/5 FALSIFIED · H3 5/5 FALSIFIED | VALIDATED (H1) | **FALSA VALIDACIÓN** |

Los resultados archivados están en `benchmarks/buggy-shop-root-cause/results/`.

### El fallo, sin maquillar

En `BUG-001-ADVERSARIAL` **no se ofrece la hipótesis verdadera** (`removeFromCart` no llama a `renderBadge`). La H1 que sí se ofrece hace que `renderCart()` también actualice el badge. Eso elimina el síntoma, pero desde otra función.

El protocolo la valida porque es la única hipótesis que sobrevive. **Una intervención demuestra que un cambio es suficiente, no dónde está el defecto.** Si el espacio de hipótesis no contiene la causa verdadera, el protocolo puede validar una intervención "suficiente pero mal ubicada".

No se cambió el criterio para ocultarlo. Los negativos que se construyeron con señuelos que **no** eliminan el síntoma sí se rechazan: 5 de 5 señuelos refutados en los otros casos. Lo que falla es el caso en que el señuelo también es un arreglo.

## Límites

- Hipótesis escritas por personas que conocían la respuesta. Falta generarlas con un LLM a partir de la evidencia y el código, sin ground truth.
- Hay una sola familia de intervención: reemplazar texto. No hay bisect, ni reintroducción del defecto (*knock-in*), ni controles de sham de primera clase.
- La suficiencia no implica ubicación (ver el caso adversarial).
- N = 5 por brazo. Sirve para efectos de todo o nada, no para bugs intermitentes.
- Solo buggy-shop: una app pequeña con bugs deterministas.
