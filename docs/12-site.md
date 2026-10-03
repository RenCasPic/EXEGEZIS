# 12 — Páginas públicas (landing y legales)

Las páginas públicas de EXEGEZIS explican qué es el producto, cómo funciona y los precios, y publican los textos legales. Viven **dentro de la app** (`apps/web`): un solo servidor, un solo puerto (4100) y un solo dominio, como en Transcriptor.

El diseño de referencia es `docs/design/landing.html`. A 1440 px, la landing reproduce su orden, sus textos, medidas, colores, bordes y sombras. `pnpm design:compare` lo comprueba sobre `/producto`; las diferencias que quedan, y por qué, están en `docs/design/README.md`. En el móvil (375–390 px), las secciones se apilan con el mismo estilo.

## Rutas

| Página | Español | Inglés |
|---|---|---|
| Landing | `/producto` | `/product` |
| Privacidad (borrador) | `/privacidad` | `/privacy` |
| Términos (borrador) | `/terminos` | `/terms` |

`/`, como en cualquier web app:
- **sin sesión:** muestra la landing, en el idioma de la cookie de idioma o, si no hay, en el del navegador. La URL sigue siendo `/`.
  - Si no hay cookie de sesión, ni siquiera se consulta a Supabase.
  - `/?url=…` lleva primero al registro y después a la pestaña Inspeccionar con esa dirección.
- **con sesión:** la página de inicio de la app.

## Arquitectura

- **Estáticas:** cada página pública tiene `export const dynamic = "force-static"`. `next build` las genera como HTML (`○ Static` en la tabla de rutas), y se sirven con `Cache-Control: s-maxage=31536000`. En la prueba local respondieron en unos 4 ms.
  - No leen cookies, cabeceras ni la sesión, y no ejecutan código de la app.
  - El proxy (`src/proxy.ts`) no pasa por ellas: su `matcher` las excluye. Un test comprueba las dos cosas.
- **Dos layouts raíz:** `(site-es)` y `(site-en)` (`src/app`), uno por idioma, con su propio `<html lang>` y su CSS (`src/site/site.css`).
  - La app tiene los suyos: `(home)` para `/`, `(app)` con la barra lateral y `(auth)` para entrar y registrarse.
  - Navegar de una a otra recarga la página completa. Es normal en Next con varios layouts raíz.
  - `global-not-found.tsx` da el 404 de las URL que no existen.
- **Idiomas:** el idioma lo da la ruta, no una cookie.
  - El catálogo es `apps/web/messages/site/{en,es}.json` y se usa con su propio traductor (`src/site/i18n.ts`, `createTranslator`), no con la configuración de idioma de la app, que lee cookies.
  - El selector EN / ES lleva a la misma página en el otro idioma y guarda la elección en la cookie de idioma de la app.
- **Tokens de diseño compartidos:** `packages/design-tokens/tokens.css`, el mismo archivo que usa la app.
  - Cabecera, portada y llamada final usan `.theme-dark`: azul marino `#011B34`, texto blanco, botones y bordes lima.
  - La vista previa del informe usa `.theme-light`. El cuerpo es claro: fondo `#F2F5F6` y paneles blancos con contorno de 1.5 px `#0066FF`.
- **Código:** `src/site/` contiene:
  - `components/`, las secciones;
  - `pages.tsx`, el documento, la landing, las páginas legales y sus metadatos;
  - `i18n.ts` y `paths.ts`;
  - `links.ts`, los enlaces de los botones, solo en el servidor;
  - `urls.ts`, lo que necesita el navegador;
  - `legal.ts`, los textos.

## Contenido y enlaces

- **Precios:** `packages/accounts/src/pricing.ts` es la fuente única. La landing muestra precios, límites y funciones. La app aplica esos mismos límites en el servidor.
  - Cada función tiene `available`. Lo que EXEGEZIS aún no hace se muestra como «Próximamente».
  - Los planes de pago dicen «Pagos: próximamente».
  - Anual: el precio mensual mostrado es precio × 10 / 12, redondeado. Pro sale a 24 $/mes y se factura 290 $ al año; Equipo, 83 $/mes y 990 $ al año.
- **Botones:** todos apuntan al mismo dominio.

  | Botón | Destino |
  |---|---|
  | «Iniciar sesión» | `/login` |
  | «Empieza gratis», «Probar Pro / Equipo» | `/signup?plan=…` |
  | «Inspeccionar gratis» con URL | `/signup?next=/?url=…`. Con sesión, la app lo salta y abre la pestaña Inspeccionar |
  | «Hablar con ventas» | `EXEGEZIS_SALES_URL` |

- **Cabecera con sesión:** muestra «Ir a la app» y las iniciales del usuario. Como la página es estática, las lee de una cookie que deja el proxy (`EXEGEZIS_SIGNED_IN`).
  - Solo contiene las iniciales: no es la sesión, que sigue siendo httpOnly.
  - La app comprueba la sesión de verdad al entrar.
  - No hay `/api/session` ni CORS.
- **Legal:** los textos son **borradores marcados** («Borrador pendiente de revisión legal»).
  - El registro guarda la versión aceptada (`packages/accounts/src/legal.ts`).
  - El contacto de privacidad es `EXEGEZIS_PRIVACY_EMAIL`.
- **Pie:** documentación, «cómo verificamos», novedades y uso responsable aparecen como texto con «(próximamente)».
- **Sin inventos:** no hay testimonios, logos de clientes ni cifras de uso. La vista previa del informe es una ilustración marcada `aria-hidden`.

## Pruebas

- `apps/web/test/site.test.ts` comprueba:
  - catálogos idénticos en los dos idiomas;
  - la matemática de precios y que nada no disponible se prometa;
  - los enlaces de los botones y los borradores legales;
  - el contraste AA de todos los pares de color;
  - que las páginas públicas sean `force-static`, queden fuera del proxy y no importen nada de la petición ni de la sesión.
- `apps/web/test/site.e2e.test.ts` usa un navegador real y comprueba:
  - `/producto` y `/product`, cada una solo en su idioma, con `<html lang>`, título y Open Graph;
  - que `/` sin sesión es la landing;
  - el selector, que cambia también el idioma de la app;
  - Mensual y Anual, también con el teclado;
  - «Próximamente» y los borradores;
  - 375 px sin scroll horizontal, y el menú;
  - el foco visible en todo;
  - «Inspeccionar gratis», que pide el registro y después abre la pestaña Inspeccionar con la URL.
- `apps/web/test/accounts.e2e.test.ts` comprueba también `/` con sesión: la app.
- Capturas: `node apps/web/scripts/site-screenshots.mjs` genera `docs/screenshots/site/landing-{en,es}-{1440,375}.png` y las imágenes de Open Graph (`apps/web/public/og-{en,es}.png`).

## Comandos (CMD de Windows, desde la carpeta del repositorio)

```bat
pnpm web
```

Arranca la app en http://127.0.0.1:4100 (necesita las variables de Supabase en `.env`: ver `docs/13-accounts.md`). Sin sesión, `/` es la landing; también está en http://127.0.0.1:4100/producto.

```bat
pnpm design:compare
```

Compara la landing y la página de inicio de la app con `docs/design/`, y deja las capturas y las diferencias en `docs\design\diff\`.
