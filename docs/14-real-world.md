# 14. Prueba en webs reales

Del 7 de octubre de 2026. EXEGEZIS en modo local, desde el equipo de René (Windows, conexión doméstica).

## Cómo se hizo

- **22 webs**: la de René (jesushealingministry.net) y webs públicas hechas para pruebas, demos o *scraping*. Ninguna web de terceros sin ese propósito.
- **Variedad**:
  - estáticas: example.com, books/quotes.toscrape;
  - WordPress: el tema oficial Twenty Twenty-Four y practicetestautomation;
  - tiendas: automationexercise, webscraper.io, Hydrogen (la demo oficial de Shopify), el sandbox de Oxylabs y OpenCart;
  - SPA: TodoMVC en React y en Vue, RealWorld (Angular), Juice Shop y demoqa;
  - con anuncios: automationexercise y demoqa;
  - con login: the-internet, saucedemo, ParaBank y quotes;
  - multilingües: la de René y el ejemplo oficial de next-intl.
- **Opciones**: `--max-pages 10 --max-depth 1 --runs 3 --devices desktop,mobile --no-session`. Siempre en modo solo lectura (EXEGEZIS solo navega y hace GET) y respetando robots.txt.
- **Tiempo de cada web**: el total de la inspección (3 repeticiones × 2 dispositivos), incluidas las sondas del sitio.
- **Hallazgos**: los problemas verificados (en todas las repeticiones), por área y subárea. Los intermitentes se cuentan aparte.
- **Revisión**: los grupos dudosos se revisaron a mano. Cada falso positivo o fallo de EXEGEZIS se corrigió con su test y la web se volvió a inspeccionar.
- **WooCommerce**: su tienda de demostración (themes.woocommerce.com/storefront) ya redirige a la tienda de temas, y demo.vercel.store da 404. No se usaron.

## Resultados (última inspección de cada web, con las correcciones)

| Web | Tiempo | Estado | Páginas | Bloqueos | Frontend (subáreas) | Backend (subáreas) | Intermitentes |
|---|---|---|---|---|---|---|---|
| www.jesushealingministry.net | 199 s | COMPLETED | 10 | 0 | 15 (Dis./a11y 1, Rend. 1, Móvil 13) | 5 (Seg. 5) | 2 |
| demo.playwright.dev/todomvc | 19 s | COMPLETED | 1 | 0 | 5 (Dis./a11y 2, SEO 1, Móvil 3) | 7 (Seg. 5, Conf. 2) | 0 |
| the-internet.herokuapp.com | 614 s | PARTIAL | 8 | 2 | 19 (Dis./a11y 5, Func. 2, Rend. 5, SEO 1, Móvil 6, Ext. 1) | 10 (Resp. 3, Seg. 7) | 29 |
| www.saucedemo.com | 7 s | BLOCKED | 0 | 1 | 0 | 0 | 0 |
| automationexercise.com | 386 s | COMPLETED | 10 | 0 | 62 (Dis./a11y 37, Rend. 9, SEO 2, Móvil 13, Ext. 3) | 11 (Seg. 8, Conf. 3) | 105 |
| practicetestautomation.com | 174 s | PARTIAL | 5 | 0 + 2 sin red | 18 (Dis./a11y 8, Móvil 9, Ext. 1) | 6 (Seg. 6) | 1 |
| demoqa.com | 179 s | PARTIAL | 7 | 0 + 4 sin red | 12 (Dis./a11y 6, Rend. 3, SEO 1, Móvil 2, Ext. 1) | 9 (Seg. 6, Conf. 3) | 5 |
| books.toscrape.com | 195 s | COMPLETED | 10 | 0 | 10 (Dis./a11y 6, Móvil 3, Ext. 1) | 11 (Seg. 9, Conf. 2) | 0 |
| quotes.toscrape.com | 141 s | COMPLETED | 10 | 0 | 20 (Dis./a11y 9, Rend. 1, SEO 1, Móvil 10) | 12 (Seg. 10, Conf. 2) | 0 |
| webscraper.io/test-sites/e-commerce/allinone | 274 s | COMPLETED | 10 | 0 | 105 (Dis./a11y 94, Func. 1, Rend. 2, Móvil 4, Ext. 4) | 0 | 1 |
| demo.opencart.com | 10 s | BLOCKED | 0 | 1 | 0 | 0 | 0 |
| todomvc.com/examples/vue/dist | 16 s | COMPLETED | 1 | 0 | 3 (Móvil 3) | 8 (Seg. 6, Conf. 2) | 0 |
| demo.realworld.show | 173 s | COMPLETED | 10 | 0 | 27 (Dis./a11y 21, Rend. 1, SEO 2, Móvil 5) | 9 (Seg. 6, Conf. 3) | 0 |
| parabank.parasoft.com/parabank/index.htm | 169 s | COMPLETED | 10 | 0 | 61 (Dis./a11y 45, SEO 4, Móvil 16) | 9 (Seg. 7, Conf. 2) | 0 |
| juice-shop.herokuapp.com | 92 s | COMPLETED | 1 | 0 | 6 (Dis./a11y 6, SEO 2) | 2 (Resp. 2) | 0 |
| wp-themes.com/twentytwentyfour | 184 s | COMPLETED | 10 | 0 | 26 (Dis./a11y 10, Rend. 2, SEO 1, Móvil 13, Ext. 1) | 9 (Seg. 7, Conf. 2) | 0 |
| hydrogen.shop | 181 s | COMPLETED | 10 | 0 | 4 (Cont. 1, Dis./a11y 2, Móvil 1) | 2 (Seg. 2) | 0 |
| next-intl-example-app-router.vercel.app | 41 s | COMPLETED | 3 | 0 | 0 | 6 (Seg. 5, Conf. 1) | 0 |
| example.com | 16 s | COMPLETED | 1 | 0 | 0 (SEO 1, informativo) | 9 (Seg. 7, Conf. 2) | 0 |
| httpbin.org | 43 s | COMPLETED | 2 | 0 | 16 (Dis./a11y 4, Rend. 4, SEO 4, Móvil 8) | 8 (Seg. 7, Conf. 1) | 0 |
| sandbox.oxylabs.io/products | 202 s | COMPLETED | 10 | 0 | 28 (Dis./a11y 18, SEO 1, Móvil 8, Ext. 2) | 8 (Seg. 6, Conf. 2) | 0 |
| www.scrapethissite.com | 46 s | COMPLETED | 3 | 0 | 8 (Dis./a11y 3, SEO 1, Móvil 1, Ext. 4) | 8 (Seg. 7, Conf. 1) | 0 |

