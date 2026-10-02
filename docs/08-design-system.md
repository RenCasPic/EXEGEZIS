# 08 — Sistema de diseño de la UI

Estado: implementado en `apps/web` (tokens en `src/app/globals.css`, componentes en `src/components/ui/status.tsx`).

## Principios

- La UI solo muestra lo que existe en los artefactos. Lo que el motor no hace aún se muestra **NOT IMPLEMENTED**.
- **El color de acción (azul eléctrico en claro, lima en oscuro) es solo para acciones y para el contorno de los paneles**: botones, enlaces, foco y bordes de panel. Nunca comunica un estado.
- **Cada veredicto lleva color + icono + texto.** El color nunca es la única señal.
- Los componentes usan solo tokens. Un test (`test/design-system.test.tsx`) rechaza colores hex sueltos y clases de paleta en `src/`.

## Temas

- `html[data-theme="light" | "dark"]`. La preferencia (Claro / Oscuro / Sistema, por defecto Sistema) se guarda en `localStorage` (`exegezis-theme`) dentro de `try/catch`.
- Un script inline en `<head>` aplica el tema antes de pintar, sin parpadeo. Si el almacenamiento no está disponible, sigue `prefers-color-scheme`.
- Sin JavaScript no hay atributo, y un bloque `@media (prefers-color-scheme: dark)` aplica los mismos tokens oscuros. Un test comprueba que los dos bloques oscuros son idénticos.
- Selector en la barra superior. En escritorio es un control segmentado; en móvil, un botón de icono de 44 px con `aria-label` que rota entre las tres opciones.

## Tokens

