# 08 — Sistema de diseño de la UI

Estado: implementado en `apps/web` (tokens en `src/app/globals.css`, componentes en `src/components/ui/status.tsx`).

## Principios

- La UI solo muestra lo que existe en los artefactos. Lo que el motor no hace aún se muestra **NOT IMPLEMENTED**.
- **El azul es solo para acciones**: botones, enlaces y foco. Nunca comunica un estado.
- **Cada veredicto lleva color + icono + texto.** El color nunca es la única señal.
- Los componentes usan solo tokens. Un test (`test/design-system.test.tsx`) rechaza colores hex sueltos y clases de paleta en `src/`.

## Temas

- `html[data-theme="light" | "dark"]`. La preferencia (Claro / Oscuro / Sistema, por defecto Sistema) se guarda en `localStorage` (`exegezis-theme`) dentro de `try/catch`.
- Un script inline en `<head>` aplica el tema antes de pintar, sin parpadeo. Si el almacenamiento no está disponible, sigue `prefers-color-scheme`.
- Sin JavaScript no hay atributo, y un bloque `@media (prefers-color-scheme: dark)` aplica los mismos tokens oscuros. Un test comprueba que los dos bloques oscuros son idénticos.
- Selector en la barra superior. En escritorio es un control segmentado; en móvil, un botón de icono de 44 px con `aria-label` que rota entre las tres opciones.

## Tokens

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| bg | #F6F6F3 | #0B0C0F | fondo de página |
| panel | #FFFFFF | #111318 | tarjetas y paneles |
| sunken | #F6F6F3 | #0E1015 | código, zonas hundidas |
| hover / line-soft | #EFEDE6 | #1B1F27 | fila activa, separadores suaves |
| line / line-strong | #E4E2DA / #D3D0C6 | #22262F / #30353F | bordes |
| fg / muted / faint | #15171C / #5B616D / #636A76 | #E7E9EE / #9097A4 / #858D9C | texto |
| accent / accent-hover | #2563EB / #1D4ED8 | #2563EB / #2F6BED | fondo de botones |
| accent-text | #1D4ED8 | #7AA7FF | enlaces y anillo de foco |
| on-accent | #FFFFFF | #FFFFFF | texto sobre accent |
| ok | #15803D sobre #EDF7F0 | #3DDC97 sobre ok al 12 % | VERIFIED, VALIDATED |
| warn | #B45309 sobre #FCF1E3 | #F5B544 sobre warn al 12 % | CANDIDATE, SUFFICIENT, INTERMITTENT, FLAKY |
| q | #475569 sobre #EEF1F4 | #AAB4C3 sobre q al 12 % | INCONCLUSIVE, INSUFFICIENT, sin ejecutar, en curso |
| off | #5F6672 sobre #F0F0ED | #8A93A2 sobre off al 10 % | NOT VERIFIED, REFUTED |
| bad | #B91C1C sobre #FCEBEA | #F97366 sobre bad al 12 % | FALSE VALIDATION, INVALID PLAN, errores del motor |

### Desviaciones respecto a la propuesta, y su motivo

1. **ok-bg claro: #EDF7F0 en lugar de #E7F4EC.** #15803D sobre #E7F4EC da 4.43:1, que no llega a AA en el texto de 10–11 px de las pastillas. Con #EDF7F0 da 4.58:1 y el texto conserva el color propuesto.
2. **accent-hover oscuro: #2F6BED en lugar de #3B74F0.** El blanco sobre #3B74F0 da 4.25:1; sobre #2F6BED da 4.72:1.
3. **`faint`** no estaba en la propuesta, pero la app lo usa para metadatos. Lo fijé en #636A76 (claro) y #858D9C (oscuro); los valores anteriores no llegaban a AA.
4. **«En curso» usa la familia `q` con un punto pulsante, no azul.** Antes era azul, pero el azul queda reservado a las acciones.
5. **La severidad de una inspección no es una pastilla.** Se muestra como texto con un icono de forma (⇈ ↑ = ↓ i) y sin color de veredicto. Una severidad no es un veredicto, y pintarla de rojo la confundiría con un error del motor.

## Contraste (WCAG 2.1, texto normal: AA ≥ 4.5:1)

La tabla se calcula con la fórmula de luminancia relativa de WCAG 2.1. `test/contrast.test.ts` lee los valores de `globals.css` y falla si algún par baja de 4.5. Los fondos al 12 % se componen sobre `panel`.

| Par | Claro | Oscuro |
|---|---|---|
| fg / bg | 16.56 | 16.10 |
| fg / panel | 17.93 | 15.30 |
| muted / panel | 6.22 | 6.33 |
| muted / bg | 5.75 | 6.66 |
| muted / hover | 5.31 | 5.62 |
| faint / panel | 5.45 | 5.56 |
| faint / bg | 5.03 | 5.86 |
| accent-text / panel | 6.70 | 7.79 |
| accent-text / bg | 6.19 | 8.19 |
| on-accent / accent | 5.17 | 5.17 |
| on-accent / accent-hover | 6.70 | 4.72 |
| ok / ok-bg | 4.58 | 8.43 |
| ok / panel | 5.02 | — |
| warn / warn-bg | 4.50 | 8.26 |
| warn / panel | 5.02 | — |
| q / q-bg | 6.68 | 7.23 |
| off / off-bg | 5.07 | 5.27 |
| bad / bad-bg | 5.61 | 5.77 |
| bad / panel | 6.47 | 6.79 |

Todos los pares cumplen AA.

## Tipografía

- Geist Sans para todo el texto.
- Geist Mono solo para IDs, código, URLs y cifras.
- Solo los nombres de veredicto van en mayúsculas, y siempre dentro de su pastilla. El resto de etiquetas (cabeceras de tabla, secciones, grupos) van en tipo oración.

## Componentes

- **StatusPill / VerdictPill.** Pastilla redondeada con el icono de su familia: ok ✓, warn △, q ?, off −, bad ⯃. `VerdictPill` deduce la familia del nombre del veredicto. Un veredicto desconocido cae en `q`, nunca en `ok`.
- **NotImplemented.** Contorno discontinuo, sin relleno.
- **ReplayTag.** Etiqueta de fondo rayado para resultados MOCK o REPLAY (respuestas grabadas del planner). Nunca se confunde con un resultado de IA en vivo.
- **EvidenceMeter.** 5 segmentos, NONE → REPRODUCED → SUFFICIENT → CANDIDATE → VALIDATED (el `EvidenceLevel` de core), con el nombre del nivel. Sin medición, muestra «—».
- **RunHistory.** Un punto por ejecución: ok relleno, q relleno, off solo contorno. Tiene un `aria-label` con el recuento.
- **SeverityLabel.** Icono de forma y texto, sin color de veredicto.

## Capturas

`docs/screenshots/`: `/`, `/inspections/[id]` y `/investigations/[id]` en claro y en oscuro, a 1440 px y a 375 px (`<página>-<ancho>-<tema>.png`). Son capturas de página completa hechas con Playwright a partir de datos reales de `runs/`. A 375 px ninguna página tiene scroll horizontal (`scrollWidth − clientWidth = 0`, medido en `/`, `/inspections`, `/investigations`, `/benchmarks`, `/verification/root-causes`, `/planner`, `/overview`, `/projects`, `/settings`, `/investigations/new` y la página de un job).
