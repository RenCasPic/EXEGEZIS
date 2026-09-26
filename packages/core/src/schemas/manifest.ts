import { z } from "zod";
import { RelativePath, RunId, Timestamp } from "./common.js";

export const ArtifactType = z.enum([
  "metadata",
  "plan",
  "timeline",
  "assertions",
  "console",
  "execution_errors",
  "network",
  "accessibility",
  "observations",
  "dom_snapshot",
  "screenshot",
  "trace",
  "log",
  "coverage",
  "inspection",
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

/**
 * - `verified`: redaction applied and the content was scanned afterwards; no
 *   tracked secret value remains.
 * - `failed`: the post-redaction scan still found tracked secret values.
 * - `not_scannable`: binary content (e.g. PNG) that cannot be scanned; it may
 *   visually contain sensitive data.
 */
export const RedactionStatus = z.enum(["verified", "failed", "not_scannable"]);
export type RedactionStatus = z.infer<typeof RedactionStatus>;

export const ArtifactEntry = z.strictObject({
  type: ArtifactType,
  path: RelativePath,
  mediaType: z.string(),
  sizeBytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: Timestamp,
  redaction: RedactionStatus,
  description: z.string().optional(),
});
export type ArtifactEntry = z.infer<typeof ArtifactEntry>;

export const MissingArtifact = z.strictObject({
  type: ArtifactType,
  reason: z.string(),
});
export type MissingArtifact = z.infer<typeof MissingArtifact>;

/**
 * The index of a run directory. It is rewritten after every artifact is
 * recorded, so even an interrupted run has an accurate list of what exists.
 * The manifest does not list itself.
 */
export const ArtifactManifest = z.strictObject({
  schemaVersion: z.literal("exegezis.manifest/v1"),
  runId: RunId,
  updatedAt: Timestamp,
  complete: z.boolean(),
  artifacts: z.array(ArtifactEntry),
  missing: z.array(MissingArtifact),
});
export type ArtifactManifest = z.infer<typeof ArtifactManifest>;
