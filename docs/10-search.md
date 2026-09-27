# 10 — Búsquedas de contenido en un sitio (propuesta)

Estado: **propuesta, pendiente de aprobación**. Sustituye a la versión anterior (`10-searches.md`).

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
  - `exact {terms[], phrases[], excluded[], variants: bool, regex: string|null}`;
  - `meaning {description}`;
  - `template {id, version, exact?, meaning?}`.
- **`SearchObservation`** (en bruto, por página y ejecución): `{page, run, blockId, match, context, quote, verifiedQuote}`.
- **`SearchHit`**: `{id, page, blockId, selector, kind, visible, quote, contextBefore, contextAfter, matched (término o variante, con la raíz), occurrences[], verdict, reason?, relevance?, evidence, textFragmentUrl}`.
  - `verdict` es `VERIFIED` (N de N cargas), `INTERMITTENT` (solo en algunas cargas, se muestra aparte) o `SUGGESTED_QUOTE_VERIFIED` (por significado; nunca VERIFIED).
- **`SearchReport`**:
  - `query`, `options` y `tools` (extractor, `snowball-stemmers@0.6.0` y, en semántica, el modelo, la versión del prompt, los tokens, la latencia y el coste);
  - `coverage {found, visited, skipped: {budget, robots, blocked[], safety, engineError}}`;
  - `pages[]` (la misma `PageVisit` de las inspecciones), `observations[]`, `hits[]`;
  - `discarded {unverifiedQuotes: n}` y `summary`.
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
- `-palabra` excluye las páginas o bloques que la contengan (a decidir en la §7, punto 4);
- `--regex` es opcional y se aplica sobre el texto normalizado, con un límite de tiempo por página.

**Variantes (`--variants`, opcionales).** Raíz Snowball en español e inglés (`snowball-stemmers` 0.6.0, sin dependencias, licencia ISC), iterada hasta que deja de cambiar. Comprobado en este equipo:
- **unifica:** enfermedad, enfermedades, enfermo y enfermera → «enferm»; medicina y medicinas → «medicin»; curar, cura y curó → «cur»; medicine y medicines → «medicin»;
- **no unifica las derivadas:** curar ≠ curación y médico ≠ medicina. Esas hay que escribirlas como términos, o usar la búsqueda por significado;
- **da falsos positivos:** casa = caso («cas»), mesa = mes («mes»).

Por eso las variantes van desactivadas por defecto. Cada resultado encontrado solo por variante lleva la etiqueta «por variante (raíz «enferm»)», para que se vea por qué salió.

**Veredicto.** Con N cargas (por defecto 3, en contextos limpios):
- **VERIFIED** si aparece en las N;
- **INTERMITTENT** si aparece solo en algunas (un carrusel, por ejemplo), y se muestra aparte.

Visible o no visible es un atributo del resultado, no un veredicto.

## 4. Búsqueda por significado (fase 2)

1. **Primera pasada sin IA:** recorrido y extracción. Da el texto exacto de cada página.
2. **Estimación de coste:** tokens contados con el endpoint `count_tokens` de la API (gratuito) o, sin conexión, estimados a 4 caracteres por token. Se multiplican por la tabla de precios del modelo, que queda en código con la fecha y la fuente de la página oficial de precios.
   - La UI muestra la estimación y pide confirmación si supera el límite (`--max-cost`, por defecto 1 USD).
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
3. **Fase 2:** búsqueda por significado, verificación de citas, coste y límite. Probada con un planner mock que devuelve una cita inventada y otra deformada. ⚠️ **PARO.**
4. **Fase 3:** plantillas, búsquedas guardadas, «solo lo nuevo», revisión, CSV y PDF. Prueba real en jesushealingministry.net y resultados en §8.

**Decisiones pendientes:**
1. ¿Conservar la **ñ** al normalizar? Propongo que sí.
2. ¿Variantes **desactivadas por defecto**, con su etiqueta? Propongo que sí.
3. ¿Límite de coste por defecto de 1 USD por búsqueda?
4. Con `-palabra`, ¿se excluye el **bloque** o la **página** entera? Propongo la página, que es lo que suele esperarse.
5. **Accesos:** quedan pendientes el aviso de bloqueo en el detalle de la inspección, Ajustes > Accesos, el aviso de sesión caducada en la home, los tests de la web y tu prueba en `/prayer`. ¿Los termino antes de la fase 0 (propuesto) o después?

## 8. Resultados

*(Se completa en la fase 3.)*
