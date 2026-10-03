# Referencias de diseño

| Referencia | Implementación |
|---|---|
| `landing.html` + `landing.png` | la landing de `apps/web` (`/producto`), a 1440 px |
| `home-app.html` + `home-app.png` | `apps/web`, página de inicio, a 1440 px (temas claro y oscuro) |
| `home-app-mobile.html` + `home-app-mobile.png` | `apps/web`, página de inicio, a 390 px |
| `palette.html` | veredictos y medidor de evidencia |

## Comparación: `pnpm design:compare`

`scripts/design-compare.mjs` captura la implementación y la referencia. Guarda en `docs/design/diff/`, para cada página:

- `*.actual.png`: la implementación, a página completa;
- `*.reference.png`: el HTML de referencia, renderizado con las mismas fuentes Geist locales que usan las apps;
- `*.diff.png`: la referencia desvaída, con las diferencias en rojo;
- `*.png-diff.png`: la comparación contra el PNG del repositorio;
- `report.md`: el porcentaje de píxeles distintos.

El PNG del repositorio se capturó sin la fuente Geist. Sus saltos de línea son distintos, así que esa comparación es solo orientativa. La comparación justa es contra el HTML.

Arranca su propio `next dev` para cada app. Con `SITE_URL` o `WEB_URL` usa uno que ya esté en marcha. Con `DESIGN_ONLY=landing,home-app` compara solo esas páginas.

## Lo que queda distinto y por qué

### Diferencias por cómo está hecha la referencia

- **Antialiasing.** El texto de la referencia cae en posiciones de medio píxel. Por eso, en los diff, los bordes de las letras salen en rojo aunque la posición y el tamaño coincidan. Se comprobó que el mismo archivo de fuente se dibuja idéntico en las dos páginas.
- **Altura fija.** Las referencias fijan la altura de su contenedor por debajo de su contenido, y el navegador encoge lo que puede encoger. La cabecera de la app pasa de 64 px a 38 px, como se ve en `home-app.png`. La comparación las dibuja con su altura natural, y la app usa los 64 px del diseño.
- **Elementos sin estilo.** La referencia crea sus elementos con nombres en mayúsculas. Su regla global `a { color: #0052CC }` no se aplica, y sus `<input>` no son campos reales, así que no muestran el texto de ejemplo. Se ha seguido lo que la referencia muestra: los enlaces del pie, «Ver todo» y «Abrir una investigación» van en el color del texto. Las apps sí muestran el texto de ejemplo en los campos.

### Diferencias intencionadas

**Landing (`apps/web`, `/producto`):**

- **«Próximamente» y «Pagos: próximamente» en los planes.** Se mantienen, como pedía la tarea anterior: nada que no exista se presenta como disponible.
  - Lo que aún no existe lleva un círculo discontinuo en vez de la marca y la etiqueta «Próximamente».
  - Por eso la sección de precios mide unos 100 px más y lo que va debajo baja lo mismo.
- **Selector de idioma EN / ES** en la cabecera: la referencia está solo en español.
- **«Abrir la app» en modo local.** En modo local no hay cuentas, así que «Iniciar sesión» se convierte en «Abrir la app» y los botones de los planes llevan a la app. La comparación se hace en modo local; en modo nube la cabecera es la del diseño.
- **Pie.** Las páginas que aún no existen (documentación, «cómo verificamos», novedades y legales) son texto con «(próximamente)», no enlaces vacíos.
- **«Inspeccionar gratis» de la llamada final** lleva al campo de la portada, donde se escribe la dirección.
- **Contraste de «Verificado».** El fondo de la etiqueta es `#EDF7F0` y no el `#E7F4EC` del diseño. Con este último, el verde `#15803D` queda en 4,43:1, por debajo de AA (4,5:1).

**Inicio de la app (`apps/web`):**

- **Datos reales.** La referencia usa casos de ejemplo. El inicio muestra los de `runs/` (los 6 más recientes; «Ver todo» abre la lista entera) y las inspecciones que haya. Por eso las filas, las cifras y la altura cambian.
- **Títulos en blanco en el tema oscuro.** Es la paleta aprobada: `heading` en blanco, el texto en lima. La referencia define `heading`, pero no lo usa.
- **Selector de idioma** antes del de tema.
  - En la portada, el enlace «Buscar texto en un sitio →» mantiene la búsqueda a mano. En el móvil está en el menú.
- **Etapas.** «Qué puede demostrar hoy» muestra las 8 etapas reales de EXEGEZIS, con su estado (Listo, Candidato / validada, No implementado). La referencia tiene una lista algo distinta, con «Inspección web».
- **Etiquetas del medidor.** Se basan en lo que se sabe de cada caso, por ejemplo «Suficiente». No incluyen el número de hipótesis del ejemplo, porque ese dato no está en el resumen.
- **Las demás páginas de la app** siguen con la barra lateral. Solo la página de inicio usa la cabecera del diseño.
