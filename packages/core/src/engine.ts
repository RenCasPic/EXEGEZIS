import { z } from "zod";

/**
 * The execution engine itself could not start on this machine (e.g. no
 * browser to drive). It is a fact about the local environment, never about
 * the target: no verdict about the site or the application may come from it.
 * executeRun records the run and rethrows it, so every command aborts on the
 * first attempt instead of turning it into UNREACHABLE or INCONCLUSIVE.
 */
export const EngineAttempt = z.strictObject({
  /** What was tried, e.g. "chromium (Playwright)", "chrome", "msedge". */
  engine: z.string(),
  error: z.string(),
});
export type EngineAttempt = z.infer<typeof EngineAttempt>;

export const EngineErrorInfo = z.strictObject({
  message: z.string(),
  /** Every engine that was tried, in order, and why it failed. */
  attempts: z.array(EngineAttempt),
  /** What to do about it, as commands the user can run (Windows CMD and macOS/Linux). */
  remedy: z.array(z.string()),
});
export type EngineErrorInfo = z.infer<typeof EngineErrorInfo>;

export class EngineUnavailableError extends Error {
  override readonly name = "EngineUnavailableError";
  readonly attempts: EngineAttempt[];
  readonly remedy: string[];

  constructor(message: string, attempts: EngineAttempt[], remedy: string[]) {
    super(message);
    this.attempts = attempts;
    this.remedy = remedy;
  }

  toInfo(): EngineErrorInfo {
    return { message: this.message, attempts: this.attempts, remedy: this.remedy };
  }
}

export function isEngineUnavailable(error: unknown): error is EngineUnavailableError {
  return error instanceof EngineUnavailableError || (error instanceof Error && error.name === "EngineUnavailableError" && "remedy" in error);
}
