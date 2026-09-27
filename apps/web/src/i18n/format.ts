import type { Locale } from "./locales";

/*
 * Dates, times, numbers, money and relative times in the active language
 * (Intl). Pure: the same functions on the server and in the browser.
 */

export interface Format {
  locale: Locale;
  /** "5 min ago" / "hace 5 min". */
  relative: (iso: string | null, now?: number) => string;
  /** Stable absolute timestamp, in UTC, for evidence and tooltips. */
  absolute: (iso: string | null) => string;
  /** 1.5 s / 1,5 s · 2 min 5 s · 1 h 3 min. */
  duration: (ms: number | null | undefined) => string;
  number: (n: number, digits?: number) => string;
  percent: (value: number | null | undefined, digits?: number) => string;
  usd: (n: number) => string;
  bytes: (n: number) => string;
}

export function formatFor(locale: Locale): Format {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });
  const num = (n: number, min = 0, max = min) => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max }).format(n);
  return {
    locale,
    relative(iso, now = Date.now()) {
      if (iso === null) return "—";
      const diff = Date.parse(iso) - now;
      if (Number.isNaN(diff)) return "—";
      const s = Math.round(diff / 1000);
      if (Math.abs(s) < 45) return rtf.format(0, "second");
      const m = Math.round(s / 60);
      if (Math.abs(m) < 60) return rtf.format(m, "minute");
      const h = Math.round(m / 60);
      if (Math.abs(h) < 24) return rtf.format(h, "hour");
      return rtf.format(Math.round(h / 24), "day");
    },
    absolute(iso) {
      if (iso === null) return "—";
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : `${dtf.format(date)} UTC`;
    },
    duration(ms) {
      if (ms === null || ms === undefined) return "—";
      if (ms < 1000) return `${num(Math.round(ms))} ms`;
      const s = ms / 1000;
      if (s < 60) return `${num(s, 0, s < 10 ? 1 : 0)} s`;
      const m = Math.floor(s / 60);
      const rest = Math.round(s - m * 60);
      if (m < 60) return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
      const h = Math.floor(m / 60);
      return `${h} h ${m - h * 60} min`;
    },
    number: (n, digits = 0) => num(n, 0, digits),
    percent(value, digits = 0) {
      if (value === null || value === undefined || Number.isNaN(value)) return "—";
      return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    },
    usd: (n) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2 }).format(n),
    bytes(n) {
      if (n < 1024) return `${num(n)} B`;
      if (n < 1024 * 1024) return `${num(n / 1024, 1, 1)} KB`;
      return `${num(n / 1024 / 1024, 1, 1)} MB`;
    },
  };
}
