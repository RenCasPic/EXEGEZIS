import type { BlockKind } from "@exegezis/core";

/**
 * Plain Spanish for each block kind (docs/09-access.md §1): what happened,
 * and what the person can do. The solution buttons come from `SOLUTION`.
 */
export const BLOCK_TITLE: Record<BlockKind, string> = {
  HTTP_AUTH: "El sitio pide usuario y contraseña (autenticación HTTP)",
  BOT_CHALLENGE: "El sitio muestra una verificación anti-bot",
  SESSION_EXPIRED: "La sesión guardada ha caducado",
  LOGIN_WALL: "Hace falta iniciar sesión para ver esta página",
  CONSENT_WALL: "Un banner de cookies tapa el contenido",
  RATE_LIMITED: "El sitio pide ir más despacio",
  FORBIDDEN: "El sitio rechaza a este equipo",
  NETWORK_RESTRICTED: "El sitio no es accesible desde esta red",
};

export const BLOCK_EXPLANATION: Record<BlockKind, string> = {
  HTTP_AUTH: "El servidor responde 401 y pide credenciales HTTP (Basic o Digest). Escribe el usuario y la contraseña de ese sitio: se guardan cifrados en este equipo y solo se envían a ese sitio.",
  BOT_CHALLENGE:
    "Hay un desafío anti-bot (Cloudflare, Turnstile, reCAPTCHA, hCaptcha, DataDome…). EXEGEZIS nunca lo resuelve ni lo esquiva. Si el sitio es tuyo, lo recomendado es autorizar a EXEGEZIS en su WAF con un token; si no, puedes pasar tú la verificación en una ventana (solo en un sitio propio o con permiso).",
  SESSION_EXPIRED: "Había una sesión guardada, pero el sitio vuelve a pedir el inicio de sesión. Renuévala en una ventana: la inspección se relanza sola con las mismas opciones.",
  LOGIN_WALL: "La página pedida redirige al inicio de sesión o solo muestra un formulario de login. Inicia sesión tú en una ventana: EXEGEZIS guarda solo las cookies de este sitio, nunca tu contraseña.",
  CONSENT_WALL: "Un diálogo de cookies cubre la página y bloquea la navegación. Elige tú en una ventana (la opción más privada sirve); la elección se recuerda. La inspección nunca pulsa el banner.",
  RATE_LIMITED: "El sitio respondió 429 (o 503 con Retry-After). EXEGEZIS esperó lo que pedía y bajó el ritmo, pero se superó el tope de espera.",
  FORBIDDEN: "Respuesta 403 sin desafío: el sitio rechaza esta IP, este país o una regla de su WAF. Reintentar no sirve. Si el sitio es tuyo, añade esta IP a la lista blanca o autoriza a EXEGEZIS con un token del WAF.",
  NETWORK_RESTRICTED: "El nombre no resuelve o la dirección es privada: el sitio solo es accesible desde una VPN, una intranet o un DNS privado. Conéctate a esa red y vuelve a intentarlo.",
};

export type BlockSolution = "window" | "http-auth" | "waf-token" | "relaunch" | "none";

export const BLOCK_SOLUTIONS: Record<BlockKind, BlockSolution[]> = {
  HTTP_AUTH: ["http-auth"],
  BOT_CHALLENGE: ["waf-token", "window"],
  SESSION_EXPIRED: ["window"],
  LOGIN_WALL: ["window"],
  CONSENT_WALL: ["window"],
  RATE_LIMITED: ["relaunch"],
  FORBIDDEN: ["waf-token"],
  NETWORK_RESTRICTED: ["none"],
};

export const WINDOW_BUTTON: Partial<Record<BlockKind, string>> = {
  LOGIN_WALL: "Abrir ventana para acceder",
  SESSION_EXPIRED: "Renovar la sesión",
  CONSENT_WALL: "Abrir ventana para elegir",
  BOT_CHALLENGE: "Pasar la verificación en una ventana",
};
