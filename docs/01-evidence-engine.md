# Fase 0 / Iteración 1 — Evidence Engine

> Evidence first. Intelligence later.

Objetivo: observar software de forma determinista, capturar evidencia rica y
convertirla en datos estructurados y reproducibles. Sin LLMs, sin agentes.

## Estructura de un run

```text
runs/<runId>/                 runId = ULID (ordenable por tiempo)
├── metadata.json             identidad, estado, entorno, configHash, planHash, collectors, error
├── manifest.json             índice de artifacts: tipo, ruta, tamaño, sha256, estado de redacción, faltantes
├── plan.json                 plan ejecutado (acciones como datos, valores sensibles redactados)
├── timeline.json             eventos tipados y ordenados (id, seq, timestamp, elapsedMs, type, source, payload)
├── console.json              mensajes de consola + errores no capturados de la página
├── network.json              requests/responses (headers y bodies redactados)
├── accessibility.json        snapshots estructurados del árbol de accesibilidad
├── observations.json         observaciones → ids de su screenshot, DOM y snapshot a11y
├── execution-errors.json     errores de EXEGEZIS (no del target)
├── exegezis.log.jsonl        log estructurado (runId, eventId, component)
├── trace.zip                 Playwright trace (sanitizado)
├── dom/dom-0001.html
└── screenshots/shot-0001-<label>.png
```

Cada archivo tiene un schema Zod en `packages/core` (`RunMetadata`,
`ArtifactManifest`, `Timeline`, `ConsoleFile`, `NetworkFile`,
`AccessibilityFile`, `ObservationsFile`, `Plan`), así que un run se puede
releer y validar.

## Decisiones

| Decisión | Por qué |
|---|---|
| **Acciones como datos** (`Action`, unión discriminada Zod). Targets semánticos (`role`+`name`, `label`, `text`…) y `css` solo como escape explícito | Validables, auditables y reproducibles; compilables a tests. Coinciden con lo que expone el árbol de accesibilidad, así que una observación se puede convertir directamente en acción |
| **Adapter = núcleo mínimo + capacidades declaradas** (`descriptor.capabilities`, `descriptor.actions`, `descriptor.produces`) | El runner rechaza acciones no declaradas (`ACTION_REJECTED`) antes de llegar al adapter, y marca en el manifest los artifacts que el adapter prometía y no produjo |
| **IDs secuenciales por run** (`net-0003`, `evt-000042`) + ULID para el run | Dos runs del mismo plan producen ids comparables, lo que hace legibles los diffs entre runs |
| **`configHash` + `planHash`** (sha256 de JSON canónico) + entorno completo (browser, Playwright, Node, OS, viewport). Locale y timezone fijados (`en-US`, `UTC`) | Base para comparar runs: mismos hashes y mismo entorno ⇒ cualquier diferencia viene del target |
| **Timeline append-only y síncrona** (`timeline.partial.jsonl`) consolidada en `timeline.json` al final | Si el proceso muere, los eventos siguen en disco |
| **Manifest reescrito tras cada artifact**; `complete: true` solo al finalizar | Un run interrumpido tiene un índice exacto de lo que existe |
| **Un fallo detiene el plan, pero la recolección y el cierre siempre se ejecutan**. Tras una acción fallida se toma una observación `reason: "failure"` | Un run parcial sigue siendo evidencia |
| **`page_error` ≠ `execution_error`** | Uno es un hecho sobre el target, el otro sobre nuestra automatización. Confundirlos produciría bug reports falsos |
| **Árbol de accesibilidad vía `page.ariaSnapshotJSON()`** (Playwright 1.63), normalizado (los fragmentos de texto sueltos pasan a `{role:"text"}`) | Estructurado de forma nativa, sin parsear YAML; es la misma semántica que usan los locators por rol |
| **Bodies solo de fetch/XHR**, hasta `maxBodyBytes`; un JSON truncado **no se guarda** | Un JSON truncado no se puede redactar por clave: preferimos no guardarlo a filtrar un secreto |

## Redacción (defensa en capas)

1. **Estructural:** headers por nombre (`Authorization`, `Cookie`, `Set-Cookie`,
   `X-API-Key` y patrones `*token*`, `*secret*`, `*session*`…), query params y
   claves JSON o de formulario sensibles. El header se conserva con el valor
   `[REDACTED]`: saber que existía un `Authorization` también es evidencia.
2. **Registro de secretos:** cada valor redactado (y cada `fill` sensible o de
   un input `type=password`) se añade a un `SecretRegistry`. Esos valores se
   eliminan de **todo** artifact de texto al escribirlo y otra vez al finalizar,
   así que un secreto descubierto tarde también desaparece de artifacts
   escritos antes.
3. **Trace:** `trace.zip` se reescribe: headers y cookies en cualquier línea
   JSON, más el scrub del registro en cada entrada de texto. Después se
   re-escanea y el manifest marca `verified` o `failed`. Si la redacción falla,
   el trace **se descarta**.
4. **Verificación:** los tests buscan los secretos del fixture byte a byte en
   todo el run, incluido el interior del zip.

## Laboratorio

`examples/buggy-shop` tiene 3 bugs sembrados (ver
[KNOWN_BUGS.md](../examples/buggy-shop/docs/KNOWN_BUGS.md)). La suite
convencional pasa. La suite `known-bugs` afirma el comportamiento correcto con
`test.fail()` y solo pasa mientras los bugs existan. Los escenarios en
`scenarios/*.json` los reproducen con `exegezis observe --actions`.

## Deuda técnica conocida

- **Screenshots no escaneables:** pueden mostrar datos sensibles visibles en
  pantalla (`redaction: "not_scannable"`).
- **Inputs sensibles no marcados:** un secreto escrito en un input que no es
  `type=password` ni está marcado `sensitive: true` se guarda tal cual. Además,
  un password detectado solo por `type=password` queda en
  `timeline.partial.jsonl` hasta que el run finaliza (si el proceso muere
  antes, queda ahí).
- **Valores cortos:** el registro ignora secretos detectados de menos de 6
  caracteres para no corromper la evidencia (los `fill` sensibles explícitos
  sí se registran siempre).
- **Secretos con escapes:** un secreto que contenga `"` o `\` aparece escapado
  en JSON y el scrub literal no lo encuentra.
- **Formato interno del trace:** la redacción no depende del layout de
  Playwright, pero sí de que el trace sea JSON lines + recursos. Hay que
  revalidarla en cada actualización de Playwright (el test de fuga de secretos
  lo detecta).
- **Solo Chromium, una página:** popups, pestañas nuevas e iframes
  cross-origin no se observan como páginas propias (la red y la consola del
  contexto sí se capturan).
- **Sin comparación de runs todavía:** el modelo lo permite (hashes, ids
  secuenciales), pero no existe `exegezis diff`.
- **`Reproduction`** existe como modelo validado, pero todavía no hay un
  comando que ejecute N intentos.
