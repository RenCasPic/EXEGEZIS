# Root Cause Engine: causa raíz por intervención (protocolo v2)

> Proof over plausibility. Una causa no se valida porque parezca correcta. Se valida cuando intervenimos, predijimos el resultado, el resultado ocurrió **y la intervención tocó la causa, no otra cosa**.

## 1. El fallo del protocolo v1

En v1, `BUG-001-ADVERSARIAL` terminó en `VALIDATED`, y fue una **falsa validación**. La hipótesis verdadera (`removeFromCart()` no llama a `renderBadge()`) se retiró a propósito. En su lugar se ofreció H1: "`renderCart()` no sincroniza el badge". Su intervención añade `renderBadge(cart)` dentro de `renderCart()`. El síntoma desaparece (0 de 5) y los dos señuelos quedan refutados (5 de 5), así que v1 declaró H1 validada.

### ¿"P(X elimina Y) no implica que X cause Y"?

La formulación es correcta, pero incompleta. Hay **dos** problemas distintos:

1. **La intervención no fue quirúrgica.** Que desaparezca el síntoma al eliminar una condición *es* la prueba contrafactual clásica ("si no fuera por C, no habría S"). Pero la mutación de H1 no elimina la condición que nombra: **añade un mecanismo compensador**. `renderCart()` también se ejecuta al cargar la página y al añadir productos, y allí la app ya era correcta. En inferencia causal esto es una intervención *fat-hand*: `do(X)`, tal como se implementó, cambia más variables que X. Lo que v1 demostró fue **"este cambio es suficiente para ocultar el síntoma"**, no "aquí está el defecto".
2. **v1 decidía por eliminación.** "Es la única superviviente, luego es la causa" solo vale si el conjunto de hipótesis es completo. Los experimentos **no pueden verificar** que lo sea. Si la hipótesis verdadera no está en el conjunto, la mejor de las ofrecidas gana.

Un tercer factor agrava los dos anteriores: los señuelos de v1 no quitaban el síntoma. Refutarlos no aumenta la confianza en la superviviente; solo demuestra que no todo cambio sirve.

## 2. El protocolo v2: evidencia causal, no solo suficiencia

Para cada hipótesis se ejecutan cuatro mediciones. Todas las hace código determinista.

| Evidencia | Experimento | Qué demuestra | Qué **no** demuestra |
|---|---|---|---|
| **Suficiencia** | La mutación aplicada a una copia aislada y la reproducción completa N veces. La predicción es 0 de N. | Que el cambio elimina el síntoma. | Que el cambio esté en el lugar del defecto. |
| **Reversión (A‑B‑A)** | Después de las intervenciones, el código original otra vez, N veces. El bug debe volver N de N. | Que el efecto se debe a la mutación y no a la deriva del entorno, al orden o al estado. | Casi nada más: con código determinista, revertir equivale a la línea base. Es la "necesidad" que se puede medir, y es débil. **ADV-002 demuestra que no discrimina.** |
| **Relevancia** | Cobertura V8 (navegador vía Playwright y servidor vía `NODE_V8_COVERAGE`) de la línea base: el bloque que la mutación modifica, ¿se ejecutó en el escenario que falla? | Que la hipótesis habla de código que realmente corrió. | Causalidad. **Ejecutarse no es ser causal.** |
| **Especificidad quirúrgica** | El **escenario de control**: el plan cortado en el último ancla anterior a la acción que desencadena el fallo, donde la línea base es correcta. Se ejecuta con cobertura en la línea base y en cada intervención, y se comparan los recuentos de ejecución por función. | Que la intervención no cambia nada donde no hay defecto. Así se distingue **eliminar una causa** de **añadir un compensador**. | Que no exista un compensador condicionado a la ventana del fallo (ADV-002). |

### Criterio de VALIDATED (`decideRootCause`, `evidenceMatrix`)

`VALIDATED` exige que se cumplan **todos** los elementos requeridos de la matriz de evidencia:

| Evidencia | Requerida |
|---|---|
| Bug reproducido en todas las ejecuciones de la línea base (N de N) | sí |
| Sitio de la intervención ejecutado en el escenario que falla | sí (`requireExecutedSite`) |
| La intervención elimina el bug (0 de N, sin ejecuciones inválidas) | sí |
| Predicción confirmada | sí |
| Al revertir, el bug vuelve (N de N) | sí (`requireReversal`) |
| La intervención es quirúrgica: el control ejecuta exactamente lo mismo | sí (`requireSurgical`) |
| Alternativas refutadas (≥ 1) y ninguna sin resolver | sí |
| Exactamente una hipótesis superviviente | sí |
| El espacio de hipótesis es completo | **no requerido: siempre `unknown`** |

La última fila importa. **`VALIDATED` significa "validada contra las alternativas probadas"**, y el reporte lo dice explícitamente.

La decisión es conservadora, pero no se rinde ante cualquier incertidumbre: BUG-002 alcanza `VALIDATED` porque tiene toda la evidencia.

### Niveles de evidencia

| Nivel | Significado |
|---|---|
| `NONE` | La línea base no reproduce el bug en todas las ejecuciones. |
| `REPRODUCED` | Ninguna intervención quitó el bug (o todas quedaron refutadas). |
| `SUFFICIENT` | Alguna intervención quita el bug, pero hay varias que lo hacen o no se refutaron alternativas. |
| `CANDIDATE` | Una única superviviente con alternativas refutadas, pero falta evidencia de que toque la causa: no es quirúrgica, no hay reversión o el sitio no se ejecutó. El resultado es `INSUFFICIENT_EVIDENCE` con `candidateHypothesisId`. |
| `VALIDATED` | Toda la evidencia requerida se cumple. |

### No se puede declarar

`RootCauseReport` (schema v2) re-deriva, al cargar, la decisión, el nivel, el candidato y la especificidad de cada experimento a partir de las mediciones registradas: conteos y huellas de ejecución (*footprints*) del control. Un reporte que diga `VALIDATED` sin esa evidencia, o que marque como quirúrgica una intervención cuyas huellas difieren, no carga.

Hay tests para cada propiedad. La central es: **"una intervención que simplemente elimina el síntoma no implica causa raíz"**. Suficiencia más predicción confirmada más alternativas refutadas no basta. Si falta la reversión, la especificidad o la relevancia, el resultado es `CANDIDATE`, nunca `VALIDATED`.

## 3. Camino de ejecución y cobertura

**Qué había en los artefactos antes de v2:** red, consola, DOM, árbol de accesibilidad, capturas y trace. No había stack de la ejecución normal (solo en errores), ni camino de código, ni funciones ejecutadas. No bastaba para restringir hipótesis al camino de ejecución.

**Qué se añadió, con una instrumentación mínima:**

- **Navegador:** opción `coverage` del adaptador (desactivada por defecto). Usa `page.coverage.startJSCoverage` y escribe `coverage.json`, un nuevo tipo de artefacto `coverage` con cobertura de bloques de V8.
- **Servidor:** `NODE_V8_COVERAGE` junto con un *preload* fuera del workspace, que por IPC reinicia los contadores cuando la app ya está sana (para no contar el arranque ni los health checks) y los vuelca al final. La app no se modifica. Con el *type stripping* de Node, los offsets coinciden con el archivo `.ts` original.
- **Funciones puras** en `schemas/coverage.ts`: `executionsAt` (ejecuciones del bloque más interno en un offset), `footprintOf` (recuentos por `archivo#función`, estables entre versiones de un archivo) y `footprintDiff`.

**Cómo se usa:** para la relevancia (`site_executed`) y para la especificidad quirúrgica. Nunca como evidencia causal por sí sola.

**Qué falta para restringir hipótesis de verdad al camino causal:**

- Cobertura acotada **por ventana temporal**: qué se ejecutó entre el último ancla que pasó y el fallo.
- El **grafo de llamadas**: quién llamó a quién.
- El **flujo de datos**: de dónde salió el valor observado.

