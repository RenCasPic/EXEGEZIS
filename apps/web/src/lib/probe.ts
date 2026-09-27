const CAUSES: Record<string, string> = {
  ECONNREFUSED: "connection refused: nothing is listening at that address",
  ENOTFOUND: "the name does not resolve",
  EAI_AGAIN: "the name could not be resolved right now (DNS)",
  ETIMEDOUT: "the connection timed out",
  ECONNRESET: "the connection was reset",
  CERT_HAS_EXPIRED: "its TLS certificate has expired",
};

/**
 * Why a fetch failed, in words. Node wraps the real reason: `localhost`
 * resolves to both ::1 and 127.0.0.1, and the failure is an AggregateError
 * with an empty message whose inner errors carry the code.
 */
export function describeFetchError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "no answer within the time limit";
  const found: Error[] = [];
  const visit = (e: unknown) => {
    if (!(e instanceof Error)) return;
    found.push(e);
    if (e instanceof AggregateError) for (const inner of e.errors) visit(inner);
    visit(e.cause);
  };
  visit(error);
  for (const e of found) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return CAUSES[code] ?? code;
  }
  return found.map((e) => e.message).find((m) => m.trim() !== "" && m !== "fetch failed") ?? "unknown network error";
}

/**
 * Whether the target answers at all (any HTTP status counts: a 404 at the
 * root still means the application is running). Returns the problem, or null.
 */
export async function probeTarget(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return null;
  } catch (error) {
    return `The target ${url} did not respond (${describeFetchError(error)}). Start the application first, or check the Target URL; the planner was not called.`;
  }
}
