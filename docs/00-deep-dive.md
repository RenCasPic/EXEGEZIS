# EXEGEZIS — Product + Technical Deep Dive

> *Software that explains itself.*
> Documento v0.1 · 2026-09-24 · Estado: borrador para discusión entre fundadores

**Nota sobre fuentes.** El panorama competitivo se basa en mi conocimiento hasta mediados de 2026. El mercado de "AI testing" cambia cada trimestre. Todo lo marcado con ⚠️ hay que verificarlo antes de usarlo en un pitch o para decidir precios.

---

## 1. Executive Summary

**Tesis.** Probar software ya no es lo más caro. Lo caro es **pasar de "algo falla" a "sé exactamente por qué, puedo demostrarlo y está corregido"**. Hoy ese recorrido lo hacen personas: reproducir, aislar, leer traces, formular hipótesis, corregir y comprobar. Las herramientas actuales cubren partes sueltas. Las de testing detectan, las de observabilidad registran y los coding agents escriben código. Ninguna produce una **cadena de evidencia verificable** que conecte el síntoma con la causa, el fix y la prueba.

**Mi recomendación, que corrige en parte tu hipótesis inicial:**

1. **No posicionar EXEGEZIS como "AI testing".** Es la categoría más saturada del mercado: hay más de 20 startups financiadas, y además Playwright, Cypress, BrowserStack y mabl ya incluyen agentes. Entrar ahí es competir en precio y en demos.
2. **No posicionarlo como "AI software engineering loop".** Ahí compiten Copilot, Cursor, Devin, Claude Code y Codex, con presupuestos 1000× mayores. Perderíamos.
3. **Posicionarlo como *AI Software Verification*: debugging basado en evidencia.** La unidad de valor no es "un test" ni "un fix". Es un **Verified Bug**: una reproducción ejecutable que **falla antes** del fix y **pasa después**, con una cadena de evidencia que explica por qué. Eso es exactamente lo que significa la marca: exégesis.
4. **Wedge recomendado: "Bug report → Verified Reproduction".** Recibe un síntoma (issue de GitHub, ticket, error de Sentry o test roto) y devuelve un test de Playwright que reproduce el problema de forma determinista, la causa raíz con evidencia, un fix propuesto y la demostración de que el fix funciona. Contiene el loop completo en su forma más pequeña y vendible.
5. **Cambio sobre tu MVP.** Tu hipótesis de MVP plantea que "EXEGEZIS **encuentra** un bug que un test no detectó". El descubrimiento autónomo es la parte más difícil, la más ruidosa (falsos positivos) y la más difícil de vender, porque su valor es estocástico. Propongo que el MVP **arranque desde un síntoma dado** y deje la exploración autónoma como feature secundaria. La demo del MVP sigue siendo igual de potente y se puede construir en 8–10 semanas.

**¿Puede ser una empresa defendible?** Sí, pero solo si el moat es la **calidad y la verificabilidad de la reproducción** (tasa de reproducción, tasa de falsos positivos, evidencia) y la **memoria estructurada por aplicación**. Si el moat es "usamos un LLM para testear", no hay empresa: esa capacidad se vuelve commodity en 12 meses.

---

## 2. El problema que realmente estamos resolviendo

Hay tres problemas que suelen confundirse:

| Problema | ¿Quién lo resuelve hoy? | ¿Es doloroso? | ¿Está resuelto? |
|---|---|---|---|
| **Escribir tests** | Playwright codegen, Copilot, agentes de testing | Medio | Casi: se está volviendo commodity |
| **Mantener tests** (flaky, selectores rotos) | Self-healing (mabl, Testim, Playwright healer) | Alto | Parcialmente |
| **Entender fallos** (¿es un bug real? ¿por qué? ¿dónde?) | Personas mirando traces, logs y código | **Muy alto** | **No** |

El problema real es el tercero. En equipos de producto, el ciclo típico de un bug es:

```text
Reporte vago ("el checkout a veces falla")
  → ¿alguien puede reproducirlo?        ← aquí mueren muchos bugs ("cannot reproduce")
  → ¿qué componente es?                 ← ping-pong entre frontend, backend y QA
  → ¿por qué pasa?                      ← horas de un senior leyendo traces
  → fix
  → ¿cómo sé que está arreglado y no vuelve?  ← con frecuencia no hay regression test
```

**Formulación del problema:** *los equipos de software pierden una parte enorme del tiempo de ingeniería senior en convertir síntomas ambiguos en causas demostradas, y el resultado de ese trabajo (el conocimiento de por qué falló) se pierde en lugar de convertirse en un activo verificable.*

EXEGEZIS convierte ese trabajo en un artefacto: **reproducción ejecutable + cadena de evidencia + fix + prueba de que el fix funciona**.

---

## 3. Usuario ideal (ICP)

**Primario, el que compra y usa en el MVP:**
- **Equipo de producto web de 10 a 80 ingenieros**, en una startup o scale-up (Serie A–C).
- Stack web moderno: React/Next/Vue más API REST o GraphQL, en TypeScript o Python.
- **Ya usa Playwright** o está migrando a él. Este dato es clave porque reduce la fricción de adopción a casi cero.
- Usa GitHub y tiene entornos de preview o staging.
- QA pequeño o inexistente: los developers son dueños de la calidad.
- Siente el dolor en forma de bugs reportados por clientes que tardan días en reproducirse y de tests E2E rojos que nadie investiga.

**Persona usuaria:** Staff/Senior Engineer o Tech Lead, y QA Engineer técnico (SDET).
**Persona compradora:** VP/Head of Engineering (presupuesto de herramientas) o Engineering Manager.

**No es ICP en el MVP:**
- Enterprise regulado: ciclos de venta de 9 meses y requisitos de on-prem.
- Equipos sin tests ni entornos reproducibles: el problema ahí es otro.
- Mobile nativo o desktop: requieren otros adapters.
- Agencias de QA manual: compiten con nosotros o quieren una herramienta distinta.

---

## 4. Jobs-to-be-done

| # | Cuando… | Quiero… | Para… |
|---|---|---|---|
| J1 | un cliente reporta un bug vago | obtener una reproducción exacta y automática | no perder un día intentando reproducirlo |
| J2 | un test E2E falla en CI | saber si es un bug real, un test flaky, un test roto o un problema de entorno | no ignorar fallos reales ni perder tiempo en ruido |
| J3 | tengo una reproducción | entender qué componente y qué cambio lo causaron, con pruebas | no discutir opiniones entre equipos |
| J4 | tengo la causa | recibir un fix revisable con explicación de riesgos | cerrar el bug rápido sin romper otra cosa |
| J5 | cierro un bug | tener un regression test que demuestre que no vuelve | no volver a pagar el mismo bug |
| J6 | reviso un PR | verificar que los flujos afectados siguen funcionando | desplegar con confianza |
| J7 | soy manager | ver qué partes del sistema fallan más y por qué | priorizar deuda técnica con datos |

**J1, J3 y J5 son el núcleo del MVP.** J2 es el wedge alternativo. J6 y J7 llegan después.

---

## 5. Competencia actual

⚠️ Verificar el estado actual de cada producto antes de publicar comparativas.

### 5.1 Mapa por categoría

