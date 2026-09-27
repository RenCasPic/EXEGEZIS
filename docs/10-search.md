# 10 — Búsquedas de contenido en un sitio (propuesta)

Estado: **aprobado por René (2026-09-27)** con las decisiones de la §7. Sustituye a la versión anterior (`10-searches.md`).

**Principios:**
- La IA propone y el motor determinista verifica.
- Ningún resultado se presenta con más certeza que su evidencia.
- «0 resultados» siempre dice dónde se miró.
- Lo que no existe se muestra como NOT IMPLEMENTED.

## 1. Arquitectura

**Nuevo paquete `@exegezis/search`.** Reutiliza, sin duplicarlos, el recorrido, los límites, robots, la política de solo lectura, los accesos guardados, la clasificación de bloqueos, los enlaces peligrosos, el recorder, la redacción y los jobs de la UI.

**Paso 0, refactor sin cambios de comportamiento.**
- Hoy el recorrido vive dentro de `inspectSite` como funciones internas. Se extrae a `packages/inspect/src/crawl.ts` como `crawlSite(options, visitor)`, con estas responsabilidades:
  - el BFS de la primera ejecución;
  - las repeticiones 2..N;
  - robots;
  - los enlaces peligrosos;
  - el rate limit;
  - los bloqueos;
  - ENGINE_ERROR;
  - la cobertura.
- `inspectSite` y `searchSite` lo usan con su propio *visitor*.
- Para comprobar que no cambia nada: los tests e2e de inspect idénticos, los benchmarks A 9/9 y B mock 7/7, y la misma inspección de inspect-lab antes y después.

**Extracción en el adaptador** (nuevo modo `extract`, junto a `inspect`), sobre la página ya renderizada, con su JavaScript ejecutado. Escribe `text-blocks.json`: una lista de bloques `{id, kind, text, selector, rect, visible, source}` donde:
- `kind` es `heading(1–6) | paragraph | list-item | button | link | cell | alt | title-attr | aria-label | meta-title | meta-description | og`;
- `visible` es `false` para el texto oculto (acordeones o pestañas cerrados, `display:none`, `hidden`, `aria-hidden`); se extrae solo con `--include-hidden`, activado por defecto, y se marca como **no visible**;
- `rect` sirve para marcar el bloque en la captura.

Los atributos y los metadatos no tienen `rect` y se muestran como «en atributo» o «en metadatos».

**CLI:**

`exegezis search --url <sitio> (--terms "a,b" | --meaning "<texto>" | --template <id>) [--variants] [--regex] [--max-pages] [--max-depth] [--runs 3] [--no-session] [--max-cost <USD>] [--model <id>]`

Salida en `runs/searches/<id>/search-report.json`.

## 2. Schemas (core, Zod)

- **`SearchQuery`**, uno de estos tres:
  - `exact {terms[], phrases[], excluded[], excludeScope: block|page (por defecto block), variants: bool (por defecto false), regex: string|null, suggestedTerms[] (aceptados por el usuario, con su origen)}`;
  - `meaning {description}`;
  - `template {id, version, exact?, meaning?}`.
- **`SearchObservation`** (en bruto, por página y ejecución): `{page, run, blockId, match, context, quote, verifiedQuote}`.
- **`SearchHit`**: `{id, page, blockId, selector, kind, visible, quote, contextBefore, contextAfter, matched (término o variante, con la raíz), occurrences[], verdict, reason?, relevance?, evidence, textFragmentUrl}`.
  - `verdict` es `VERIFIED` (N de N cargas), `INTERMITTENT` (solo en algunas cargas, se muestra aparte) o `SUGGESTED_QUOTE_VERIFIED` (por significado; nunca VERIFIED).
- **`SearchReport`**:
  - `query`, `options` y `tools` (extractor, `snowball-stemmers@0.6.0` y, en semántica, el modelo, la versión del prompt, los tokens, la latencia y el coste);
  - `coverage {found, visited, skipped: {budget, robots, blocked[], safety, engineError}}`;
  - `pages[]` (la misma `PageVisit` de las inspecciones), `observations[]`, `hits[]`;
  - `discarded {unverifiedQuotes: n}`, `excluded [{term, scope, blocks, pages, hits}]` y `summary`.
  - Al cargar se re-derivan los veredictos, los conteos, la cobertura y el resumen: si no cuadran, el informe no carga, igual que `InspectionReport`.

## 3. Normalización y variantes (búsqueda exacta, fase 1)