- **Tema claro: «Petróleo».** La paleta anterior (fondo marfil cálido #F6F6F3, bordes #E4E2DA, texto casi negro y azul #2563EB) se parecía demasiado a la de Claude. «Petróleo» le da a EXEGEZIS identidad propia: neutros fríos gris azulado y un azul petróleo (#0E7490) para las acciones.
- **Tema claro, acción en azul eléctrico.** René aprobó después cambiar el azul petróleo (#0E7490 / #0B5F76 / #0E6682) por un azul eléctrico (#0066FF, y #0052CC para hover y enlaces), también en el contorno de los paneles (1.5 px, igual que en oscuro). El resto de los tokens claros de «Petróleo» no cambia. Blanco sobre #0066FF da 4.83:1 y #0052CC da 6.82:1 sobre blanco y 6.23:1 sobre el fondo: no hizo falta ajustar nada.
- **Tema oscuro: azul marino y lima.** Aprobado por René a partir de una captura de su app de Biblia: fondo azul marino, texto, botones y contornos de panel lima, títulos en blanco.
- Los colores de veredicto (ok, warn, q, off, bad) no cambian en ningún tema.

| Token | Claro (neutros «Petróleo», acción azul eléctrico) | Oscuro (marino y lima) | Uso |
|---|---|---|---|
| bg | #F2F5F6 | #011B34 | fondo de página |
| panel | #FFFFFF | #062443 | paneles, tarjetas, tablas, modales, menús |
| sunken | #F2F5F6 | #01172C | código, zonas hundidas |
| field | #FFFFFF | #01172C | campos de formulario |
| panel-border | #0066FF (azul eléctrico) | #D0DB4E (lima) | contorno de paneles, tarjetas, tablas, modales y menús |
| panel-border-width | 1.5px | 1.5px | grosor de ese contorno |
| panel-shadow | 0 1px 2px rgba(11,27,34,0.06) | none | sombra de esos mismos contornos |
| line | #E1E8EB | #0F3157 | divisiones internas (filas, separadores), 1 px |
| line-soft | #E9EFF1 | #0A2A4B | separadores suaves |
| line-strong | #B4C3C9 | #2A5A8C | borde de los campos de formulario y botones secundarios |
| hover | #E9EFF1 | #0A2A4B | fila o elemento bajo el puntero (*) |
| fg | #0B1B22 | #D0DB4E | texto |
| heading | #0B1B22 (= fg) | #FFFFFF | títulos h1–h3, cabecera y logo |
| muted | #4D6069 | #93A7C1 | texto secundario |
| faint | #56696F | #8499B4 | metadatos (*) |
| accent | #0066FF | #CDDC39 | fondo de botones |
| accent-hover | #0052CC | #DCE775 | botón bajo el puntero |
| accent-text | #0052CC | #FFFFFF | enlaces y anillo de foco |
| on-accent | #FFFFFF | #011B34 | texto sobre accent |
| off-bg / off-bd | #EEF2F3 / #D6DEE1 | off al 8 % (**) / off al 25 % | pastillas NOT VERIFIED, REFUTED |
| empty | #DCE4E7 | #12365D | segmentos vacíos del medidor de evidencia |
| stripe | #E3EAED | #0C2E52 | rayado de la etiqueta REPLAY |
| ok | #15803D sobre #EDF7F0 | #3DDC97 sobre ok al 12 % | VERIFIED, VALIDATED |
| warn | #B45309 sobre #FCF1E3 | #F5B544 sobre warn al 12 % | CANDIDATE, SUFFICIENT, INTERMITTENT, FLAKY |
| q | #475569 sobre #EEF1F4 | #AAB4C3 sobre q al 12 % | INCONCLUSIVE, INSUFFICIENT, sin ejecutar, en curso |
| off | #5F6672 | #8A93A2 | NOT VERIFIED, REFUTED |
| bad | #B91C1C sobre #FCEBEA | #F97366 sobre bad al 12 % | FALSE VALIDATION, INVALID PLAN, errores del motor |

(*) `hover` y `faint` no estaban en las tablas aprobadas. Se eligieron dentro de la misma familia de cada tema: `hover` es igual que `line-soft`, y `faint` está un paso por debajo de `muted`. Los dos cumplen AA (ver abajo).

(**) **Único ajuste por contraste.** En el tema oscuro, el gris de veredicto #8A93A2 sobre su fondo al 10 % compuesto sobre el panel nuevo (#062443) daba 4.40:1, por debajo de AA. Como los colores de veredicto no cambian, se bajó la mezcla del fondo al 8 %: 4.51:1. El texto gris es el mismo. Todos los demás tokens son exactamente los aprobados.

### Contornos

- Paneles, tarjetas, estadísticas, tablas (dentro de su panel), modales, la paleta de comandos y los menús desplegables usan la utilidad `panel-frame` de `globals.css`: `border: var(--panel-border-width) solid var(--panel-border)` y `box-shadow: var(--panel-shadow)`. Grosor y color son tokens: 1.5 px en los dos temas, azul eléctrico en claro y lima en oscuro. Es el único sitio donde se define ese contorno, sin colores ni grosores sueltos en los componentes. El panel lateral (Sheet) usa los mismos tokens en su borde izquierdo.
- Las divisiones dentro de un panel (cabecera, filas de tabla, separadores) siguen siendo de 1 px con `line`, más suaves que el contorno.
- Los avisos de estado (bloqueo, error del motor, escrituras de la página) conservan su borde del color de su familia: son estados, no paneles.

### Desviaciones anteriores que siguen vigentes

1. **ok-bg claro: #EDF7F0 en lugar de #E7F4EC.** #15803D sobre #E7F4EC da 4.43:1, que no llega a AA en el texto de 10–11 px de las pastillas. Con #EDF7F0 da 4.58:1.
2. **«En curso» usa la familia `q` con un punto pulsante, no el color de acción.** El color de acción queda reservado a las acciones.
3. **La severidad de una inspección no es una pastilla.** Se muestra como texto con un icono de forma (⇈ ↑ = ↓ i) y sin color de veredicto. Una severidad no es un veredicto, y pintarla de rojo la confundiría con un error del motor.

## Contraste (WCAG 2.1, texto normal: AA ≥ 4.5:1)

La tabla se calcula con la fórmula de luminancia relativa de WCAG 2.1. `test/contrast.test.ts` lee los valores de `globals.css` y falla si algún par baja de 4.5. También falla si queda algún resto del marfil o del azul anteriores, si un color de acción coincide con un color de veredicto, si cambia la paleta oscura aprobada o si cambian el contorno de `panel-frame` y sus tokens de color y grosor. Los fondos de veredicto al 8–12 % se componen sobre `panel`.

| Par | Claro | Oscuro |
|---|---|---|
| fg / bg | 16.05 | 11.53 |
| fg / panel | 17.59 | 10.38 |
| fg / sunken | 16.05 | 12.00 |
| fg / hover | 15.14 | 9.63 |
| heading / bg | 16.05 | 17.39 |
| heading / panel | 17.59 | 15.66 |
| muted / panel | 6.58 | 6.37 |
| muted / bg | 6.00 | 7.07 |
| muted / hover | 5.66 | 5.91 |
| muted / sunken | 6.00 | 7.36 |
| faint / panel | 5.76 | 5.37 |
| faint / bg | 5.26 | 5.96 |
| accent-text / panel | 6.82 | 15.66 |
| accent-text / bg | 6.23 | 17.39 |
| on-accent / accent | 4.83 | 11.50 |
| on-accent / accent-hover | 6.82 | 13.03 |
| ok / ok-bg | 4.58 | 6.87 |
| ok / panel | 5.02 | 8.86 |
| warn / warn-bg | 4.50 | 6.97 |
| warn / panel | 5.02 | 8.63 |
| q / q-bg | 6.68 | 5.99 |
| q / panel | 7.58 | 7.48 |
| off / off-bg | 5.13 | 4.51 |
| off / panel | 5.78 | 5.05 |
| bad / bad-bg | 5.61 | 4.99 |
| bad / panel | 6.47 | 5.72 |

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
