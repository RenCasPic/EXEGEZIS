import type { HitVerdict, SearchStatus } from "@exegezis/core";
import type { Tone } from "./evidence/stages";

export const SEARCH_STATUS_TONE: Record<SearchStatus, Tone> = {
  COMPLETED: "ok",
  PARTIAL: "warn",
  BLOCKED: "warn",
  UNREACHABLE: "q",
  TIMEOUT: "q",
  ENGINE_ERROR: "bad",
  COST_LIMIT: "warn",
  AI_ERROR: "bad",
};

export const SEARCH_STATUS_LABEL: Record<SearchStatus, string> = {
  COMPLETED: "COMPLETADA",
  PARTIAL: "PARCIAL",
  BLOCKED: "BLOQUEADA",
  UNREACHABLE: "SIN CONEXIÓN",
  TIMEOUT: "TIEMPO AGOTADO",
  ENGINE_ERROR: "SIN NAVEGADOR",
  COST_LIMIT: "LÍMITE DE COSTE",
  AI_ERROR: "ERROR DE LA IA",
};

export const SEARCH_STATUS_TEXT: Record<SearchStatus, string> = {
  COMPLETED: "Se revisó todo lo que se encontró dentro del límite.",
  PARTIAL: "Algunas páginas no se pudieron revisar (tiempo total, bloqueos o errores): los resultados cubren solo lo revisado.",
  BLOCKED: "El sitio bloqueó la visita. EXEGEZIS no intenta saltarse el bloqueo.",
  UNREACHABLE: "No se pudo conectar con el sitio (DNS, TLS o conexión).",
  TIMEOUT: "La página de entrada no terminó de cargar a tiempo.",
  ENGINE_ERROR: "El navegador no pudo arrancar en este equipo. El problema está en este equipo, no en el sitio.",
  COST_LIMIT: "La parte por significado no se ejecutó (o se detuvo) porque su coste superaba el límite.",
  AI_ERROR: "La parte por significado falló. Lo exacto, si lo había, sí se revisó.",
};

export const VERDICT_TONE: Record<HitVerdict, Tone> = { VERIFIED: "ok", INTERMITTENT: "q", SUGGESTED_QUOTE_VERIFIED: "warn" };
export const VERDICT_PILL: Record<HitVerdict, string> = { VERIFIED: "VERIFICADO", INTERMITTENT: "INTERMITENTE", SUGGESTED_QUOTE_VERIFIED: "SUGERENCIA · CITA VERIFICADA" };
export const VERDICT_HELP: Record<HitVerdict, string> = {
  VERIFIED: "Aparece en todas las cargas de la página.",
  INTERMITTENT: "Aparece solo en algunas cargas (carrusel, contenido aleatorio…).",
  SUGGESTED_QUOTE_VERIFIED: "La cita es real (está literalmente en la página); si es relevante, lo decides tú.",
};

export const RELEVANCE_LABEL: Record<"high" | "medium" | "low", string> = { high: "alta", medium: "media", low: "baja" };

export function usd(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: n < 0.01 && n > 0 ? 4 : 2 })} USD`;
}
