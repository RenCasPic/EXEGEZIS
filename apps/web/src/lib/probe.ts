import { ui, type UiMessage } from "./ui-message";

const CAUSES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "CERT_HAS_EXPIRED"]);

/**
 * Why a fetch failed, as a catalog key (common.errors.cause.*). Node wraps
 * the real reason: `localhost` resolves to both ::1 and 127.0.0.1, and the
 * failure is an AggregateError with an empty message whose inner errors
 * carry the code.
 */
export function describeFetchError(error: unknown): UiMessage {
  if (error instanceof Error && error.name === "TimeoutError") return ui("common.errors.cause.timeout");
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
    if (typeof code === "string") return CAUSES.has(code) ? ui(`common.errors.cause.${code}`) : ui("common.errors.cause.other", { detail: code });
  }
  const message = found.map((e) => e.message).find((m) => m.trim() !== "" && m !== "fetch failed");
  return message === undefined ? ui("common.errors.cause.unknown") : ui("common.errors.cause.other", { detail: message });
}

/**
 * Whether the target answers at all (any HTTP status counts: a 404 at the
 * root still means the application is running). Returns the problem, or null.
 */
export async function probeTarget(url: string, timeoutMs = 5000): Promise<UiMessage | null> {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return null;
  } catch (error) {
    return ui("common.errors.targetDown", { url, cause: describeFetchError(error) });
  }
}
