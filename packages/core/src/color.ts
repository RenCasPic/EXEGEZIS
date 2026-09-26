/**
 * WCAG 2.1 colour arithmetic, deterministic and dependency-free: contrast
 * ratios, and the nearest foreground colour (same hue and saturation, only
 * the lightness changes) that reaches a required ratio.
 */
export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return null;
  let h = (m[1] as string).toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded down to 2 decimals: a displayed ratio never looks better than the real one. */
export function displayRatio(ratio: number): number {
  return Math.floor(ratio * 100) / 100;
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/**
 * The closest foreground colour to `foreground` (same hue and saturation,
 * lightness moved in steps of 0.5 %, darker first on a tie) whose contrast
 * against `background` reaches `required`, checked after rounding to hex.
 * null if no lightness works (cannot happen for ratios ≤ 21:1, kept for safety).
 */
export function suggestForeground(foreground: string, background: string, required: number): { color: string; ratio: number } | null {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (fg === null || bg === null) return null;
  if (contrastRatio(fg, bg) >= required) return { color: toHex(fg), ratio: displayRatio(contrastRatio(fg, bg)) };
  const [h, s, l] = toHsl(fg);
  for (let step = 1; step <= 200; step++) {
    for (const dir of [-1, 1]) {
      const nl = l + dir * step * 0.005;
      if (nl < 0 || nl > 1) continue;
      const candidate = parseHex(toHex(fromHsl([h, s, nl]))) as Rgb;
      const ratio = contrastRatio(candidate, bg);
      if (ratio >= required) return { color: toHex(candidate), ratio: displayRatio(ratio) };
    }
  }
  return null;
}