| Categoría | Jugadores | Qué hacen | Qué NO hacen |
|---|---|---|---|
| **Frameworks** | Playwright, Cypress, Selenium | Ejecución determinista, traces. Playwright incorporó agentes (planner/generator/healer) y MCP ⚠️ | No investigan causas ni conectan con el código del servidor |
| **Infra de ejecución** | BrowserStack, Sauce Labs, LambdaTest, Browserbase | Grids de navegadores y dispositivos, observabilidad de tests, algo de AI | Ejecutan, no explican |
| **AI test automation (low-code)** | mabl, Functionize, Testim (Tricentis), testRigor, Autify | Crear y mantener tests con AI, self-healing | Foco en crear y mantener, no en la causa raíz del producto |
| **AI testing agents (nuevos)** | Momentic, Octomind, Checksum, QA.tech y otros ⚠️ | Generan y ejecutan E2E con agentes | Poco o nada de análisis de código ni verificación de fixes |
| **Regresión desde tráfico real** | Meticulous ⚠️ | Graban sesiones reales y detectan diferencias visuales o de comportamiento en PRs | No hacen causa raíz ni fixes |
| **QA como servicio** | QA Wolf, Rainforest QA | Humanos más AI escriben y mantienen tus tests. Garantía de cobertura | Modelo de servicio con margen bajo y sin loop de fix |
| **Visual AI** | Applitools | Detección visual robusta | Nicho visual |
| **Observabilidad + AI** | **Sentry (Seer)**, Datadog (Bits AI), New Relic | Errores de producción, **causa raíz con AI y autofix en PR** (Sentry) | Parten de errores que *ya lanzaron* una excepción. No reproducen en navegador ni prueban el fix con un test E2E |
| **Coding agents** | Copilot agent, Cursor (+Bugbot), Devin, Claude Code, Codex | Escriben y corrigen código, revisan PRs | No interactúan de forma robusta con la app corriendo ni producen evidencia de runtime estructurada |
| **Time-travel debugging** | Replay.io ⚠️ (pivotó parcialmente) | Grabación determinista del navegador | Adopción limitada |
| **Browser agents (infra)** | browser-use, Stagehand, Playwright MCP | Primitivas para que un LLM use un navegador | Son componentes, no productos. **Los usaremos o competiremos con ellos como librerías** |

### 5.2 Las dos amenazas reales

1. **Sentry Seer.** Es el competidor conceptual más cercano: hace causa raíz y fix desde errores. Nuestra diferencia debe ser explícita. Sentry parte de **excepciones en producción**. Nosotros partimos de **síntomas de comportamiento** (el botón no hace nada, el total está mal, el flujo se queda colgado), que muchas veces **no lanzan excepción**. Además, nosotros **demostramos** el fix con una reproducción ejecutable. Una posible estrategia es integrarnos con Sentry como fuente de síntomas en lugar de competir de frente.
2. **Playwright + coding agents genéricos.** Un developer con Claude Code o Cursor y Playwright MCP puede hacer a mano el 60% de lo que proponemos. **Esta es la prueba de fuego:** si nuestro producto no es claramente mejor que "Claude Code + Playwright MCP + 20 minutos de prompting", no hay negocio. Nuestra ventaja tiene que venir de:
   - un pipeline de evidencia persistente y estructurado (no un chat);
   - reproducción determinista y medida (N/M ejecuciones);
   - memoria por aplicación;
   - integración en el flujo del equipo (GitHub, CI, issues);
   - gobernanza (permisos, auditoría, aprobaciones).

---

## 6. Diferenciación potencial

Evalué las cinco opciones que planteaste:

| Opción | Tamaño de mercado | Saturación | Defensibilidad | Encaje con la marca | Veredicto |
|---|---|---|---|---|---|
| **A. AI testing** | Grande | **Muy alta** | Baja: el LLM que genera tests es commodity | Débil | ❌ No como posicionamiento principal |
| **B. AI debugging** | Grande | Media (Sentry, coding agents) | Media | **Fuerte**: "explicar por qué" | ✅ Es el núcleo |
| **C. AI software verification** | Grande y creciendo con el código escrito por AI | **Baja** | **Alta**: la evidencia y la reproducibilidad son difíciles de hacer bien | **Muy fuerte** | ✅ Es la categoría |
| **D. AI SE loop** | Enorme | Dominado por gigantes | Muy baja para nosotros | Media | ❌ Es un destino, no un punto de partida |
| **E. Otra** | — | — | — | — | Ver abajo |

**Mi tesis: C, con B como wedge.** Me explico.

Con los coding agents, **la generación de código deja de ser el cuello de botella y la verificación pasa a serlo.** Cuando el 40–70% del código lo escriben agentes, la pregunta que importa es: *¿cómo sé que esto funciona y, cuando no funciona, por qué?* Esa es una categoría que crece con el éxito de nuestros "competidores" en lugar de competir con ellos. Copilot, Cursor y Devin generan más código, y por tanto más necesidad de EXEGEZIS.

**Posicionamiento propuesto:** *EXEGEZIS es la capa de verificación para software escrito por humanos y por agentes. Reproduce, explica y demuestra.*

**Principio de producto que nos diferencia:** **Proof over plausibility.** Ningún otro producto trata la evidencia como ciudadano de primera clase. En EXEGEZIS, cada afirmación tiene un estado (`OBSERVED`, `SUPPORTED`, `VALIDATED`, `REFUTED` o `INSUFFICIENT_EVIDENCE`) y enlaces a artefactos. Además, la confianza **no la reporta el LLM**, porque la autoevaluación de un LLM está mal calibrada. **Se calcula a partir de verificaciones**: se reprodujo 5/5, el fix hace pasar la reproducción, los tests existentes siguen pasando.

---

## 7. Riesgos de producto

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **"Nice demo, no budget"**: impresiona pero no se compra | Alta | Crítico | Medir tiempo ahorrado por bug con design partners desde la semana 1. Cobrar pilotos (aunque sea poco) |
| **Falsos positivos** que destruyen la confianza | Alta | Crítico | Reportar solo bugs con reproducción verificada. Umbral conservador. Mostrar "INSUFFICIENT EVIDENCE" sin miedo |
| **Commoditización** por Playwright, Cursor o Sentry | Alta | Alto | Moat en el pipeline de evidencia, la memoria por aplicación y la integración en el flujo de trabajo. Moverse rápido hacia verificación |
| **Fricción de setup** (auth, datos de prueba, entornos) | **Muy alta** | Alto | Empezar con apps que ya tienen staging y Playwright. Soportar `storageState` y fixtures existentes |
| **Acceso a código y entornos** (confianza, seguridad) | Media | Alto | Modo local o self-hosted runner desde el inicio. Permisos mínimos |
| **Scope creep**: la visión es enorme | **Muy alta** | Crítico | Este documento: lista explícita de exclusiones (sección 15) |
| **El usuario no quiere fixes automáticos**, solo el diagnóstico | Media | Medio | El fix es opcional. Aunque el producto se quedara en "reproducción + causa raíz", seguiría siendo valioso |

---

## 8. Riesgos técnicos

