# 08 — Sistema de diseño de la UI

Estado: implementado en `apps/web` (tokens en `src/app/globals.css`, componentes en `src/components/ui/status.tsx`).

## Principios

- La UI solo muestra lo que existe en los artefactos. Lo que el motor no hace aún se muestra **NOT IMPLEMENTED**.
- **El azul petróleo es solo para acciones**: botones, enlaces y foco. Nunca comunica un estado.
- **Cada veredicto lleva color + icono + texto.** El color nunca es la única señal.
- Los componentes usan solo tokens. Un test (`test/design-system.test.tsx`) rechaza colores hex sueltos y clases de paleta en `src/`.

## Temas

- `html[data-theme="light" | "dark"]`. La preferencia (Claro / Oscuro / Sistema, por defecto Sistema) se guarda en `localStorage` (`exegezis-theme`) dentro de `try/catch`.
- Un script inline en `<head>` aplica el tema antes de pintar, sin parpadeo. Si el almacenamiento no está disponible, sigue `prefers-color-scheme`.
- Sin JavaScript no hay atributo, y un bloque `@media (prefers-color-scheme: dark)` aplica los mismos tokens oscuros. Un test comprueba que los dos bloques oscuros son idénticos.
- Selector en la barra superior. En escritorio es un control segmentado; en móvil, un botón de icono de 44 px con `aria-label` que rota entre las tres opciones.

## Tokens — esquema «Petróleo»

### Por qué cambió