No se construyó ninguno de los tres.

## 4. Casos adversariales y qué se descubrió

| Caso | Naturaleza | Resultado esperado |
|---|---|---|
| `BUG-001-ADVERSARIAL` | Compensador mal ubicado en `renderCart()`, que se ejecuta también donde la app es correcta. | `INSUFFICIENT_EVIDENCE`: debe fallar la prueba quirúrgica. |
| `ADV-002` | Compensador **condicionado a la ventana del fallo**: `api()` refresca el badge solo en respuestas DELETE. Reversión: el bug vuelve. | `INSUFFICIENT_EVIDENCE`, pero **se esperaba que el protocolo fallara**: nada cambia en el control. |
| `ADV-003` | Compensador mal ubicado en el servidor: `priceCart()` usa el subtotal y deja de llamar a `discountBase()`. | `INSUFFICIENT_EVIDENCE`: `discountBase` deja de ejecutarse también donde la app era correcta. |

En los tres casos la hipótesis verdadera se retiró a propósito. El motor no conoce los nombres de los casos: cualquier caso nuevo se añade a la suite sin tocar el motor.

## 5. Resultados (protocolo v2, 5 ejecuciones por brazo, 2 de control, 25-09-2026)

| Caso | Esperado | Obtenido | ¿Correcto? | ¿Falsa validación? | Nivel de evidencia |
|---|---|---|---|---|---|
| BUG-001 | VALIDATED | VALIDATED (H1) | sí | no | VALIDATED |
| BUG-002 | VALIDATED | VALIDATED (H1) | sí | no | VALIDATED |
| BUG-003 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | desconocido honesto | no | SUFFICIENT (H1 y H2 eliminan el bug) |
| ADV-002 | INSUFFICIENT_EVIDENCE | **VALIDATED (H1)** | **no** | **sí** | VALIDATED |
| ADV-003 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | candidato incorrecto, detectado | no | CANDIDATE (`discountBase` 6→0 en el control) |
| BUG-001-ADVERSARIAL | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | candidato incorrecto, detectado | no | CANDIDATE (`renderBadge` 4→8 en el control) |

Números absolutos: 6 casos, 6 líneas base reproducidas, 3 validados, 2 correctos, **1 falsa validación**, 3 `INSUFFICIENT_EVIDENCE` (2 de ellos candidatos). 18 hipótesis probadas, 11 refutadas. 5 de 6 casos coinciden con la conclusión esperada.

Como tasas, solo para reportarlas: *root cause precision* 2/3, *false validation rate* 1/6, *honest unknown rate* 3/6. **Con 6 casos escritos por quienes conocen las respuestas, estas tasas no dicen nada sobre la precisión del sistema en general.** Solo muestran qué casos distingue el protocolo y cuáles no.

Frente a v1: `BUG-001-ADVERSARIAL` pasa de falsa validación a `CANDIDATE`, y BUG-001, BUG-002 y BUG-003 no cambian. Los señuelos que no eliminan el síntoma siguen refutados (11 de 11).

### Un fallo de medición encontrado durante la iteración

La primera ejecución de v2 dio 0 falsas validaciones, **por la razón equivocada**. La cobertura del servidor se perdía de forma intermitente: `v8.takeCoverage()` y el volcado automático al salir colisionaban en el mismo nombre de archivo cuando ocurrían en el mismo milisegundo. Una medición ausente se leía como "cero": un `not_surgical` falso en ADV-002, y un sitio con "0 ejecuciones" y un `surgical` falso en ADV-003.

Se corrigió de tres formas:

- Un único volcado, el de salida.
- Cobertura sin scripts de la app = desconocida (`null`).
- Un archivo presente en una medición y ausente en la otra = hueco de medición (`unknown`), nunca "cambio de comportamiento".

Hay tests para las tres. Con la medición correcta, ADV-002 se valida en falso. Ese es el resultado que se reporta.

## 6. Límites (lo que sigue sin resolverse)