| Riesgo | Descripción | Mitigación |
|---|---|---|
| **Tasa de reproducción baja** | Muchos bugs dependen de datos, estado, timing o usuario concreto | Benchmark propio desde la fase 0. Medir la tasa por tipo de bug. Aceptar "no reproducible" como un resultado válido y útil |
| **Autenticación y estado de la app** | Login con MFA, SSO, datos semilla | Soportar credenciales de test por entorno, `storageState` y scripts de seed provistos por el cliente. **No resolver MFA ni CAPTCHAs** |
| **Tamaño del contexto de observación** | Un DOM crudo tiene más de 100k tokens | Accessibility tree / ARIA snapshot compacto con refs, diffs entre pasos y screenshots bajo demanda |
| **No determinismo del agente** | Dos runs, dos resultados | El agente *explora* y, una vez encontrada la reproducción, se **compila a un test Playwright determinista**. Lo que se verifica es el test, no el agente |
| **Causa raíz en el backend sin acceso** | Solo vemos HTTP 500 | Niveles de evidencia: con solo la caja negra, la causa raíz llega hasta "el endpoint X devuelve 500 con el payload Y". Con acceso al repo y los logs, profundiza. Nunca inventar más allá del límite |
| **Construir y ejecutar el repo del cliente** | `npm install` y build arbitrarios implican riesgo de seguridad y coste | Sandboxes efímeros (microVM). En el MVP: runner local o self-hosted del cliente |
| **Flakiness de nuestro propio sistema** | Timeouts, apps lentas | Reintentos deterministas, esperas de Playwright y clasificación "infra error" separada de "bug" |
| **Coste LLM por investigación** | Loops largos de agente | Presupuesto por run (tokens y pasos), cache de observaciones, modelos pequeños para tareas triviales |
| **Evaluación** | ¿Cómo sabemos que mejoramos? | Suite de evaluación con bugs sembrados más bugs reales de proyectos open source. Es obligatoria desde la fase 0 |

---

## 9. Arquitectura propuesta

### 9.1 Vista general

```text
┌──────────────────────────── CONTROL PLANE ────────────────────────────┐
│  Web UI (Next.js)        API (TypeScript)         GitHub App           │
│      │                      │                        │                 │
│      └──────────┬───────────┴────────────┬───────────┘                 │
│                 ▼                        ▼                             │
│   Orchestrator (run state machine) ── Policy Engine (RBAC, approvals)  │
│                 │                        │                             │
│   PostgreSQL (+pgvector)   Job queue (Postgres)   Object Storage (S3)  │
│                 │                                                      │
│   Model Gateway (model-agnostic LLM, cache, budgets, structured output)│
└─────────────────┼──────────────────────────────────────────────────────┘
                  │  jobs (pull-based; el worker pide trabajo)
┌─────────────────▼───────────── EXECUTION PLANE ───────────────────────┐
│  Worker (efímero, aislado, por run)                                    │
│   ├── Agent Runtime (Tester / Investigator / Developer)                │
│   ├── Tool Layer (acciones tipadas, validadas por políticas)           │
│   ├── Adapters: Browser(Playwright) · Api · Code(repo) · Cli          │
│   └── Evidence Recorder → artifacts → Object Storage                   │
│  Aislamiento: contenedor en dev → microVM (Firecracker/gVisor) en SaaS │
│  Variante: Self-hosted Runner en la red del cliente                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Decisiones clave

1. **Modular monolith, no microservices.** Un solo backend en TypeScript con módulos bien separados (`runs`, `evidence`, `policy`, `agents`, `integrations`). El único proceso separado desde el día 1 es el **worker**, por razones de aislamiento y escala, no de moda.
2. **Workers pull-based.** El worker pide trabajo al control plane y no se aceptan conexiones entrantes. Así un **self-hosted runner** funciona igual dentro de la red del cliente, siguiendo el modelo de GitHub Actions runners. Esto resuelve pronto la mitad de las objeciones de seguridad.
3. **El run es una máquina de estados persistida en Postgres.** Los agentes son pasos de esa máquina, no un loop infinito en memoria. Si el worker muere, el run se reanuda o falla limpiamente. Las aprobaciones humanas son un estado `AWAITING_APPROVAL`.
4. **Durable execution: todavía no.** Temporal, Restate o Inngest encajan conceptualmente, pero añaden complejidad operativa. Arrancamos con una máquina de estados explícita más una cola en Postgres. Lo reevaluamos en la fase 3, cuando haya multi-agente y workflows largos.
5. **Event log append-only** por run. Todo lo que pasa se escribe como evento inmutable. La UI, el timeline y la cadena de evidencia se derivan de ahí.

### 9.3 Estados del run

```text
QUEUED → PROVISIONING → REPRODUCING → INVESTIGATING → [AWAITING_APPROVAL] → FIXING → VERIFYING → COMPLETED
                             │               │                                   │          │
                             └──────► NOT_REPRODUCED / INSUFFICIENT_EVIDENCE     └──► FIX_FAILED
                                         (resultados válidos, no errores)
Cualquier estado → FAILED (infra) | CANCELLED | BUDGET_EXCEEDED
```

---

## 10. Agent architecture

### 10.1 Principio: los agentes son planificadores, las herramientas son deterministas

```text
LLM decide QUÉ hacer ──► Tool call tipado (Zod schema) ──► Policy check ──► Ejecución determinista ──► Evidencia
                                                              │
                                                     deny / require approval
```

El LLM **nunca** ejecuta nada directamente. Solo produce *tool calls* validados contra un esquema y autorizados por el policy engine.

### 10.2 Los tres agentes

| | **Tester** | **Investigator** | **Developer** |
|---|---|---|---|
| Entrada | Objetivo o síntoma + target | Reproducción + evidencia | Causa raíz VALIDATED + repo |
| Salida | **Reproducción compilada** (test Playwright) + evidence bundle | Grafo de claims con evidencia + causa raíz o INSUFFICIENT_EVIDENCE | Diff + regression test + resultado de verificación |
| Herramientas | Browser (observe/act), API, capturas | Lectura de trace/network/console, búsqueda en el repo, git log/blame, re-ejecución con variaciones | Leer y editar archivos (sandbox), ejecutar tests, lint, typecheck y build |
| Nivel de permiso | READ + acciones en la app de test | READ | SAFE WRITE (branch/test); DESTRUCTIVE requiere aprobación |
| Parte determinista | Ejecución, asserts, captura y compilación del test | Re-ejecución N veces, bisect, diffs | Ejecución de tests, diff y verificación antes/después |

**En el MVP, los tres "agentes" son tres fases del mismo run** con prompts, herramientas y permisos distintos. No hay "multi-agent chatter" entre ellos. Se comunican **a través de artefactos tipados** (la reproducción, el grafo de evidencia), no por conversación. El multi-agente real llega en la fase 3, si se justifica.

### 10.3 El paso clave: compilar la exploración a un test determinista

```text
Agente explora (no determinista)
   → encuentra una secuencia que muestra el síntoma
   → se "compila" a un spec de Playwright (locators por role/label, asserts explícitos)
   → se ejecuta N veces sin LLM
   → reproduction_rate = k/N
   → si k/N ≥ umbral: es una REPRODUCCIÓN VERIFICADA. Si no: FLAKY o NOT_REPRODUCED
