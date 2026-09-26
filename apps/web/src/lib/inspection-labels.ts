import type { InspectionStatus, PageStatus, Severity } from "@exegezis/core";
import type { Tone } from "./evidence/stages";

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Crítica",
  serious: "Grave",
  moderate: "Moderada",
  minor: "Menor",
  info: "Info",
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "critical",
  serious: "critical",
  moderate: "warning",
  minor: "neutral",
  info: "neutral",
};

export const INSPECTION_STATUS_TONE: Record<InspectionStatus, Tone> = {
  COMPLETED: "positive",
  PARTIAL: "warning",
  BLOCKED: "warning",
  UNREACHABLE: "critical",
  TIMEOUT: "critical",
};

export const INSPECTION_STATUS_TEXT: Record<InspectionStatus, string> = {
  COMPLETED: "La página de entrada se inspeccionó en todas las repeticiones.",
  PARTIAL: "Se agotó el tiempo total antes de terminar: el informe cubre solo lo visitado.",
  BLOCKED: "El sitio bloqueó la inspección (anti-bot, CAPTCHA, login o 451). EXEGEZIS no intenta saltarse ese bloqueo.",
  UNREACHABLE: "No se pudo conectar con el sitio (DNS, TLS o conexión).",
  TIMEOUT: "La página de entrada no terminó de cargar a tiempo.",
};

export const PAGE_STATUS_TONE: Record<PageStatus, Tone> = {
  OK: "positive",
  HTTP_ERROR: "critical",
  DEGRADED: "warning",
  BLOCKED: "warning",
  UNREACHABLE: "critical",
  TIMEOUT: "critical",
  SKIPPED_BUDGET: "neutral",
  SKIPPED_ROBOTS: "neutral",
};

export const CHECK_LABEL: Record<string, string> = {
  "js-exceptions": "Excepciones JS",
  "console-errors": "Errores de consola",
  "failed-requests": "Peticiones fallidas",
  "broken-links": "Enlaces rotos",
  a11y: "Accesibilidad",
  "mixed-content": "Contenido mixto",
  "seo-basics": "SEO básico",
};

/** Path + query of a URL on the inspected origin; the full URL otherwise. */
export function shortUrl(url: string, origin: string): string {
  try {
    const u = new URL(url);
    return u.origin === origin ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}
