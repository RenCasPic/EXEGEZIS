/** One query parameter as a string ("" when absent; the first value when repeated). */
export function param(params: Record<string, string | string[] | undefined>, name: string): string {
  const v = params[name];
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
}