- **Compensadores condicionados a la ventana del fallo.** La especificidad solo mira donde la línea base es correcta. Un cambio que únicamente se ejecuta en el tramo del fallo es, para cualquier experimento de caja negra sobre el comportamiento, indistinguible de un arreglo real. Con los experimentos de este protocolo no se puede separar "aquí está el defecto" de "aquí se puede arreglar".
- **Bugs latentes.** Si el defecto actúa antes del último ancla (por ejemplo, BUG-003: el checkout no vacía el carrito y el síntoma aparece después), la intervención verdadera **también** cambia el control y no puede ser quirúrgica. Esos bugs no llegan a `VALIDATED`. El error es conservador: da `INSUFFICIENT_EVIDENCE`, no una falsa validación.
- **Especificidad por función.** El *footprint* es por función, no por bloque, porque los offsets cambian al mutar el código. Un cambio dentro de una función que no altere cuántas veces se llama pasa como quirúrgico.
- **Hipótesis escritas por personas** que conocían la respuesta. No se generan hipótesis con un LLM.
- **N = 5 y una sola app.** Sin significancia estadística; solo cuentan los efectos de todo o nada.

## 7. Aislamiento (sin cambios respecto a v1)

- Cada brazo se ejecuta en una copia aislada, que no incluye tests ni docs.
- La app arranca con un entorno mínimo, sin secretos del usuario.
- La copia se borra al terminar.
- Se registra el hash del árbol fuente antes y después.

Los brazos nuevos (control y reversión) usan el mismo mecanismo. El preload de cobertura vive en el directorio del resultado, nunca en el workspace ni en el árbol fuente.

## 8. Conclusión: ¿qué evidencia necesita EXEGEZIS para decir "esta es la causa"?

**Lo que ya se puede afirmar con experimentos de comportamiento:**

- **"Este cambio es suficiente":** hace desaparecer el síntoma N de N.
- **"El efecto es de este cambio":** la reversión A‑B‑A lo demuestra.
- **"Toca código que se ejecuta en el fallo":** la cobertura lo muestra, como relevancia.
- **"No altera nada donde la app era correcta":** la especificidad quirúrgica lo demuestra.

Esto separa las causas reales de los compensadores **que actúan fuera de la ventana del fallo** (BUG-001-ADVERSARIAL y ADV-003), y separa los señuelos que no eliminan el síntoma.

**Lo que no se puede afirmar así (ADV-002):** que el cambio esté *en el defecto* y no sea un compensador que solo actúa dentro de la ventana del fallo. Para cualquier experimento de caja negra sobre el comportamiento, ambos son idénticos: mismo síntoma antes, mismo resultado después, misma ejecución fuera de la ventana, misma reversión. **Con experimentos de comportamiento no se puede distinguir de forma fiable "causa" de "intervención suficiente y específica".** Es la situación de la sección 17 del encargo, y la respuesta honesta es no forzar una solución.

**Implicación para el producto:**

- El resultado normal debería llamarse **"Root Cause Candidate"**, junto con su nivel de evidencia y su matriz.
- `VALIDATED` debería reservarse para evidencia que un compensador condicionado no pueda imitar. Hay dos candidatas, ninguna construida todavía:
  1. **Cobertura del espacio de hipótesis sobre el camino del fallo.** Exigir una hipótesis probada por cada función que se ejecutó *en la ventana del fallo* y que interviene en el valor observado. Si la hipótesis verdadera y el compensador se prueban juntos, ambos eliminan el bug y el resultado es `INSUFFICIENT_EVIDENCE`, como en BUG-003. Hace falta cobertura acotada por ventana y un grafo de llamadas o de datos.
  2. **Evidencia de mecanismo, no de síntoma.** Por ejemplo, la procedencia del valor incorrecto (qué código escribió o dejó de escribir el badge), o un invariante especificado de forma independiente del síntoma.

**Mientras tanto, el motor no se cambió para esconder el fallo.** ADV-002 queda en el benchmark como el caso que cualquier protocolo futuro debe resolver.
