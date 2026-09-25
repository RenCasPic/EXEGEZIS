# Fase 0 / Iteración 3 — Symptom → AI → TestPlan → Deterministic Verification

> AI reasons. Tests verify.
> The AI proposes the test. EXEGEZIS decides whether the evidence proves the claim.

## Hipótesis

Un LLM puede traducir un síntoma humano en un `TestPlan` lo bastante preciso
como para que un motor determinista e independiente verifique o rechace la
afirmación. **No** se intenta demostrar que el LLM encuentre bugs.

## Arquitectura

```text
            symptom (texto humano)
                 │  redacción (credenciales, datos personales)
                 ▼
   preflight ──► PlanGenerationInput { symptom, baseUrl, capacidades, árbol de accesibilidad inicial, ejemplos? }
                 │
                 ▼
   PlanGenerator (1 llamada)  ── AnthropicModelClient | MockModelClient | (otro provider)
                 │  structured output (JSON Schema desde Zod)
                 ▼
   JSON.parse → PlannerOutput (Zod) → TestPlan (Zod, contrato canónico)
                 │  status: generated | declined | invalid_generation | error
                 ▼
   verifyPlan (sin cambios): validación semántica → reproducción → compile → Playwright → outcome
```

Dependencias: `planner → core`. **Core no conoce al planner ni a ningún
proveedor**, y el Verification Engine no se tocó. El SDK de Anthropic solo
existe en `@exegezis/planner`.

### Qué escribe el modelo (y qué no)

El modelo rellena `PlannerOutput = { plan?: PlanDraft, cannotPlanReason?: string }`.
`PlanDraft` es **la parte del contrato `TestPlan` que un modelo puede
redactar** (título, descripción, precondiciones y pasos), escrita en un
*wire format* plano. `assemblePlan` (`packages/planner/src/draft.ts`) la
traduce mecánicamente, añade `id`, `target`, `provenance` y `metadata`, y
valida el resultado con el `TestPlan` canónico. No hay un segundo modelo de
plan: el wire format es solo cómo lo escribe un modelo.

**Por qué un wire format plano (límites medidos contra la API real).** El
primer diseño reutilizaba las uniones discriminadas de `PlanStep`. La API de
structured outputs las rechazó al compilar la gramática:

| Variante del schema | Respuesta de la API |
|---|---|
| Array de uniones discriminadas (pasos, aserciones, targets) | `compiled grammar is too large` |
| Plano, con muchos campos `nullable` | `too many parameters with union types` |
| Plano, con muchos campos opcionales | `Schema is too complex` |
| Plano mínimo: pocos opcionales, argumentos como texto (1678 bytes) | aceptado |

Por eso un paso es `{type, target?, value?, id?, purpose?, description?, assertion?}`,
un target es `{by, value, name?}` y una aserción es
`{kind, target?, operator?, expected, attribute?, method?, path?}`. `value` y
`expected` llevan el argumento específico del tipo como texto (p. ej. http:
`"status=200"` o `"/itemCount=0"`). Lo que no encaja no se adivina: el
`TestPlan` canónico lo rechaza y el resultado es `schema_violation`.

No existe ningún campo para "bug", "verified", "confidence", "root cause" ni
"fix": una respuesta que los incluya es un `schema_violation` (hay un test
para ello). El veredicto sale solo de `verifyPlan`.

### Estados de la generación

| Estado | Significa | Resultado de `ai-verify` |
|---|---|---|
| `generated` | TestPlan válido por schema | se verifica con el pipeline normal |
| `declined` | El modelo dice que el síntoma no es testable | INCONCLUSIVE (no se ejecuta nada) |
| `invalid_generation` | JSON inválido, violación de schema, sin plan, truncado o rechazo | INVALID_PLAN (**no se repara**) |
| `error` | Faltan credenciales (exit 2) o falla el proveedor (exit 3) | no se ejecuta |

## Providers

- **`anthropic`** (real): una llamada a la Messages API con structured outputs
  (`output_config.format` generado desde Zod con `zodOutputFormat`; el SDK
  retira las restricciones no soportadas y el pipeline vuelve a validar todo).
  Modelo por defecto `claude-opus-5` (`--model` lo cambia). Credenciales:
  `EXEGEZIS_ANTHROPIC_API_KEY` (preferida: no altera otras herramientas que leen
  `ANTHROPIC_API_KEY`, como Claude Code), o `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`. El endpoint se toma solo de
  `EXEGEZIS_ANTHROPIC_BASE_URL` o es la API pública, **nunca** de
  `ANTHROPIC_BASE_URL`, para que el endpoint de otra herramienta no reciba
  tráfico de EXEGEZIS en silencio. Sin credenciales: error de configuración,
  antes de cualquier llamada de red.
  - No activo los *refusal fallbacks* del servidor: un fallback cambiaría el
    modelo que escribe el plan, y el provenance debe nombrar exactamente al
    autor. Un rechazo se registra como `invalid_generation: refused`.
