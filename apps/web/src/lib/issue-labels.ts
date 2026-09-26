import { parseHex, type IssueGroup } from "@exegezis/core";

/**
 * Plain-language (Spanish) wording for issue groups. It only rephrases what
 * the group already holds (colours, ratios, messages); nothing is inferred.
 */

function hsl(hex: string): [number, number, number] | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** A rough Spanish colour name ("gris", "azul oscuro", "casi blanco"…), always shown next to the hex. */
export function colorName(hex: string): string {
  const v = hsl(hex);
  if (v === null) return "color";
  const [h, s, l] = v;
  if (l >= 0.97) return "blanco";
  if (l >= 0.92 && s < 0.6) return "casi blanco";
  if (l <= 0.06) return "negro";
  const tone = l >= 0.72 ? " claro" : l <= 0.3 ? " oscuro" : "";
  if (s < 0.12) return `gris${tone}`;
  if (s < 0.3) {
    const tint = h >= 190 && h < 260 ? "azulado" : h >= 20 && h < 60 ? "cálido" : "";
    return `gris ${tint}${tone}`.replace(/\s+/g, " ").trim();
  }
  const hue =
    h < 15 || h >= 345 ? "rojo" : h < 45 ? "naranja" : h < 65 ? "amarillo" : h < 170 ? "verde" : h < 200 ? "cian" : h < 255 ? "azul" : h < 290 ? "morado" : "rosa";
  return `${hue}${tone}`;
}

const fmt = (n: number) => String(n).replace(".", ",");

export function groupTitleEs(g: IssueGroup): string {
  if (g.contrast !== null) {
    const c = g.contrast;
    return `Texto ${colorName(c.foreground)} ${c.foreground.toUpperCase()} sobre ${colorName(c.background)} ${c.background.toUpperCase()}: contraste ${fmt(c.ratio)}:1, mínimo ${fmt(c.required)}:1${c.textSize === "large" ? " (texto grande)" : ""}`;
  }
  switch (g.checkId) {
    case "console-errors":
      return g.title.replace(/^Console error: /, "Error de consola: ");
    case "js-exceptions":
      return g.title.replace(/^Uncaught exception: /, "Excepción JS no capturada: ");
    case "failed-requests":
      return `Petición fallida: ${g.title}`;
    case "broken-links":
      return g.title.replace(/^Broken link to /, "Enlace roto a ");
    case "mixed-content":
      return g.title.replace(/^Mixed content/, "Contenido mixto");
    case "a11y":
      return `Accesibilidad: ${g.title}`;
    default:
      return g.title;
  }
}

export const GROUP_VERDICT_TEXT: Record<IssueGroup["verdict"], string> = {
  VERIFIED: "presente en todas las repeticiones",
  INTERMITTENT: "solo en algunas repeticiones",
  MIXED: "algunos elementos solo en algunas repeticiones",
};
