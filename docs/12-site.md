# 12 — Web pública (apps/site)

La web pública de EXEGEZIS: qué es el producto, cómo funciona y los precios. Es la página que verá cualquiera antes de usarlo.

El diseño de referencia es `docs/design/landing.html`. A 1440 px, la web reproduce su orden, sus textos, medidas, colores, bordes y sombras. `pnpm design:compare` lo comprueba; las diferencias que quedan, y por qué, están en `docs/design/README.md`. En el móvil (375–390 px), las secciones se apilan con el mismo estilo.

## Arquitectura

- **App separada:** `apps/site` (Next.js, App Router). Es independiente de la app local (`apps/web`, 127.0.0.1:4100), para poder publicarla sin ella.
- **Sitio estático:** `next build` la exporta a `apps/site/out/` (`output: "export"`). Se puede subir tal cual a cualquier alojamiento estático.
- **Tokens de diseño compartidos:** `packages/design-tokens/tokens.css`, el mismo archivo que usa la app local. No hay colores copiados.
  - Cabecera, portada y llamada final usan `.theme-dark`: azul marino `#011B34`, texto blanco, botones y bordes lima. La vista previa del informe, dentro de la portada, usa `.theme-light`.
  - El cuerpo usa el tema claro: fondo `#F2F5F6`, paneles blancos con contorno de 1.5 px `#0066FF`, enlaces `#0052CC` y botones `#0066FF`.
- **Idiomas:** next-intl, como la app local, pero con el idioma en la URL (`/en/`, `/es/`) para que cada página sea estática.
  - Catálogos: `apps/site/messages/{en,es}.json`.
  - `/` envía al idioma elegido antes en ese navegador, si no al del navegador, y si no a inglés.
  - El selector de la cabecera recuerda la elección.
  - `<html lang>`, el título, la descripción y Open Graph van en el idioma de cada página.

## Contenido y configuración

- **Precios:** `apps/site/content/pricing.ts` es el único sitio donde están los precios, los límites y las funciones de cada plan.
  - Cada función tiene `available`. Lo que EXEGEZIS aún no hace (versión en la nube, cuentas y pagos, vigilancia diaria y alertas, integraciones, informes con marca, API, SSO…) se muestra como «Próximamente».
  - Los planes de pago dicen «Pagos: próximamente», porque todavía no existen cuentas ni pagos.
  - Anual: el precio mensual mostrado es precio × 10 / 12, redondeado. Pro sale a 24 $/mes y se factura 290 $ al año; Equipo, 83 $/mes y 990 $ al año.
- **Enlaces:** `apps/site/content/links.ts`. Cada uno se cambia al compilar con su variable:

  | Variable | Por defecto |
  |---|---|
  | `NEXT_PUBLIC_EXEGEZIS_APP_URL` | `http://127.0.0.1:4100` (la app local) |
  | `NEXT_PUBLIC_EXEGEZIS_START_URL`, `…_SIGN_IN_URL`, `…_TRY_PRO_URL`, `…_TEAM_URL` | la app local |
  | `NEXT_PUBLIC_EXEGEZIS_SALES_URL` | `mailto:sales@exegezis.example` (dominio reservado: TODO, poner la dirección real) |
  | `NEXT_PUBLIC_EXEGEZIS_SITE_URL` | `http://127.0.0.1:4200` (URL pública, para Open Graph) |

- **«Inspeccionar gratis»:** mientras no exista la versión en la nube, abre la app local en `/?url=…`, con la dirección ya escrita en la pestaña Inspeccionar.
  - Si la app local no responde, explica cómo arrancarla: doble clic en `EXEGEZIS.cmd`, o `npm run dev` en la carpeta del repositorio.
  - La app local solo acepta direcciones http(s) en `?url=`.
- **Sin inventos:** no hay testimonios, logos de clientes ni cifras de uso, porque todavía no existen. La vista previa del informe de la portada es una ilustración: está marcada `aria-hidden` y usa `example.com`.
- **Pie:** las páginas que aún no existen (documentación, «cómo verificamos», novedades y las páginas legales) aparecen como texto con «(próximamente)», no como enlaces vacíos. Hay un TODO en `site-footer.tsx`.

## Garantías (pruebas)

- `apps/site/test/site.test.ts` comprueba:
  - catálogos idénticos en los dos idiomas (claves y marcadores ICU);
  - la matemática de precios;
  - que nada no disponible se prometa como disponible;
  - el idioma de `/`;
  - el contraste AA de todos los pares de color que usa la web.
- `apps/site/test/site.e2e.test.ts` usa un navegador real con su propio `next dev` y comprueba:
  - cada idioma sin palabras del otro, con `<html lang>`, título y Open Graph correctos;
  - el idioma de `/` y el selector;
  - Mensual y Anual, también con las flechas del teclado;
  - «Próximamente» donde corresponde;
  - que no haya scroll horizontal a 375 px y que el menú funcione en el móvil;
  - teclado: el enlace «Saltar al contenido» va primero y todo lo enfocable tiene foco visible;
  - las preguntas frecuentes se muestran abiertas, como en el diseño;
  - «Inspeccionar gratis» con la app local en marcha y parada.
- Capturas: `node apps/site/scripts/screenshots.mjs` genera `docs/screenshots/site/landing-{en,es}-{1440,375}.png` y las imágenes de Open Graph (`apps/site/public/og-{en,es}.png`).

## Comandos (CMD de Windows, desde la carpeta del repositorio)

```bat
pnpm design:compare
```

Compara la web y la página de inicio de la app con `docs/design/`, y deja las capturas y las diferencias en `docs\design\diff\`.


```bat
pnpm site
```

Arranca la web en http://127.0.0.1:4200. `npm run site` hace lo mismo.

```bat
pnpm build:site
```

Genera el sitio estático en `apps\site\out\`.