- **`mock`**: reproduce una respuesta grabada. Recorre **exactamente** el mismo
  parseo y validación que el provider real; solo sustituye la llamada de red.
  Sirve para CI y para probar el pipeline. **No mide a un LLM.**
- Otro proveedor (OpenAI u otros) = implementar `ModelClient.complete()`.

## Prompt

`planner-v1` (`packages/planner/src/prompts/planner-v1.ts`) es un artefacto
versionado: nunca se edita una versión publicada, se añade `planner-v2`. La
versión viaja en el provenance de cada plan.

## Input mínimo

Solo se envían el síntoma (redactado), la URL, las capacidades del adapter, el
árbol de accesibilidad de la página inicial (del preflight) y, opcionalmente,
ejemplos. No se envía ninguna otra evidencia: ni red, ni consola, ni DOM, ni
resultados de ejecuciones. **El modelo nunca ve valores observados antes de
escribir su expectativa**: si los viera, podría ajustar la expectativa a lo que
falla y fabricar un bug.

## Ejemplos y leakage

Los ejemplos (síntoma + plan humano) salen de casos resueltos del benchmark A.
En el benchmark B se aplica *leave-one-out*: un caso nunca ve un ejemplo de su
propio bug (`expectedBug`). Los negativos nunca son ejemplos. `--no-examples`
mide la diferencia. En `ai-verify` / `generate-plan` no hay ejemplos salvo que
se pida `--examples <suite>`.

## Benchmark B

`benchmarks/buggy-shop-ai/`: 3 bugs con síntomas de usuario (sin datos
internos) y 4 negativos:

| Caso | Esperado | También aceptable | Qué mide |
|---|---|---|---|
| BUG-001/002/003 | VERIFIED | — | El pipeline completo con un plan generado |
| HEALTHY-001 | NOT_VERIFIED | INCONCLUSIVE | Una queja falsa (la app funciona) |
| AMBIGUOUS-001 | INCONCLUSIVE | INVALID_PLAN, NOT_VERIFIED | Un síntoma sin nada testable |
| INVENTED-TARGET-001 | INVALID_PLAN | INCONCLUSIVE | Una función que la app no tiene |
| UNSUPPORTED-001 | UNSUPPORTED | INCONCLUSIVE, INVALID_PLAN | Una queja puramente visual |

VERIFIED nunca es aceptable en un caso negativo (lo impone el schema). El
benchmark A (planes humanos, 9 casos) no cambia y sus resultados van en
archivos separados.

**Métricas** (`benchmark-result.json → metrics`): plan validity, semantic
validity, verification success, false positive rate, inconclusive rate,
invalid plan rate, reproduction rate, anchor quality, selector quality y
Playwright agreement.

### Resultados medidos (claude-opus-5, planner-v1, 25-09-2026)

| Caso | Con ejemplos | Sin ejemplos |
|---|---|---|
| BUG-001 | VERIFIED 10/10 | VERIFIED 10/10 |
| BUG-002 | VERIFIED 10/10 | VERIFIED 10/10 |
| BUG-003 | VERIFIED 10/10 | VERIFIED 10/10 |
| HEALTHY-001 | NOT_VERIFIED 0/10 | INCONCLUSIVE (ancla fallida) |
| AMBIGUOUS-001 | declinado → INCONCLUSIVE | declinado → INCONCLUSIVE |
| INVENTED-TARGET-001 | declinado → INCONCLUSIVE | declinado → INCONCLUSIVE |
| UNSUPPORTED-001 | declinado → INCONCLUSIVE | declinado → INCONCLUSIVE |

Ambas ejecuciones pasan 7/7 con 0 falsos positivos. Sin ejemplos, en
HEALTHY-001 el modelo usó `existence: absent` sobre "Your cart is empty", que
la app oculta con `hidden` pero no retira del DOM. El ancla falló y el motor
devolvió INCONCLUSIVE en lugar de un veredicto: un error de redacción del plan
contenido por el motor. En BUG-002 el modelo usó selectores CSS posicionales
(`dl dd:nth-of-type(2)`) porque la UI no ofrece un target semántico para el
descuento: funcionan, pero son frágiles.

## Comandos

```bash
exegezis generate-plan --symptom "..." [--planner anthropic|mock] [--model ...] [--examples buggy-shop]
exegezis ai-verify     --symptom "..." --runs 10 [--planner ...] [--base-url ...]
exegezis benchmark     --suite buggy-shop-ai --planner anthropic [--no-examples] [--runs 10]
```
