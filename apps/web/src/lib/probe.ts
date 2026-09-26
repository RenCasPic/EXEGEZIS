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
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error);
    return `The target ${url} did not respond (${cause}). Start the application first; the planner was not called.`;
  }
}
