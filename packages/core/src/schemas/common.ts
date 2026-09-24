import { z } from "zod";
import { ULID_PATTERN } from "../ids.js";

/** ISO-8601 timestamp with offset (always produced as UTC `Z` by EXEGEZIS). */
export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

export const RunId = z.string().regex(ULID_PATTERN, "runId must be a ULID");
export type RunId = z.infer<typeof RunId>;

/** Path relative to the run directory, always using forward slashes. */
export const RelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[a-zA-Z]:/.test(p) && !p.split("/").includes(".."), {
    message: "must be a relative path inside the run directory",
  })
  .refine((p) => !p.includes("\\"), { message: "must use forward slashes" });

export const ErrorInfo = z.strictObject({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});
export type ErrorInfo = z.infer<typeof ErrorInfo>;

export const Viewport = z.strictObject({
  width: z.int().positive(),
  height: z.int().positive(),
});
export type Viewport = z.infer<typeof Viewport>;

/** Converts anything thrown into a serializable ErrorInfo. */
export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    return error.stack === undefined
      ? { name: error.name, message: error.message }
      : { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "NonError", message: String(error) };
}
