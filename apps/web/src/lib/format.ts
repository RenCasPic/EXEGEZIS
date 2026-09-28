/*
 * Language-neutral helpers. Dates, numbers, money and relative times in the
 * reader's language live in src/i18n/format.ts (Intl).
 */

/** HH:MM:SS.mmm (UTC) of an evidence timestamp: the same in every language. */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(11, 23);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** A recorded JSON value as it was (strings quoted). */
export function compactJson(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? "undefined";
}