**Normalización**, que se aplica igual a la consulta y a la página:
- Unicode NFKD, sin diacríticos: á → a, ü → u. **Excepción: ñ se conserva**, porque «año» y «ano» no son lo mismo;
- minúsculas;
- comillas tipográficas convertidas en rectas;
- espacios unificados.

La coincidencia es por **palabra completa**: «cura» no coincide dentro de «curación».

**Operadores:**
- `"frase exacta"`;
- `-palabra` excluye **solo el bloque** de texto donde aparece (por defecto). La opción «excluir página entera» (`--exclude-scope page`) descarta la página. El informe muestra siempre cuántos resultados, bloques y páginas se excluyeron y por qué palabra: excluir nunca oculta resultados sin que se note;
- `--regex` es opcional y se aplica sobre el texto normalizado, con un límite de tiempo por página.

**Variantes (`--variants`, opcionales).** Raíz Snowball en español e inglés (`snowball-stemmers` 0.6.0, sin dependencias, licencia ISC), iterada hasta que deja de cambiar. Comprobado en este equipo:
- **unifica:** enfermedad, enfermedades, enfermo y enfermera → «enferm»; medicina y medicinas → «medicin»; curar, cura y curó → «cur»; medicine y medicines → «medicin»;
- **no unifica las derivadas:** curar ≠ curación y médico ≠ medicina. Esas hay que escribirlas como términos, o usar la búsqueda por significado;
- **da falsos positivos:** casa = caso («cas»), mesa = mes («mes»).

Por eso las variantes van desactivadas por defecto. Cada resultado encontrado solo por variante lleva la etiqueta «por variante (raíz «enferm»)», para que se vea por qué salió.

**«Sugerir términos relacionados» (fase 2).** Para las derivadas que la raíz no une, la IA propone términos de la misma familia o sinónimos (curar → curación, médico → medicina). El usuario marca cuáles usar y la búsqueda sigue siendo **exacta y determinista**: los términos aceptados se añaden como términos normales, con la etiqueta «término sugerido por IA, aceptado por ti». La IA no ve la página: solo recibe los términos. Hay estimación de coste antes, como en la búsqueda por significado, y se registran el modelo y los tokens.

**Veredicto.** Con N cargas (por defecto 3, en contextos limpios):
- **VERIFIED** si aparece en las N;
- **INTERMITTENT** si aparece solo en algunas (un carrusel, por ejemplo), y se muestra aparte.

Visible o no visible es un atributo del resultado, no un veredicto.

## 4. Búsqueda por significado (fase 2)

1. **Primera pasada sin IA:** recorrido y extracción. Da el texto exacto de cada página.
2. **Estimación de coste:** tokens contados con el endpoint `count_tokens` de la API (gratuito) o, sin conexión, estimados a 4 caracteres por token. Se multiplican por la tabla de precios del modelo, que queda en código con la fecha y la fuente de la página oficial de precios.
   - La UI muestra la estimación y pide confirmación si supera el límite: 1 USD por búsqueda por defecto, configurable en Ajustes y con `--max-cost`.
   - En el CLI, si se supera el límite se para antes de llamar al modelo y se dice cuánto costaría.
3. **Llamadas.** Se agrupan las páginas por lotes hasta llenar el contexto. El texto va redactado de secretos y datos personales con el mismo `redactText` del planner.
   - La salida es estructurada: `{blockId, quote, reason (una frase), relevance: high|medium|low}`.
   - Se registran el modelo, la versión del prompt, los tokens, la latencia y el coste real, como en `generation.json`.
4. **Verificación determinista de cada cita:** la cita normalizada tiene que ser una **subcadena** del texto normalizado (y redactado) del bloque indicado.
   - Si no lo es (inventada, deformada o de otro bloque), se descarta, se cuenta en `discarded.unverifiedQuotes` y **no se muestra**.
   - Las que sí aparecen salen como `SUGGESTED_QUOTE_VERIFIED`, con el aviso: «La cita es real; si es relevante, lo decides tú».
5. **Límite documentado:** la búsqueda por significado no es exhaustiva y puede tener falsos negativos. La cobertura dice qué páginas se enviaron al modelo.

## 5. Plantillas y funciones de la fase 3

**Plantillas.**
- Las del repositorio están versionadas en `packages/search/templates/*.json`, con id, versión, nombre, descripción y una parte exacta, una semántica o ambas:
  - afirmaciones de salud y promesas de curación (exacta + significado);
  - datos personales expuestos (emails y teléfonos por patrón, determinista);
  - fechas y eventos pasados (determinista, relativo a la fecha de la búsqueda, en español e inglés);
  - texto de relleno (lorem ipsum, «próximamente», TODO, TBD);
  - redes sociales y datos de contacto.