```

**Esta es la idea técnica central de EXEGEZIS.** Convierte la salida del LLM en algo verificable sin LLM. El mismo test sirve como regression test al final.

### 10.4 Investigación: observación → evidencia → hipótesis → validación

El Investigator trabaja sobre un **grafo de claims**:

```text
Claim { statement, kind: observation|hypothesis|root_cause, status, evidence[] }
status ∈ OBSERVED | SUPPORTED | VALIDATED | REFUTED | INSUFFICIENT_EVIDENCE
```

Reglas duras, aplicadas por código y no por prompt:
- Una `observation` solo puede crearse a partir de un artefacto (una línea de consola, un request, una screenshot).
- Una `hypothesis` necesita al menos 1 evidencia para llegar a `SUPPORTED`.
- `VALIDATED` requiere un **experimento**: una re-ejecución con una variación que confirma la predicción. Por ejemplo: "si la causa es el timezone, con `TZ=UTC` no falla". Esa estrategia de validación es lo que distingue una investigación de una opinión.
- La `root_cause` final solo puede tener status `VALIDATED` o `INSUFFICIENT_EVIDENCE`. Nunca "probable" sin más.

### 10.5 Qué es determinista y qué usa AI

| Determinista | AI-driven |
|---|---|
| Acciones del navegador, locators, asserts | Planificar qué explorar y cómo reproducir |
| Ejecución de tests, N repeticiones, reproduction rate | Interpretar anomalías (¿es un bug o comportamiento esperado?) |
| Captura de artefactos (trace, HAR, consola, screenshots) | Generar hipótesis de causa raíz |
| Diffs (DOM, network, git), bisect | Diseñar experimentos de validación |
| Permisos, políticas, presupuestos, auditoría | Localizar código relevante (junto con búsqueda determinista) |
| Cálculo de confianza a partir de verificaciones | Proponer el fix y redactar explicaciones |
| Clasificación de errores obvios (5xx, uncaught exception, 4xx inesperado) | Priorizar |

### 10.6 Minimizar coste, latencia y alucinación

- **Structured outputs** en toda llamada al LLM (Zod → JSON Schema). Nada de parsear texto libre.
- **Detectores deterministas primero**: los errores de consola, los 5xx y las excepciones no necesitan LLM para detectarse. Solo para interpretarse.
- **Observaciones compactas**: ARIA snapshot con refs en lugar de DOM, diff respecto al paso anterior y screenshot solo cuando hace falta.
- **Model routing**: un modelo pequeño para tareas mecánicas (resumir logs, extraer campos) y uno grande para razonar (hipótesis, fix).
- **Cache**: prompt caching del proveedor para el contexto estable (sistema, resumen del repo, memoria) más cache propio por hash de entrada en las llamadas idempotentes.
- **Presupuesto duro por run**: máximo de pasos, tokens, minutos y coste. Al superarlo, `BUDGET_EXCEEDED` con lo que se sepa hasta ese momento.
- **No exponer el chain-of-thought.** El agente emite `rationale_summary` (1–2 frases) por acción, y eso es lo que se muestra.

---

## 11. Adapter architecture

### 11.1 Crítica a la interfaz propuesta

Tu `TargetAdapter` con `connect/observe/act/execute/assert/captureEvidence/collectLogs/collectNetwork/getState` tiene un problema: **obliga a todos los adapters a implementar todo**, y no todos tienen network, DOM o "act". Una CLI no tiene `observe` en el mismo sentido que un navegador. El resultado serían métodos vacíos o que lanzan `NotImplemented`.

**Propuesta: un núcleo mínimo más *capabilities* declaradas.**

```ts
interface TargetAdapter {
  readonly kind: string;                          // "browser" | "api" | "cli" | "code" | ...
  readonly capabilities: ReadonlySet<Capability>;
  connect(config: TargetConfig, ctx: RunContext): Promise<Session>;
}

interface Session {
  observe(): Promise<Observation>;                // estado actual, normalizado
  act(action: Action): Promise<ActionResult>;     // acción tipada, validada por políticas antes
  captureEvidence(kinds: EvidenceKind[]): Promise<ArtifactRef[]>;
  close(): Promise<void>;
}

// Capacidades opcionales, descubiertas por el runtime:
type Capability =
  | "dom" | "accessibility" | "screenshot" | "network" | "console"
  | "logs" | "filesystem" | "process" | "http" | "trace";
```

- **Las acciones son datos**, no métodos: `{ type: "click", target: {role:"button", name:"Pagar"} }`. Esto permite validarlas con políticas, registrarlas, reproducirlas y compilarlas a tests.
- **Cada adapter publica su catálogo de acciones** (JSON Schema). Las herramientas que ve el LLM se generan automáticamente a partir de ese catálogo más las capabilities. **Agregar un adapter no toca el runtime de agentes.**
- **`assert` no pertenece al adapter.** Es lógica del motor de tests, que evalúa assertions sobre `Observation`s.

### 11.2 Adapters

| Adapter | Base técnica | Fase |
|---|---|---|
| **BrowserAdapter** | Playwright (Chromium) + CDP vía `CDPSession` para lo que Playwright no expone | **MVP** |
| **CodeAdapter** | Repo en un sandbox: lectura, búsqueda (ripgrep), git, ejecución de comandos allowlisted | **MVP** |
| **ApiAdapter** | HTTP client + OpenAPI | Fase 2 |
| **CliAdapter** | Procesos en sandbox, stdin/stdout, exit codes | Fase 2–3 |
| VSCodeAdapter | `@vscode/test-electron` + Playwright sobre Electron | Fase 4 |
| DesktopAdapter | Electron vía Playwright. Nativo vía UIA (Windows) / AX (macOS) | Fase 4+ |
| MobileAdapter | Appium / Maestro | Fase 4+ |
| OfficeAdapter / PluginAdapter | Office.js en navegador (reutiliza Browser) | Fase 4+ |

### 11.3 Browser MVP: evaluación técnica

| Opción | Pros | Contras | Decisión |
|---|---|---|---|
| **Playwright** | Auto-wait, locators semánticos, **tracing** (trace.zip con DOM, network y consola), multi-browser, ARIA snapshots, el cliente ya lo usa | Abstrae algunas cosas de CDP | ✅ **Base** |
| CDP directo / Puppeteer | Control total (coverage, heap, performance) | Solo Chromium, mucho código propio | Usar **dentro** de Playwright vía `newCDPSession` cuando haga falta |
| Selenium/WebDriver BiDi | Estándar | Peor ergonomía y tracing | ❌ |
| browser-use / Stagehand | Rápidos para prototipar agentes | Abstracciones opinadas, dependencia de terceros en el núcleo | ❌ en el núcleo. Sirven como referencia |
| Playwright MCP | Estándar de facto para LLMs | Pensado para chat, no para pipelines con evidencia | Posible **interfaz de salida** (exponer EXEGEZIS como MCP), no como núcleo |

**Representación del estado para el LLM:** ARIA snapshot (accessibility tree) con refs estables es la representación primaria, por ser compacta y semántica. La screenshot solo se usa cuando el árbol es insuficiente (canvas, problemas visuales). El DOM crudo nunca se envía al LLM: se guarda como evidencia.

Beneficio lateral: si la app no es accesible, el agente también lo nota. Eso es un hallazgo en sí mismo.

---

## 12. Data model

### 12.1 Qué va en cada capa

| Capa | Tecnología | Contenido |
|---|---|---|
| **Relacional** | PostgreSQL | Entidades: orgs, projects, environments, runs, bugs, tests, claims, approvals y memoria estructurada. **La verdad del sistema** |
| **Event history** | PostgreSQL (tabla append-only, particionada por mes cuando haga falta) | Todo lo que pasó en un run: acciones, observaciones, decisiones, tool calls. Inmutable |
| **Artifacts** | Object storage (S3/R2/MinIO) | Blobs: trace.zip, screenshots, HAR, logs, DOM snapshots, videos y diffs. En Postgres solo va la metadata y el hash |
| **Semántico** | **pgvector** (en el mismo Postgres) | Embeddings de bugs, causas raíz y resúmenes de componentes, **para buscar similares**. Nunca como fuente de verdad |

**Redis: no en el MVP.** La cola va en Postgres (pg-boss o graphile-worker), el cache de LLM en Postgres y el pub/sub para la UI en tiempo real con `LISTEN/NOTIFY` o SSE. Redis se añade cuando haya una métrica que lo justifique.

### 12.2 Entidades principales

```text
Organization ─┬─ Membership ── User
              └─ Project ─┬─ Environment (url, credentials_ref, policies)
                          ├─ Repository (provider, installation_id, default_branch)
                          ├─ Component (nombre, paths, rutas UI, endpoints)   ← memoria
                          ├─ TestCase ── TestVersion (spec compilado, fuente: manual|generated|reproduction)
                          ├─ Bug ─┬─ Claim* ── EvidenceLink* ── Artifact
                          │       ├─ Reproduction (TestVersion + reproduction_rate)
                          │       ├─ Fix (branch, diff_artifact, pr_url, status)
                          │       └─ Verification (before/after results)
                          └─ Run ─┬─ RunEvent* (append-only)
                                  ├─ Step* (action, rationale_summary, observation_ref)
                                  ├─ Artifact*
                                  ├─ Approval*
                                  └─ Usage (tokens, cost, minutes)