Subáreas:
- Frontend: Cont. contenido, Dis./a11y diseño y accesibilidad, Func. funcionamiento, Rend. rendimiento, Ext. servicios externos.
- Backend: Resp. respuestas del servidor, Seg. seguridad, Conf. configuración.

«sin red»: visitas que no se pudieron hacer porque la conexión de este equipo se cortó durante la prueba (`ERR_INTERNET_DISCONNECTED`), no por la web. Las páginas de una sola página (TodoMVC, Juice Shop, example.com) son SPA o sitios sin más enlaces internos a profundidad 1.

**En total:** 22 webs en 56 minutos, 132 páginas. 17 terminaron completas, 3 parciales (algunas páginas bloqueadas o la conexión cortada) y 2 bloqueadas en la entrada.

**Los bloqueos que quedan son reales:**
- saucedemo.com: su portada es el formulario de acceso («muro de login»).
- demo.opencart.com: un desafío de Cloudflare.
- the-internet: dos páginas con autenticación HTTP Basic y Digest.

## Falsos positivos y fallos de EXEGEZIS encontrados, y cómo se corrigieron

Cada uno con su test. La web se volvió a inspeccionar después.

| Web | Qué pasaba | Corrección | Commit |
|---|---|---|---|
| automationexercise.com | La portada salía **bloqueada por un desafío anti-bot**: la «página final» era la navegación de un **iframe de anuncios**, y la marca venía de un reCAPTCHA | Solo cuenta la navegación del marco principal (`mainFrame` en cada petición); un CAPTCHA solo es un muro si la página no tiene contenido propio | 1be6984 |
| demoqa.com, automationexercise.com | Páginas con poco texto, marcadas como desafío por iframes **ocultos** de reCAPTCHA | Solo cuenta un CAPTCHA visible y del tamaño de un widget | 4dd784d |
| practicetestautomation.com/contact | Un **formulario de contacto con reCAPTCHA** se tomaba por un muro | Un CAPTCHA dentro de un formulario con campos propios es de ese formulario | 3a2f929 |
| the-internet.herokuapp.com | **TIMEOUT de todo el sitio** con 0 páginas: su CSS y su JS propios tardan unos 30 s y DOMContentLoaded llegaba a los 30,8 s | Si el documento llegó, la página se inspecciona tal como está. Ahora: 8 páginas | 1be6984 |
| webscraper.io | **Cuelgue** (`TypeError: Invalid URL`): una cookie cuyo valor era la URL del sitio se tachaba como secreto y los enlaces quedaban como `[REDACTED]/computers` | Una cookie que solo es una dirección pública no es un secreto; un enlace inválido se salta y nunca tumba la inspección | 35ddc2f |
| practicetestautomation.com | 9 **«enlaces rotos» 403**: enlaces que redirigen a Udemy, que rechaza a los clientes automáticos | Si el enlace sale a otro sitio y la respuesta es un rechazo anti-bot (401/403/429/503/999), no se comprueba | 35ddc2f |
| practicetestautomation.com | Las imágenes del contenido servidas desde el CDN de WordPress (i0.wp.com) iban a «Servicios externos» | Una imagen dibujada en la propia página es contenido del sitio | 35ddc2f |
| parabank.parasoft.com | 11 **«enlaces rotos» 400**: `;jsessionid=` quedaba tachado en la URL y se pedía literalmente `[REDACTED]` | `;jsessionid=` no forma parte de la dirección; una URL tachada nunca se pide | d5c9b4f, a991591 |
| parabank.parasoft.com | Contacto, búsqueda y admin salían como **«muro de login»** por la caja de login lateral | Una caja de login junto a un formulario propio no es un muro. Ahora: 10 páginas, sin bloqueos | 137798d |
| demo.realworld.show/register | La página de registro salía como «muro de login» | Una página de registro es un formulario por diseño | d5c9b4f |
| sandbox.oxylabs.io | Decenas de **«enlaces rotos»** con ETIMEDOUT/ENOTFOUND: se había cortado la conexión de este equipo | Un enlace del propio sitio que falla por error de red justo después de cargar sus páginas es nuestra conexión, no un enlace roto | 296343f |
| automationexercise.com | **Seguridad**: la comprobación de enlaces hizo GET a `/api/deleteAccount`, porque el filtro no reconocía palabras pegadas (respondió 405 sin borrar nada) | `deleteAccount`, `removeItem`, `log_out`… nunca se piden; un 405 no es un enlace roto | 4dd784d |
| practicetestautomation.com | `heavy-resources` fallaba con «Invalid URL» por una dirección tachada | Se salta en lugar de fallar | 3a2f929 |
| Ruido de agrupación | RealWorld: el avatar sin `alt` salía en **15 grupos**, uno por autor. automationexercise: un grupo por imagen de producto. ParaBank: **29 grupos** de objetivos táctiles, uno por campo. scrapethissite y oxylabs: píxeles de seguimiento como «sin caché» | Selectores sin los valores de `href`/`src`; rutas con números normalizados; campos por su etiqueta; nada por debajo de 2 KB | d5c9b4f, 4dd784d, 2ac2f9f, a991591 |

