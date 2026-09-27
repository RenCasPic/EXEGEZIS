# 10 — Búsquedas en un sitio (propuesta)

Estado: **propuesta, pendiente de aprobación**. No hay código todavía.

## Qué es

Una **búsqueda** es una pregunta libre sobre un sitio, escrita como la haría una persona, sobre cualquier tema:
- «¿Qué dice el sitio sobre la medicina, directa o indirectamente?»
- «¿Dónde se mencionan precios, horarios o direcciones?»
- «¿Hay fechas de eventos que ya pasaron?»
- «¿Coinciden los datos de contacto en todas las páginas?»

Tiene dos modos:
- **Encontrar:** localiza los pasajes relevantes y los resume.
- **Revisar:** además evalúa si lo que dicen es correcto o coherente, con fuentes.

No hay categorías fijas: lo que se busca y cómo se agrupa sale de la pregunta.

## Lo que se demuestra y lo que es opinión de la IA

Se mantiene el principio de EXEGEZIS: no afirmar nada sin evidencia.

| Parte | Quién lo decide | Cómo se garantiza |
|---|---|---|
| El texto de cada página y dónde está (URL, selector, captura) | Motor determinista | Se extrae del DOM en navegador real, igual que las inspecciones |
| Qué pasajes responden a la pregunta | IA | Cada cita debe existir **literalmente** en el texto extraído; si no, se descarta (anti-invención) |
| Resumen de la respuesta | IA | Cada frase del resumen remite a pasajes concretos; sin pasaje, no hay frase |
| Si una afirmación es correcta (modo Revisar) | IA, rotulado **«evaluación de la IA, no verificada»** | Solo cita fuentes que vengan de la búsqueda web o de las fuentes que des tú; una URL que no esté ahí se descarta |
| La decisión final | Tú | Cada pasaje se puede marcar «correcto», «incorrecto» o «revisado», y esa marca se guarda |

Nada de una búsqueda sale como VERIFIED. La evaluación distingue hechos comprobables, opiniones o testimonios, instrucciones o consejos y datos (precios, fechas, contactos). Lo hace según lo que diga cada pasaje, sin esquemas preestablecidos por tema. Los resultados posibles son: **coincide con las fuentes**, **las contradice**, **no hay fuente que lo respalde** o **no se puede comprobar**.

## Cómo funciona

1. **Recorrido de solo lectura.** Usa el mismo motor que las inspecciones: la misma seguridad, los accesos guardados, robots.txt y el presupuesto de páginas y profundidad. Basta una pasada; el contenido no necesita repeticiones.
2. **Extracción determinista.** El texto visible de cada página se guarda en bloques (título, párrafo, lista, tabla), cada uno con su selector y su captura.
3. **Lectura con IA.** Por cada página, el modelo recibe la pregunta y los bloques, y devuelve los bloques relevantes con la cita exacta y el motivo. El motor valida cada cita.
4. **Modo Revisar.** Para cada afirmación encontrada, el modelo busca fuentes (la búsqueda web de la API de Anthropic, o solo tus fuentes si así lo pides) y emite su evaluación con citas.
5. **Resumen.** Una respuesta corta a la pregunta, con enlaces a los pasajes.

**Proveniencia.** El informe guarda el modelo, la versión del prompt, las respuestas del modelo (con los secretos redactados) y los resultados de la búsqueda web. Al cargarlo, se comprueba de nuevo que cada cita y cada fuente existen en lo guardado: si no cuadran, no carga.

**Coste y privacidad.**
- Antes de lanzar se muestra el coste estimado: unas llamadas por página, según el texto.
- El texto de las páginas se envía a Anthropic, y la interfaz lo dice.
- Con una sesión guardada (páginas privadas), hace falta una confirmación explícita en cada búsqueda.

## Interfaz

- **Nueva sección «Búsquedas»** en la barra lateral, junto a Inspecciones. La lista muestra la pregunta, el sitio, la fecha, el número de pasajes, el modo y el estado.
- **Nueva búsqueda:** sitio, pregunta, modo (Encontrar o Revisar), fuentes propias opcionales (URLs o texto) y opciones avanzadas (páginas y profundidad). También hay un acceso desde la home: bajo la URL, un campo opcional «¿Qué quieres buscar en el sitio?».
- **Detalle:**
  - la respuesta resumida arriba;
  - los pasajes agrupados por página, con la cita resaltada, la captura y el enlace;
  - en el modo Revisar, la evaluación con sus fuentes y un rótulo visible de que no está verificada;
  - filtros por página, por evaluación y por marca humana;
  - las marcas «correcto / incorrecto / revisado», que se guardan.
- **Repetir** la misma búsqueda más adelante muestra qué pasajes aparecieron, cambiaron o desaparecieron.

## CLI

`exegezis search --url <sitio> --query "<pregunta>" [--review] [--source <url>]... [--max-pages N] [--max-depth N]`

Escribe en `runs/searches/<id>/search-report.json`. Necesita la clave de Anthropic, igual que `ai-verify`.

## Pruebas

- **Un sitio de prueba con contenido conocido:** afirmaciones directas e indirectas, datos contradictorios entre páginas y una fecha caducada.
- **Respuestas grabadas del modelo** (planner mock) para que los tests sean deterministas. Deben comprobar:
  - que una cita inventada se descarta;
  - que una fuente que no salió de la búsqueda se descarta;
  - que un pasaje real se encuentra aunque no use las palabras de la pregunta;
  - que un informe manipulado no carga.
- **Una prueba real contra un sitio de René**, con una pregunta suya.

## Fuera de alcance (por ahora)

Corregir el sitio, buscar en varios sitios a la vez, programar búsquedas periódicas y PDFs o documentos enlazados. Esto último se puede añadir después.

## Decisiones pendientes (⚠️)

1. **Fuentes del modo Revisar:** ¿se permite la búsqueda web de la API (más cara, con fuentes reales citadas), solo tus fuentes, o ambas con tu elección en cada búsqueda?
2. **Marcas humanas** («correcto / incorrecto / revisado»): ¿se guardan en el informe de la búsqueda (propuesto) o en otro sitio?
3. **Orden:** ¿termino primero lo que queda de Accesos (el aviso en el detalle, Ajustes > Accesos, los tests de la web y la prueba en `/prayer`) y después implemento las Búsquedas (propuesto)?
