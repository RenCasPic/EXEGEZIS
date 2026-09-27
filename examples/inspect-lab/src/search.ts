import type { ServerResponse } from "node:http";

/*
 * Search fixtures (docs/10-search.md §7, phase 1 acceptance), in Spanish:
 *
 *   /search/            entry, links to the others
 *   /search/salud       accents, capitals, plurals, a phrase, inline markup inside a word,
 *                       a closed accordion, display:none and aria-hidden text, an "anuncio" block
 *                       (for -anuncio) and «año» (never «ano»)
 *   /search/atributos   the words only in alt, aria-label, title, meta description and og:title
 *   /search/carrusel    a slide that changes on every load: «medicina preventiva» once every 3 loads
 *   /search/control     near misses only (medicinales, medio, curandero, «ano», enfermería…): 0 hits with exact terms
 */

let carousel = 0;

const SLIDES = ["Esta semana: medicina preventiva para toda la familia.", "Esta semana: ofertas de verano en la librería.", "Esta semana: talleres de música para jóvenes."];

function page(title: string, body: string, head = ""): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body>${body}</body></html>`;
}

const NAV = `<nav><a href="/search/">Inicio</a> · <a href="/search/salud">Salud</a> · <a href="/search/atributos">Atributos</a> · <a href="/search/carrusel">Carrusel</a> · <a href="/search/control">Control</a></nav>`;

function salud(): string {
  return page(
    "Salud y oración",
    `${NAV}<main>
      <h1>Salud y oración</h1>
      <p>El MÉDICO de la comunidad visita los martes.</p>
      <p>Oramos por las enfermedades de todos los hermanos.</p>
      <p>No abandones tu tratamiento médico sin consultarlo.</p>
      <p>La <b>cur</b>ación llega de muchas formas.</p>
      <p>Medicinas y remedios: pregunta en recepción.</p>
      <p>Anuncio: medicina natural con descuento.</p>
      <p>¡Feliz año a toda la comunidad!</p>
      <details><summary>Preguntas frecuentes</summary><p>¿Podemos curar sin médico? Consulta siempre a un profesional.</p></details>
      <div style="display:none">Texto oculto sobre la enfermedad de un hermano.</div>
      <p aria-hidden="true">Tratamiento decorativo que no se lee.</p>
    </main>`,
  );
}

function atributos(): string {
  return page(
    "Galería",
    `${NAV}<main>
      <h1>Galería</h1>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40" alt="Un médico atiende a un paciente">
      <button aria-label="Pedir cita para tratamiento">📅</button>
      <span title="Enfermedad crónica">ⓘ</span>
    </main>`,
    `<meta name="description" content="Centro de medicina familiar"><meta property="og:title" content="Curar con cuidado">`,
  );
}

function carrusel(): string {
  const slide = SLIDES[carousel % SLIDES.length] ?? "";
  carousel += 1;
  return page("Novedades", `${NAV}<main><h1>Novedades</h1><div class="slide"><p>${slide}</p></div></main>`);
}

function control(): string {
  return page(
    "Control",
    `${NAV}<main>
      <h1>Página de control</h1>
      <p>Plantas medicinales del huerto, a medio camino entre el arte y la ciencia.</p>
      <p>El curandero del cuento vivía en el ano de la montaña (sic).</p>
      <p>Remedios caseros, meditación y medios de comunicación.</p>
      <p>Tratamientos de madera para muebles; la enfermería del colegio cerró.</p>
    </main>`,
  );
}

export function handleSearch(res: ServerResponse, url: URL): boolean {
  const html = (body: string) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
    return true;
  };
  switch (url.pathname) {
    case "/search/":
      return html(page("Búsquedas · laboratorio", `${NAV}<main><h1>Laboratorio de búsquedas</h1><p>Páginas para probar la búsqueda.</p></main>`));
    case "/search/salud":
      return html(salud());
    case "/search/atributos":
      return html(atributos());
    case "/search/carrusel":
      return html(carrusel());
    case "/search/control":
      return html(control());
    case "/__lab/search-reset":
      carousel = 0;
      return html("ok");
    default:
      return false;
  }
}