**Revisados a mano y correctos** (no son falsos positivos):
- certificados que caducan en 25 días (toscrape: Let's Encrypt no renovó a los 30);
- HSTS con `max-age=0`;
- example.com y wp-themes.com sirven HTTP sin redirigir a HTTPS;
- Hydrogen enlaza de verdad a `/404`;
- the-internet: sus archivos estáticos responden 503 y por eso falla jQuery;
- el LCP de 6 s en /books de la web de René;
- webscraper.io envía todas las cabeceras de seguridad, así que 0 hallazgos ahí es correcto.

## Mejoras pendientes, por impacto

1. **Contenido de iframes de terceros** (banners de cookies, chats, vídeos): axe lo revisa como si fuera de la página (botones sin nombre dentro de los iframes de Termly o HelpScout en webscraper.io; Juice Shop). Debería ir a «Servicios externos».
2. **Campos sin etiqueta** (axe `label`): siguen siendo un grupo por campo cuando cada uno tiene su propio id (ParaBank: 45 grupos de diseño). Agruparlos por formulario.
3. **Visitas que acaban en la página de error de la aplicación** (Next.js `__next_error__` tras un `ChunkLoadError` por un corte de red, en la web de René): generan intermitentes en cascada (sin viewport, sin h1, sin título). Esa visita debería contar como fallida, no como página.
4. **Login en la portada** (saucedemo): ahora es un muro de login con el aviso de guardar el acceso, como está documentado. Se podría inspeccionar además la propia página de login pública.
5. **Contenido mixto contado dos veces** (books.toscrape): el jQuery bloqueado por HTTP aparece como contenido mixto y como petición fallida.
6. **Anotaciones que Google inyecta** (`.google-anno-sc`, `.goog-rentries` en automationexercise): axe las revisa como propias. Son de terceros aunque estén en el documento.
7. **Webs lentas**: the-internet tardó 614 s porque cada visita espera hasta 30 s a archivos que cuelgan. Un tope por página más corto cuando el documento ya llegó lo acortaría.
8. **Webs de René**: solo se probó jesushealingministry.net. Falta la lista de sus otras webs.