La paleta anterior (fondo marfil cálido #F6F6F3, bordes #E4E2DA, texto casi negro y azul #2563EB) se parecía demasiado a la de Claude. «Petróleo» le da a EXEGEZIS identidad propia: neutros fríos gris azulado y un azul petróleo (#0E7490) para las acciones. Los colores de veredicto (ok, warn, q, off, bad) no cambian.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| bg | #F2F5F6 | #081216 | fondo de página |
| panel | #FFFFFF | #0F1C22 | paneles, tarjetas, tablas, modales, menús |
| sunken | #F2F5F6 | #0B171C | código, zonas hundidas |
| field | #FFFFFF | #0B171C | campos de formulario |
| panel-border | #C7D3D8 | #2A4550 | contorno de paneles, tarjetas, tablas, modales y menús (2 px) |
| panel-shadow | 0 1px 2px rgba(11,27,34,0.06) | none | sombra de esos mismos contornos |
| line | #E1E8EB | #1B2D35 | divisiones internas (filas, separadores), 1 px |
| line-soft | #E9EFF1 | #15252C | separadores suaves |
| line-strong | #B4C3C9 | #34535E | borde de los campos de formulario y botones secundarios |
| hover | #E9EFF1 | #15252C | fila o elemento bajo el puntero (*) |
| fg | #0B1B22 | #E3EEF1 | texto |
| muted | #4D6069 | #8FA7B0 | texto secundario |
| faint | #56696F | #7F979F | metadatos (*) |
| accent | #0E7490 | #0E7490 | fondo de botones |
| accent-hover | #0B5F76 | #0B6A83 | botón bajo el puntero |
| accent-text | #0E6682 | #5CC8E0 | enlaces y anillo de foco |
| on-accent | #FFFFFF | #FFFFFF | texto sobre accent |
| off-bg / off-bd | #EEF2F3 / #D6DEE1 | off al 10 % / off al 25 % (sin cambios) | pastillas NOT VERIFIED, REFUTED |
| empty | #DCE4E7 | #22262F | segmentos vacíos del medidor de evidencia |
| stripe | #E3EAED | #1B2D35 | rayado de la etiqueta REPLAY |
| ok | #15803D sobre #EDF7F0 | #3DDC97 sobre ok al 12 % | VERIFIED, VALIDATED |
| warn | #B45309 sobre #FCF1E3 | #F5B544 sobre warn al 12 % | CANDIDATE, SUFFICIENT, INTERMITTENT, FLAKY |
| q | #475569 sobre #EEF1F4 | #AAB4C3 sobre q al 12 % | INCONCLUSIVE, INSUFFICIENT, sin ejecutar, en curso |
| off | #5F6672 | #8A93A2 | NOT VERIFIED, REFUTED |
| bad | #B91C1C sobre #FCEBEA | #F97366 sobre bad al 12 % | FALSE VALIDATION, INVALID PLAN, errores del motor |

(*) `hover` y `faint` no estaban en la tabla del esquema. Se eligieron dentro de la misma familia fría: `hover` es igual que `line-soft`, y `faint` está un paso por debajo de `muted`. Los dos cumplen AA (ver abajo).

Ningún token de la tabla propuesta tuvo que ajustarse: todos los pares de texto cumplen AA con los valores tal cual.

### Contornos

- Paneles, tarjetas, estadísticas, tablas (dentro de su panel), modales, la paleta de comandos y los menús desplegables usan la utilidad `panel-frame` de `globals.css`: `border: 2px solid var(--panel-border)` y `box-shadow: var(--panel-shadow)`. Es el único sitio donde se define ese contorno, sin colores sueltos en los componentes. El panel lateral (Sheet) usa el mismo token en su borde izquierdo.
- Las divisiones dentro de un panel (cabecera, filas de tabla, separadores) siguen siendo de 1 px con `line`, más suaves que el contorno.
- Los avisos de estado (bloqueo, error del motor, escrituras de la página) conservan su borde del color de su familia: son estados, no paneles.

### Desviaciones anteriores que siguen vigentes

1. **ok-bg claro: #EDF7F0 en lugar de #E7F4EC.** #15803D sobre #E7F4EC da 4.43:1, que no llega a AA en el texto de 10–11 px de las pastillas. Con #EDF7F0 da 4.58:1.
2. **«En curso» usa la familia `q` con un punto pulsante, no azul.** El azul petróleo queda reservado a las acciones.
3. **La severidad de una inspección no es una pastilla.** Se muestra como texto con un icono de forma (⇈ ↑ = ↓ i) y sin color de veredicto. Una severidad no es un veredicto, y pintarla de rojo la confundiría con un error del motor.

## Contraste (WCAG 2.1, texto normal: AA ≥ 4.5:1)

La tabla se calcula con la fórmula de luminancia relativa de WCAG 2.1. `test/contrast.test.ts` lee los valores de `globals.css` y falla si algún par baja de 4.5. También falla si queda algún resto del marfil o del azul anteriores, si el azul petróleo aparece en un color de veredicto o si cambia el contorno de `panel-frame`. Los fondos al 10–12 % se componen sobre `panel`.

| Par | Claro | Oscuro |
|---|---|---|
| fg / bg | 16.05 | 16.03 |
| fg / panel | 17.59 | 14.69 |
| muted / panel | 6.58 | 6.88 |
| muted / bg | 6.00 | 7.51 |
| muted / hover | 5.66 | 6.24 |
| faint / panel | 5.76 | 5.65 |
| faint / bg | 5.26 | 6.16 |
| accent-text / panel | 6.48 | 8.92 |
| accent-text / bg | 5.91 | 9.74 |
| on-accent / accent | 5.36 | 5.36 |
| on-accent / accent-hover | 7.21 | 6.17 |
| ok / ok-bg | 4.58 | 7.68 |
| ok / panel | 5.02 | 9.82 |
| warn / warn-bg | 4.50 | 7.61 |
| warn / panel | 5.02 | 9.57 |
| q / q-bg | 6.68 | 6.64 |
| off / off-bg | 5.13 | 4.87 |
| bad / bad-bg | 5.61 | 5.43 |
| bad / panel | 6.47 | 6.34 |

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

`docs/screenshots/`: la home, una inspección, una búsqueda y una investigación, en claro y en oscuro, a 1440 px y a 375 px (`<página>-<ancho>-<tema>.png`). Son capturas de página completa (hasta 3200 px de alto) hechas con Playwright a partir de datos reales de `runs/`, con la interfaz en español. Se regeneran con:

```
node apps/web/scripts/screenshots.mjs
```

El script arranca su propio servidor (carpeta `.next-shots`, sin tocar un `pnpm web` en marcha) y comprueba además que ninguna página tenga scroll horizontal a 375 px en los dos temas (`scrollWidth − clientWidth = 0`). La prueba de idiomas (`test/i18n-e2e.test.ts`) hace la misma comprobación en inglés y en español.
