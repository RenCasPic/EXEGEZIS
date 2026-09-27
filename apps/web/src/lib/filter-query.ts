/**
 * The URL a filter form leads to: every non-empty field, in form order
 * (hidden fields such as the active status tab included). null when it is
 * the same as the current query, so nothing navigates for nothing.
 */
export function filterHref(pathname: string, fields: Iterable<[string, FormDataEntryValue]>, current: string): string | null {
  const next = new URLSearchParams();
  for (const [k, v] of fields) if (typeof v === "string" && v.trim() !== "") next.set(k, v.trim());
  const query = next.toString();
  if (query === new URLSearchParams(current).toString()) return null;
  return query === "" ? pathname : `${pathname}?${query}`;
}

/** Waits for the typing to pause before searching. */
export const FILTER_DEBOUNCE_MS = 300;
