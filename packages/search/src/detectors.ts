import type { SearchDetector } from "@exegezis/core";

/*
 * Deterministic detectors for templates (no model): e-mail addresses, phone
 * numbers and dates already past. Each returns spans of the original text.
 */

export interface DetectorMatch {
  start: number;
  end: number;
  text: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}(?![\w])/g;

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).join("|");
const DATE_PATTERNS: { pattern: RegExp; parse: (m: RegExpExecArray) => [number, number, number] | null }[] = [
  // 2024-05-01
  { pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/g, parse: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // 01/05/2024 (day first, as in Spanish)
  { pattern: /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g, parse: (m) => [Number(m[3]), Number(m[2]), Number(m[1])] },
  // 1 de mayo de 2024 · 1 May 2024
  { pattern: new RegExp(`\\b(\\d{1,2})(?:\\s+de)?\\s+(${MONTH_NAMES})(?:\\s+de|,)?\\s+(\\d{4})\\b`, "giu"), parse: (m) => [Number(m[3]), MONTHS[(m[2] ?? "").toLowerCase()] ?? 0, Number(m[1])] },
  // May 1, 2024
  { pattern: new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "giu"), parse: (m) => [Number(m[3]), MONTHS[(m[1] ?? "").toLowerCase()] ?? 0, Number(m[2])] },
];

function valid(y: number, mo: number, d: number): boolean {
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function all(pattern: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push(m);
    if (m[0] === "") re.lastIndex += 1;
  }
  return out;
}

export function detect(detector: SearchDetector, text: string, now: Date): DetectorMatch[] {
  switch (detector) {
    case "email":
      return all(EMAIL, text).map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
    case "phone":
      return all(PHONE, text)
        .filter((m) => {
          const digits = m[0].replace(/\D/g, "").length;
          // Not a date or a year range.
          return digits >= 8 && digits <= 15 && !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(m[0]) && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(m[0]);
        })
        .map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
    case "past-date": {
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const found: DetectorMatch[] = [];
      for (const { pattern, parse } of DATE_PATTERNS) {
        for (const m of all(pattern, text)) {
          const ymd = parse(m);
          if (ymd === null || !valid(...ymd)) continue;
          if (Date.UTC(ymd[0], ymd[1] - 1, ymd[2]) >= today) continue;
          if (found.some((f) => m.index < f.end && m.index + m[0].length > f.start)) continue;
          found.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        }
      }
      return found.sort((a, b) => a.start - b.start);
    }
  }
}

export const DETECTOR_LABEL: Record<SearchDetector, string> = {
  email: "correo electrónico",
  phone: "teléfono",
  "past-date": "fecha pasada",
};