- Las del usuario se crean y editan en la UI y se guardan fuera de `runs/`, en `%LOCALAPPDATA%\EXEGEZIS\search\templates\`. Las plantillas deterministas **nunca** llaman a la IA, y hay un test que lo comprueba.

**Búsquedas guardadas.**
- La definición (sitio, consulta y opciones) se guarda en `%LOCALAPPDATA%\EXEGEZIS\search\saved.json` y se puede repetir.
- La vista **«Solo lo nuevo»** compara con la ejecución anterior por página + cita normalizada, y marca cada resultado como nuevo, igual o desaparecido.

**Revisión.**
- Cada resultado se marca como Relevante, No relevante o Pendiente, en `runs/searches/<id>/review.json`, aparte del informe, que no se modifica.
- Se puede filtrar por marca.

**Exportación.**
- **CSV:** UTF-8 con BOM (Excel en español lo abre con acentos), separador configurable (`;` por defecto, `,` opcional).
- **PDF:** la página de detalle impresa con Chromium (`page.pdf`), sin dependencias nuevas, con citas, enlaces y capturas.

**PDFs enlazados** (opcional, al final de la fase 3): solo si se puede sin una dependencia nativa. Si no, ⚠️ PARO y lo propongo.

## 6. Interfaz (en español, con el sistema de diseño)

**Home.** El campo principal tiene dos pestañas: **Inspeccionar | Buscar**. Buscar tiene:
- el tipo: Exacta, Por significado o Plantilla;
- el campo de términos (con ayuda para `"frase"` y `-excluir`) o de descripción;
- «Incluir variantes» y las opciones de siempre como chips;
- en semántica, la estimación de coste por número de páginas antes de lanzar, y la exacta tras la primera pasada.

**Navegación.** Nueva sección **«Búsquedas»** (lista + detalle) junto a Inspecciones.

**Detalle de una búsqueda:**
- **Cabecera de cobertura, siempre visible:** «Se revisaron X de Y páginas encontradas». Detalla el límite, los bloqueos (con el aviso de acceso de siempre), las exclusiones de robots y los enlaces omitidos por seguridad.
- **Agrupación** por página o por término/tema, con un conmutador.
- **Cada resultado:**
  - la cita con su contexto y la coincidencia resaltada;
  - la captura con el bloque marcado;
  - el tipo (Verificado, Sugerencia · cita verificada o Intermitente) con VerdictPill;
  - «no visible», «en atributo» o «por variante», si aplica;
  - el motivo, en semántica;
  - «Abrir en la página», con un enlace `#:~:text=` que lleva a la frase;
  - la marca de revisión.
- **Estado vacío honesto:** «0 coincidencias en X páginas revisadas», con la lista de páginas.

Con AA, temas claro y oscuro, y sin scroll horizontal a 375 px.

## 7. Plan por fases y paradas

1. **Fase 0:** el refactor `crawlSite`, sin cambios de comportamiento. `verify`, benchmarks, commit y push.
2. **Fase 1:** la extracción, la búsqueda exacta (normalización, operadores, variantes, N cargas), el esquema, el CLI, la sección Búsquedas y la pestaña Buscar.
   - Fixture con: acentos, mayúsculas, plurales, un acordeón oculto, atributos alt, un carrusel cambiante y una página de control.
   - ⚠️ **PARO con una demo para René.**
3. **Fase 2:** búsqueda por significado, verificación de citas, coste y límite (configurable en Ajustes), y el botón «Sugerir términos relacionados». Probada con un planner mock que devuelve una cita inventada y otra deformada. ⚠️ **PARO.**
4. **Fase 3:** plantillas, búsquedas guardadas, «solo lo nuevo», revisión, CSV y PDF. Prueba real en jesushealingministry.net y resultados en §8.

**Decisiones (aprobadas por René):**
1. La **ñ** se distingue de la n («año» ≠ «ano»).
2. Variantes **desactivadas por defecto**. Cada resultado por variante dice por qué salió. En la fase 2 se añade «Sugerir términos relacionados», y la búsqueda sigue siendo exacta.
3. Límite de coste de **1 USD** por búsqueda por significado, configurable en Ajustes.
4. `-palabra` excluye **solo el bloque** por defecto, con la opción «excluir página entera». El informe muestra siempre qué se excluyó y por qué palabra.
5. Primero se terminan los pendientes de Accesos (docs/09) y después empieza la fase 0.