AuditLog (org-wide, append-only)
MemoryFact (scope, subject, fact, source_run/bug, status: active|superseded|rejected)
```

### 12.3 Cadena de evidencia: "¿Por qué EXEGEZIS afirma que esto es un bug?"

```sql
-- Esquema esencial (se refinará con migraciones reales)
CREATE TABLE claim (
  id           uuid PRIMARY KEY,
  bug_id       uuid REFERENCES bug(id),
  run_id       uuid REFERENCES run(id),
  kind         text CHECK (kind IN ('observation','hypothesis','root_cause','expected_behavior')),
  statement    text NOT NULL,
  status       text CHECK (status IN ('OBSERVED','SUPPORTED','VALIDATED','REFUTED','INSUFFICIENT_EVIDENCE')),
  derived_from uuid[] ,          -- claims padre (grafo)
  produced_by  text,             -- 'detector:console' | 'agent:investigator' | 'human:<user_id>'
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE evidence_link (
  claim_id     uuid REFERENCES claim(id),
  artifact_id  uuid REFERENCES artifact(id),
  locator      jsonb,            -- p.ej. {"har_entry": 42} o {"console_line": 17} o {"file":"src/x.ts","lines":[10,22]}
  relation     text CHECK (relation IN ('supports','refutes','context')),
  PRIMARY KEY (claim_id, artifact_id, locator)
);

CREATE TABLE artifact (
  id           uuid PRIMARY KEY,
  run_id       uuid REFERENCES run(id),
  kind         text,             -- trace|screenshot|har|console|server_log|dom_snapshot|diff|test_result|source_excerpt
  storage_key  text NOT NULL,    -- clave en object storage, con prefijo por org
  sha256       text NOT NULL,    -- integridad: la evidencia no se altera
  meta         jsonb,
  created_at   timestamptz DEFAULT now()
);
```

Recorrer el grafo `root_cause → derived_from → … → observation → evidence_link → artifact` **es** la respuesta a "¿por qué?". La UI lo muestra como un árbol navegable en el que cada hoja abre el artefacto exacto (la línea de consola, el request, el fragmento de código).

### 12.4 Bug Report: esquema mejorado

Mejoras sobre tu versión:
1. Separar **hechos** (observaciones con evidencia) de **interpretaciones** (hipótesis).
2. La reproducción es un **artefacto ejecutable**, no texto.
3. La confianza se **deriva** de verificaciones, con su justificación.
4. Una sección explícita de **unknowns**.
5. Identificadores estables para referenciar la evidencia.

```jsonc
{
  "schema_version": "1.0",
  "id": "bug_01J...",
  "title": "El total del carrito no se actualiza al eliminar un item con cupón aplicado",
  "status": "verified_fixed",          // reported|reproduced|investigated|fix_proposed|verified_fixed|not_reproduced|wont_fix
  "severity": { "level": "high", "rationale": "Cobro incorrecto al usuario en checkout" },
  "environment": { "id": "env_staging", "url": "https://staging.acme.dev", "commit": "a1b2c3d", "browser": "chromium 1xx" },

  "symptom": { "source": "github_issue#812", "reported_text": "…" },
  "expected": { "statement": "El total refleja los items restantes con descuento", "basis": "spec|existing_test|user_report|inferred", "evidence": ["ev_7"] },
  "actual":   { "statement": "El total mantiene el precio del item eliminado", "evidence": ["ev_3", "ev_4"] },

  "reproduction": {
    "test_ref": "tests/exegezis/bug_812.spec.ts",
    "preconditions": ["usuario logueado (storageState: buyer)", "cupón SAVE10 activo"],
    "steps": [ { "n": 1, "action": "goto /cart" }, { "n": 2, "action": "click button 'Eliminar' (item 2)" } ],
    "runs": 10, "reproduced": 10, "rate": 1.0
  },

  "observations": [
    { "id": "ev_3", "statement": "PATCH /api/cart devuelve total=129.90", "artifact": "art_har_1#entry=42" },
    { "id": "ev_4", "statement": "UI muestra 129.90 tras eliminar", "artifact": "art_shot_5" }
  ],
  "hypotheses": [
    { "id": "h1", "statement": "El descuento se recalcula antes de eliminar el item", "status": "VALIDATED",
      "evidence": ["ev_3", "ev_9"], "validation": "Invirtiendo el orden en un experimento, el total es correcto (run_…)" },
    { "id": "h2", "statement": "Cache del frontend", "status": "REFUTED", "evidence": ["ev_3"] }
  ],
  "root_cause": {
    "status": "VALIDATED",             // VALIDATED | INSUFFICIENT_EVIDENCE
    "statement": "applyCoupon() se invoca antes de removeItem() en cartService.update",
    "location": { "file": "api/src/cart/service.ts", "lines": [88, 104], "commit_introduced": "f00ba7 (bisect)" },
    "hypothesis_ref": "h1"
  },
  "confidence": {
    "value": 0.93,
    "derived_from": ["reproduction_rate=1.0", "validation_experiment=passed", "fix_verification=passed"],
    "method": "rule-based v1"
  },
  "impact": { "statement": "Cobro incorrecto en checkout con cupón", "affected_components": ["cart-api", "checkout-ui"] },
  "unknowns": ["No se verificó el comportamiento con múltiples cupones"],

  "fix": {
    "status": "verified",              // proposed|applied|verified|rejected
    "branch": "exegezis/bug-812", "pr_url": "…",
    "files_changed": [ { "path": "api/src/cart/service.ts", "why": "Reordena removeItem antes de applyCoupon" } ],
    "risks": ["Otros callers de applyCoupon asumen el orden previo: se revisaron 2 de 2 callers"]
  },
  "verification": {
    "regression_test": "tests/exegezis/bug_812.spec.ts",
    "before_fix": "failed 10/10", "after_fix": "passed 10/10",
    "existing_suite": "passed 312/312", "typecheck": "passed", "lint": "passed"
  }
}
```

### 12.5 Test model

```text
TestCase
 ├── objective            (texto + criterio de éxito)
 ├── kind                 ui | api | integration | exploratory | regression | reproduction
 ├── origin               manual | generated | reproduction_of(bug_id) | imported
 ├── parameters           (dataset para parametrización)
 ├── preconditions        (fixtures, storageState, seed scripts)
 ├── steps[]              Action (adapter-agnostic: {adapter, type, target, input})
 ├── assertions[]         {kind: visible|text|http_status|response_json|console_clean|custom, target, expected}
 └── versions[]           TestVersion { compiled_spec (Playwright), source_hash, created_by }

TestResult (por ejecución)
 ├── status               passed | failed | flaky | error | skipped
 ├── observations[]  → artifacts[]
 └── duration, attempt, environment, commit
```

La representación canónica es **nuestro modelo JSON**, y **Playwright spec es un "compile target"**. Así los tests se pueden ejecutar en la CI del cliente sin EXEGEZIS. Esto es importante para la adopción: no hay lock-in, el cliente se queda con los tests.

---

## 13. Security model

### 13.1 Niveles de acción

| Nivel | Ejemplos | Default |
|---|---|---|
| `READ` | Leer código, logs, DOM y network. Ejecutar tests existentes en sandbox | Automático |
| `SAFE_WRITE` | Crear branch `exegezis/*`, escribir tests en `tests/exegezis/`, generar reportes | Automático, configurable por proyecto |
| `DESTRUCTIVE_WRITE` | Modificar código de producción (aunque sea en un branch), borrar archivos, tocar la DB, ejecutar migraciones | **Aprobación humana** por acción |
| `PRODUCTION` | Cualquier acción contra un entorno marcado `production` | **Deshabilitado en el MVP.** Más adelante: solo lectura, con allowlist y doble aprobación |

Nota importante: **en el MVP, EXEGEZIS nunca hace push a un branch que no sea suyo ni hace merge.** Abre PRs y el humano mergea.

### 13.2 Controles

- **Multi-tenancy:** `org_id` en todas las tablas + **Row-Level Security de Postgres** como segunda barrera, además del filtrado en la aplicación.
- **RBAC:** roles `owner`, `admin`, `member` y `viewer` por organización, con overrides por proyecto. Las aprobaciones de `DESTRUCTIVE_WRITE` requieren rol ≥ `member` con permiso explícito.
- **Policy engine:** una función pura `evaluate(action, context) → allow | deny | require_approval`, versionada, con tests. Políticas como datos (JSON), no como código arbitrario. Evaluar OPA/Cedar solo si la complejidad lo exige.
- **Secretos:** nunca en la DB en claro. Envelope encryption (KMS) o un vault externo. **El LLM nunca ve secretos**: las credenciales se inyectan en el adapter por referencia (`credentials_ref`) y se redactan en logs y artefactos.
- **Redacción:** un filtro de PII y secretos (tokens, emails, tarjetas) sobre los artefactos **antes** de enviarlos al LLM y antes de persistirlos si el cliente lo configura.
- **Sandboxing:** cada run en un worker efímero. Contenedores en dev. En el SaaS, **microVM** (Firecracker vía un proveedor como Fly Machines, E2B o Modal, o gVisor), porque ejecutar `npm install` de un cliente en un contenedor compartido no es aceptable.
- **Red:** egress deny-by-default. Allowlist por entorno (el dominio de la app, el registry de paquetes y el proveedor LLM a través del gateway).
- **Comandos:** allowlist por proyecto (`npm test`, `pnpm lint`, `tsc --noEmit`…). Todo lo demás pasa por aprobación.
- **Credenciales de Git:** GitHub App con permisos mínimos y tokens de instalación de corta vida, con scope al repo.
- **Artefactos:** prefijo por org en storage, URLs firmadas de corta duración y cifrado en reposo.
- **Auditoría:** `AuditLog` append-only con quién/qué/cuándo/por qué para toda acción ≥ `SAFE_WRITE`, toda aprobación y todo acceso a secretos.
- **Rollback:** los cambios de código solo existen en branches, así que el rollback es trivial. Nada de DB ni infraestructura en el MVP.
- **Rate limits y presupuestos** por org, proyecto y run.
- **Self-hosted runner:** para clientes que no quieren que su código salga de su red. Arquitectónicamente es gratis gracias al modelo pull-based.

---

## 14. MVP exacto

### 14.1 Demo que el MVP debe lograr

> Dado **(a)** una URL de staging, **(b)** un repo en GitHub y **(c)** un síntoma en lenguaje natural o un issue, EXEGEZIS:
> 1. **reproduce** el problema y lo compila a un test Playwright que falla N/N veces;
> 2. **explica** la causa raíz con una cadena de evidencia navegable (o dice INSUFFICIENT EVIDENCE);
> 3. **propone un fix** en un branch;
> 4. **demuestra** que el test de reproducción ahora pasa y que la suite existente sigue verde;
> 5. **abre un PR** con la explicación (qué cambió, por qué, qué bug arregla, qué test lo demuestra y qué riesgos tiene).

Además, en modo secundario: **exploración acotada**. Dado un objetivo ("prueba el flujo de checkout"), EXEGEZIS explora y, si detecta anomalías deterministas (5xx, excepciones, errores de consola o asserts violados), entra al mismo pipeline. Esto cubre tu escenario de "bug que un test convencional no detectó" sin depender de él.

### 14.2 Dentro del MVP

- BrowserAdapter (Playwright/Chromium) + CodeAdapter (repo local o clonado en sandbox).
- Tester (reproducir y explorar de forma acotada), Investigator (claims y evidencia) y Developer (fix y verificación), como fases de un run.
- Compilación a spec de Playwright, reproducción N veces y reproduction rate.
- Evidence bundle: trace de Playwright, HAR/network, consola, screenshots y grafo de claims.
- Bug report JSON y Markdown.
- Git: branch, commit y PR en GitHub (GitHub App o token en la fase 0).
- Aprobación humana antes de aplicar cambios fuera de `tests/`.
- UI mínima: lista de runs, vista de run (timeline + evidencia + causa raíz + verificación) y vista de bug.
- Un proveedor LLM con interfaz agnóstica (un segundo proveedor como prueba de que la abstracción funciona).
- Suite de evaluación (benchmark) con al menos 20 bugs sembrados en apps de ejemplo más bugs reales de repos OSS.

---

## 15. Features excluidas del MVP

Explícitamente **fuera**:
- Mobile, desktop, VS Code, Office, plugins y CLI como targets.
- Firefox y WebKit (solo Chromium).
- Exploración autónoma abierta ("encuentra todos los bugs de mi app").
- Acceso a producción de cualquier tipo.
- Acceso a la base de datos del cliente y a logs de servidor vía integraciones (Datadog, CloudWatch). En el MVP solo se aceptan logs provistos en un archivo o comando.
- GitLab y Bitbucket.
- Multi-agent real (agentes conversando entre sí).
- Billing, planes y usage metering visible (se mide internamente y no se cobra por UI).
- SSO/SAML, on-prem y VPC deployment.
- Self-healing de tests existentes.
- Testing visual y de performance.
- Resolución de MFA o CAPTCHA (**nunca**).
- Memoria semántica sofisticada: en el MVP la memoria es relacional (componentes, bugs pasados, falsos positivos marcados).
- Kubernetes.

---

## 16. Tech stack recomendado

| Capa | Elección | Razón | Alternativa descartada |
|---|---|---|---|
| Lenguaje | **TypeScript en todo** | Playwright es nativo en Node; un solo lenguaje entre UI, API y worker; tipos compartidos (Zod) | Python/FastAPI: mejor ecosistema ML, pero no entrenamos modelos. Dos lenguajes duplicarían tipos y tooling |
| Monorepo | **pnpm workspaces** (+ Turborepo si hace falta) | Simple | Nx: demasiado |
| Frontend | **Next.js (App Router) + React + Tailwind + shadcn/ui** | Estándar y rápido | — |
| API | **Fastify** o **Hono** | Ligero, tipado y rápido. Separado de Next para no acoplar el backend al frontend | tRPC-only: acopla. NestJS: pesado |
| Validación | **Zod** (→ JSON Schema para tool calls) | Una sola fuente para tipos, validación y esquemas LLM | — |
| DB | **PostgreSQL 16+ + pgvector** | Una sola base de datos para todo lo estructurado | DB vectorial separada: innecesaria |
| ORM / migraciones | **Drizzle** | SQL explícito, buen soporte de tipos y RLS | Prisma: más magia y peor con RLS |
| Cola | **pg-boss** o **graphile-worker** (Postgres) | Cero infraestructura extra | Redis/BullMQ: añade un componente. Kafka: absurdo para esta etapa |
| Storage | **S3-compatible**: MinIO en local, Cloudflare R2 o S3 en cloud | Estándar | — |
| Browser | **Playwright** (+ CDPSession) | Ver 11.3 | — |
| Sandbox | Docker (fase 0–1) → microVM gestionada (fase 2) | Progresivo | Kubernetes: no hasta tener la necesidad |
| LLM | **Interfaz propia delgada** (`ModelGateway`): `generateStructured(schema, messages, tools)` | Agnóstica, con cache, presupuesto y trazabilidad | LangChain: demasiada abstracción y difícil de depurar. Vercel AI SDK: aceptable como implementación interna del gateway |
| Observabilidad propia | **OpenTelemetry** + logs estructurados (pino) | Estándar | — |
| Auth | **Better Auth** o Auth.js, con GitHub OAuth | Los usuarios son developers | Auth0: caro al inicio |
| Tests propios | Vitest + Playwright | — | — |
| Deploy | Fly.io o Railway (control plane) + máquinas efímeras (workers) | Simple | AWS completo: más adelante, con los clientes enterprise |

---

## 17. Roadmap de 12 meses

Las fases 0–3 caben en 12 meses. Las fases 4 y 5 son de los meses 12 a 24 y aquí solo se esbozan: comprometerse hoy con fechas para ellas sería autoengaño.

### Fase 0 — Prototype (semanas 0–6)
- **Features:** CLI local `exegezis repro --url --repo --symptom`. Reproducción → spec Playwright → N ejecuciones → evidence bundle en disco → investigación → fix en branch local → verificación. Sin UI, sin DB (JSON en disco) y sin multi-tenancy.
- **Arquitectura:** paquetes `core` (modelos Zod), `adapters/browser`, `adapters/code`, `agents`, `model-gateway` y `cli`.
- **Benchmark:** 2–3 apps de ejemplo con 20 o más bugs sembrados que los tests existentes no detectan (race conditions, timezone, redondeo, estado stale, validación de servidor, etc.).
- **Riesgos:** la tasa de reproducción resulta baja.
- **Success criteria:** ≥60% de reproducción verificada, ≥40% de causa raíz VALIDATED correcta y 0 afirmaciones VALIDATED falsas en el benchmark. Coste medio de menos de $2 por bug ⚠️ (depende del modelo).
- **En paralelo:** 20 entrevistas con el ICP. **Esto no es opcional.**

### Fase 1 — MVP (semanas 6–16)
- **Features:** control plane (Postgres, API, UI mínima), worker en Docker, GitHub App (issues como entrada y PRs como salida), aprobaciones y audit log, self-hosted runner (Docker image).
- **Dependencias:** fase 0 con métricas aceptables.
- **Riesgos:** setup de auth y datos en las apps de los clientes.
- **Milestone:** el primer PR generado por EXEGEZIS mergeado en un repo que no sea nuestro.
- **Success:** 3–5 design partners activos que ejecutan al menos 1 investigación por semana.

### Fase 2 — Early customers (meses 4–8)
- **Features:** wedge 2 (triage de fallos de CI en E2E), ApiAdapter, integración con Sentry como fuente de síntomas, memoria por aplicación (componentes, bugs pasados, falsos positivos), sandbox microVM para el SaaS y billing básico.
- **Riesgos:** soporte manual que no escala, coste por investigación.
- **Success:** 10 clientes pagando, retención >80% mes a mes, "tiempo ahorrado por bug" medido y superior a 2 h.

### Fase 3 — Multi-agent system (meses 8–12)
- **Features:** agentes como procesos independientes con contratos tipados, investigación paralela de hipótesis, exploración autónoma más amplia (PR verification sobre preview deploys) y evaluación de durable execution (Temporal/Restate).
- **Success:** verificación de PRs en uso activo por ≥5 clientes. Tasa de falsos positivos <10% de los bugs reportados.

### Fase 4 — Multi-platform adapters (meses 12–18, tentativo)
- CliAdapter, Electron/VS Code, integraciones de logs de servidor (Datadog/CloudWatch) y GitLab.

### Fase 5 — Autonomous engineering workflows (meses 18+, tentativo)
- Verificación continua: cada PR, incluidos los escritos por agentes, pasa por EXEGEZIS. Integración como "verifier" de coding agents (Copilot, Cursor, Devin) vía MCP o API. **Aquí se materializa la categoría "verification layer".**

---

## 18. Cost drivers

| Driver | Orden de magnitud por investigación ⚠️ | Palanca |
|---|---|---|
| **Tokens LLM** | El mayor coste variable. 50–300k tokens por investigación compleja | ARIA snapshots, diffs, caching, model routing, presupuesto |
| **Compute del navegador** | Minutos de Chromium × N reproducciones | Paralelizar y reutilizar el browser context |
| **Build y tests del repo del cliente** | Puede dominar (`npm install` + build + suite) | Cache de dependencias por lockfile hash, ejecutar solo los tests afectados, runner del cliente |
| **Storage de artefactos** | Traces y videos pesan (MB por run) | Retención por plan, videos solo en fallos |
| **Sandboxes microVM** | Coste por segundo | Solo cuando el runner no es del cliente |
| **Humano (soporte y onboarding)** | Oculto pero enorme al inicio | Productizar el setup (`exegezis init`) |

**Consecuencia de precio:** no cobrar por tokens al cliente (es opaco y genera ansiedad), sino por **investigaciones** o **verified bugs**, con límites justos.

---

## 19. Métricas de éxito

**Calidad (North Star técnico):**
- **Verified Reproduction Rate:** % de síntomas que terminan en una reproducción verificada.
- **Root Cause Precision:** % de causas VALIDATED que un humano confirma como correctas. **Debe ser >95%.** Es la métrica de confianza.
- **False Positive Rate:** bugs reportados que el humano marca como "no es bug".
- **Honest Unknown Rate:** % de casos donde decimos INSUFFICIENT EVIDENCE. No es malo: mide la honestidad del sistema.
- **Fix Acceptance Rate:** PRs mergeados sobre PRs abiertos.
- **Verified Fix Rate:** fixes que pasan la reproducción y la suite completa.

**Negocio:**
- **North Star de producto:** *Verified Bugs cerrados por semana* (bugs con reproducción, causa y fix verificado).
- Tiempo ahorrado por bug (reportado por el cliente y comparado con la línea base).
- Activación: % de proyectos que completan su primera investigación en <1 día desde el signup.
- Retención semanal y NRR.
- Coste por investigación frente al precio por investigación (margen bruto >60%).

---

## 20. Estrategia de lanzamiento

1. **Design partners (fase 0–1):** 5–10 equipos del ICP con pilotos pagados simbólicos (o gratis a cambio de feedback semanal y un caso de estudio). Aportan bugs reales, que es la mejor fuente del benchmark.
2. **Open source estratégico:** publicar como OSS el **formato de evidencia y el CLI de reproducción** (`exegezis repro` en local con tu propia API key). Ese es el funnel de developers. El SaaS vende colaboración, memoria, GitHub App, runners gestionados, gobernanza y aprobaciones. Riesgo: canibalización. Mitigación: el valor del equipo está en el control plane.
3. **Contenido técnico con evidencia:** "Reprodujimos y arreglamos N bugs reales en proyectos open source" con PRs públicos enviados a esos proyectos. Es marketing verificable y encaja con la marca.
4. **Distribución:** GitHub Marketplace, comunidad Playwright y, más adelante, MCP server para que los coding agents llamen a EXEGEZIS como verificador.
5. **Lanzamiento público** (Show HN / Product Hunt) solo cuando la Root Cause Precision sea >95% en usuarios reales. Un lanzamiento con falsos positivos quema la marca.

---

## 21. Posicionamiento

- **Categoría:** AI Software Verification.
- **One-liner:** *EXEGEZIS reproduces bugs, explains why they happen, and proves the fix works.*
- **Tagline:** *Software that explains itself.*
- **Para** equipos de producto que pierden días convirtiendo reportes de bugs en causas demostradas, **EXEGEZIS** es una plataforma de verificación que **reproduce, explica y demuestra**. **A diferencia de** las herramientas de AI testing (que generan tests) y de los coding agents (que generan código), **EXEGEZIS produce evidencia**: cada conclusión está respaldada por una reproducción ejecutable, y cuando no sabe algo, lo dice.
- **Mensaje para la era de los agentes:** *"Your agents write the code. EXEGEZIS proves it works — and explains when it doesn't."*

---

## 22. Tres wedges iniciales

### Wedge A — "Symptom → Verified Reproduction" (bug report a reproducción verificada)
- **Entrada:** un issue de GitHub, ticket o descripción + URL de staging + repo.
- **Salida:** test Playwright que reproduce + causa raíz con evidencia + fix + verificación.
- **Pros:** alto valor por evento; contiene el loop completo; es la identidad de la marca; el output (test + PR) es tangible y comprobable; bajo solapamiento con competidores.
- **Contras:** la frecuencia por equipo es moderada (algunos bugs por semana); requiere acceso a staging + repo; la tasa de reproducción es incierta.

### Wedge B — "CI E2E Failure Triage" (triage de fallos de tests E2E en CI)
- **Entrada:** un test Playwright que falla en CI (trace.zip + commit).
- **Salida:** clasificación (bug real / flaky / test roto / entorno) + causa + fix del test o del código.
- **Pros:** dolor diario; los datos ya existen (traces); permisos mínimos (read-only); fácil de medir; distribución vía GitHub Action.
- **Contras:** más competido (Currents, Trunk, BuildPulse, Datadog CI, healers de Playwright ⚠️); valor por evento menor; tiende a "arreglar el test" más que a "entender el software".

### Wedge C — "PR Behavioral Verification" (verificación de comportamiento en PRs)
- **Entrada:** un PR + preview deploy.
- **Salida:** el agente explora los flujos afectados por el diff y reporta regresiones verificadas con reproducción.
- **Pros:** encaja perfecto con la narrativa "verification layer para código escrito por agentes"; alta frecuencia; es la visión a largo plazo.
- **Contras:** es el más difícil técnicamente (mapear diff → flujos, exploración, falsos positivos); requiere preview deploys; compite con Meticulous, QA Wolf y los AI testing agents.

---

## 23. Recomendación: qué investigar primero

**Investigar primero el Wedge A (Symptom → Verified Reproduction), usando el B como canal de adquisición de bajo esfuerzo en la fase 2 y el C como la visión a la que se llega.**

Razones:
1. **Construye el motor que los tres comparten.** B es A con el síntoma ya dado por un test que falla. C es exploración más A. Si A funciona, B y C son extensiones. Lo inverso no se cumple.
2. **Es donde la marca es verdad.** "Explains itself" significa causa raíz con evidencia. B tiende a quedarse en clasificación y C tiende a quedarse en detección.
3. **Es el menos competido** en su forma completa: reproducción ejecutable + causa validada + fix verificado.
4. **Es medible sin clientes.** Con un benchmark de bugs sembrados y bugs reales de OSS podemos saber **en 6 semanas** si la tecnología funciona, antes de gastar en go-to-market.
5. **El riesgo principal está claro y se puede probar barato:** la tasa de reproducción. Si en la fase 0 no pasamos del 60% en el benchmark, pivotamos hacia B, donde la reproducción ya viene dada por el test que falla.

**Criterio de kill/pivot explícito (semana 6):**
- Reproducción verificada <40% en el benchmark → pivot a B.
- Menos de 3 de 20 entrevistados dispuestos a hacer un piloto con su staging y su repo → el problema de acceso es mayor que el de tecnología: repensar el ICP o pasar a self-hosted primero.

---

## Supuestos declarados

- Equipo inicial pequeño (1–3 técnicos). Por eso: TypeScript único, monolito modular y Postgres para todo.
- Mercado inicial global y en inglés (producto y documentación), aunque trabajemos en español.
- Presupuesto limitado: sin Kubernetes, sin Kafka y sin proveedores enterprise al inicio.
- Acceso a APIs de LLM de frontera, con la abstracción para cambiar de proveedor.

## Preguntas abiertas (no bloquean el siguiente paso)

1. ¿Cuántas personas técnicas hay hoy en el equipo y con qué stack tienen más experiencia?
2. ¿Tienes acceso a 5–10 equipos del ICP para entrevistas y pilotos? ¿Qué mercado (LatAm, US, España)?
3. ¿Hay un plan de levantamiento de capital o es bootstrapped? Cambia la agresividad del roadmap.

---

## Siguiente paso propuesto (Fase 0, iteración 1)

Crear el esqueleto del monorepo y **una sola capacidad vertical**:

1. `packages/core`: modelos Zod de `Action`, `Observation`, `Artifact`, `Claim`, `EvidenceLink` y `BugReport`.
2. `packages/adapter-browser`: sesión Playwright con tracing, captura de consola y network, `observe()` con ARIA snapshot y `act()` tipado.
3. `examples/buggy-shop`: una app pequeña con 3 bugs sembrados que su suite de tests no detecta.
4. `packages/cli`: `exegezis observe --url` para comprobar end-to-end que capturamos evidencia correctamente, **antes de meter ningún LLM**.

El LLM entra en la iteración 2. Primero la evidencia, después la inteligencia.
