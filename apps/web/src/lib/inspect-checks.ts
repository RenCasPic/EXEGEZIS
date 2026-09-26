/**
 * The checks `exegezis inspect` knows (packages/inspect/src/checks). The UI
 * does not import the inspector (it would pull a browser into the web
 * server); a test keeps this list equal to the real registry.
 */
export const INSPECT_CHECKS = [
  { id: "js-exceptions", label: "Excepciones JS" },
  { id: "console-errors", label: "Errores de consola" },
  { id: "failed-requests", label: "Peticiones fallidas" },
  { id: "broken-links", label: "Enlaces rotos" },
  { id: "a11y", label: "Accesibilidad (axe, WCAG 2.1 AA)" },
  { id: "mixed-content", label: "Contenido mixto" },
  { id: "seo-basics", label: "SEO básico (info)" },
] as const;

/** Defaults of the CLI, shown as chips on the form. */
export const INSPECT_DEFAULTS = { maxPages: 20, maxDepth: 2, runs: 3 } as const;

/** Loopback targets never need the permission confirmation. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}