## 8. Resultados

Fecha: 2026-09-27. Por decisión de René, las tres fases se implementaron seguidas, sin paradas intermedias.

**Prueba real en https://www.jesushealingministry.net/** (`--max-pages 10 --max-depth 1`):

| | Exacta | Por significado |
|---|---|---|
| Consulta | `medicina, médico, enfermedad, tratamiento, curar` | «cualquier mención a la medicina, directa o indirecta» |
| Cobertura | 10 de 94 páginas encontradas (83 fuera del límite, 1 excluida por robots.txt) | las mismas 10 páginas |
| Cargas por página | 3 | 1 |
| Resultados | **2 verificados** (3/3 cargas), 0 intermitentes | **46 sugerencias con cita verificada** en 7 páginas (24 de relevancia alta, 16 media, 6 baja; 5 en texto no visible) |
| Citas de la IA descartadas | — | 0 de 49 |
| IA | — | claude-sonnet-5 · 3 llamadas · 36.843 tokens de entrada y 5.024 de salida · **0,12 USD** (estimado antes: hasta 0,32; límite 1,00) · 43 s |

- **Exacta:** «médico» en un testimonio de la portada («…antes de ir al médico con mi hijo…») y «Enfermedad» en el título de un libro de `/books`.
  - La tercera carga no llegó a la última página: se agotó el límite de tiempo total (10 minutos), porque el sitio nunca deja de hacer peticiones (analítica) y cada carga espera a su límite. El estado es PARCIAL y así lo dice el informe. No afecta a ningún resultado: los dos están en 3 de 3 cargas.
- **Por significado:** encuentra lo que la exacta no puede, porque está escrito con otras palabras o en inglés («without medication», «the clinic», «asthma», «ear infection», «no need of any medicine», «alergia y la tos», «Physical healing»).
  - Solo 9 de las 46 citas contienen alguno de los cinco términos exactos.
  - Todas las citas son literales; cada resultado es una sugerencia para revisar, no un veredicto.
- **Lo que corrigió esta prueba** (commit `ab31528`): en el primer intento, la IA encontró tanto en el primer lote que su respuesta se cortó al llegar al límite de salida y ese lote se perdió (estado AI_ERROR, 16 resultados).
  - Ahora una respuesta cortada se divide en dos y se vuelve a pedir, siempre dentro del límite de coste.
  - Los bloques repetidos en todas las páginas (cabecera y pie; aquí 732) se envían una sola vez.
  - La repetición se hizo reutilizando las páginas ya leídas (`--reuse`), sin volver a visitar el sitio.

**Criterios de aceptación:**
- **Fase 1:** el fixture (`/search/*` en inspect-lab) cubre acentos, mayúsculas, plurales (solo con variantes), un acordeón cerrado, `display:none` y `aria-hidden` marcados como no visibles, alt/title/aria-label/meta/og, un carrusel INTERMITENTE y una página de control con 0 resultados.
  - Un informe manipulado no carga.
  - La cobertura cuadra.
  - Inspecciones sin cambios: mismos hallazgos antes y después del refactor; benchmark A 9/9 y B mock 7/7.
- **Fase 2:** un modelo simulado con una cita inventada y otra deformada: las dos se descartan y se cuentan. La estimación se muestra, y por encima del límite no se llama a la IA (código de salida 8); al aprobarla se reutilizan las páginas.
- **Fase 3:**
  - «Solo lo nuevo» funciona en el CLI y en la web.
  - El CSV lleva BOM, `;` y CRLF, y Excel lo abre con acentos.
  - El PDF se imprime con Chromium.
  - Las plantillas deterministas no llaman a la IA (test con un modelo que falla si se le llama).

**Desviaciones:**
- Modelo por defecto `claude-sonnet-5`, sin *thinking*, para acotar el coste de salida.
- Lotes de unos 45.000 caracteres y 8.000 tokens de salida por llamada.
- Los PDF enlazados desde las páginas no se leen (opcional, pendiente).
- El recorte de captura marca el bloque sobre la captura de página completa; el texto no visible dice «no aparece en la captura».

**Limitaciones:**
- La búsqueda por significado puede tener falsos negativos.
- Las variantes (Snowball) no unen palabras derivadas (curar/curación) y pueden unir palabras distintas (casa/caso).
- En sitios que no dejan de cargar, 3 cargas × 10 páginas se acercan al límite de 10 minutos: se puede subir con `--total-timeout`.
