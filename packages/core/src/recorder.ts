import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { sha256 } from "./hash.js";
import { SequentialIds, ulid } from "./ids.js";
import { SecretRegistry } from "./redaction.js";
import { RelativePath } from "./schemas/common.js";
import {
  ArtifactManifest,
  type ArtifactEntry,
  type ArtifactType,
  type MissingArtifact,
  type RedactionStatus,
} from "./schemas/manifest.js";
import { RunMetadata } from "./schemas/run.js";
import {
  Timeline,
  TimelineEvent,
  type EventSource,
  type TimelineEventType,
  type TimelinePayload,
} from "./schemas/timeline.js";

export const RUN_FILES = {
  metadata: "metadata.json",
  manifest: "manifest.json",
  timeline: "timeline.json",
  /** Append-only event log written during the run; replaced by timeline.json on finalize. */
  timelinePartial: "timeline.partial.jsonl",
  log: "exegezis.log.jsonl",
} as const;

const SCANNABLE_MEDIA_TYPES = ["application/json", "application/x-ndjson", "text/"];

export interface RunRecorderOptions {
  /** Directory that contains run directories (e.g. `./runs`). */
  outputDir: string;
  runId?: string;
  now?: () => Date;
}

interface WriteOptions {
  description?: string;
}

/**
 * Owns a run directory and is the only writer of its artifacts.
 *
 * Invariants:
 * - The run directory is created once and never deleted or truncated, so a
 *   failed or interrupted run keeps everything captured up to that point.
 * - Timeline events are appended synchronously to `timeline.partial.jsonl`
 *   as they happen (crash-safe), then consolidated into `timeline.json`.
 * - `manifest.json` is rewritten after every artifact, so it is accurate at
 *   any moment. `complete: true` only after `finalize()`.
 * - Every text artifact is scrubbed of tracked secret values on write and
 *   again on finalize (secrets discovered late also get removed).
 */
export class RunRecorder {
  readonly secrets = new SecretRegistry();
  readonly ids = new SequentialIds();

  private readonly events: TimelineEvent[] = [];
  private readonly artifacts = new Map<string, ArtifactEntry>();
  private readonly missing = new Map<string, MissingArtifact>();
  private readonly startMonotonic = performance.now();
  private seq = 0;
  private finalized = false;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    readonly runId: string,
    readonly dir: string,
    private readonly now: () => Date,
  ) {}

  static async create(options: RunRecorderOptions): Promise<RunRecorder> {
    const now = options.now ?? (() => new Date());
    const runId = options.runId ?? ulid(now().getTime());
    await mkdir(options.outputDir, { recursive: true });
    const dir = join(options.outputDir, runId);
    // Non-recursive on purpose: fails with EEXIST instead of mixing two runs.
    await mkdir(dir);
    return new RunRecorder(runId, dir, now);
  }

  timestamp(): string {
    return this.now().toISOString();
  }

  elapsedMs(): number {
    return Math.round((performance.now() - this.startMonotonic) * 1000) / 1000;
  }

  /** Absolute path for a run-relative artifact path. */
  resolve(relativePath: string): string {
    RelativePath.parse(relativePath);
    return join(this.dir, ...relativePath.split("/"));
  }

  emit<T extends TimelineEventType>(type: T, source: EventSource, payload: TimelinePayload<T>): TimelineEvent {
    this.seq += 1;
    const event = TimelineEvent.parse({
      id: `evt-${String(this.seq).padStart(6, "0")}`,
      seq: this.seq,
      timestamp: this.timestamp(),
      elapsedMs: this.elapsedMs(),
      source,
      type,
      payload,
    });
    this.events.push(event);
    appendFileSync(
      this.resolve(RUN_FILES.timelinePartial),
      `${this.secrets.scrub(JSON.stringify(event))}\n`,
      "utf8",
    );
    return event;
  }

  get timeline(): readonly TimelineEvent[] {
    return this.events;
  }

  async writeJson(type: ArtifactType, path: string, value: unknown, options: WriteOptions = {}): Promise<ArtifactEntry> {
    return this.writeText(type, path, `${JSON.stringify(value, null, 2)}\n`, "application/json", options);
  }

  async writeText(
    type: ArtifactType,
    path: string,
    text: string,
    mediaType: string,
    options: WriteOptions = {},
  ): Promise<ArtifactEntry> {
    const scrubbed = this.secrets.scrub(text);
    const absolute = this.resolve(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, scrubbed, "utf8");
    const redaction: RedactionStatus = this.secrets.countLeaks(scrubbed) === 0 ? "verified" : "failed";
    return this.register(type, path, mediaType, Buffer.from(scrubbed, "utf8"), redaction, options);
  }

  async writeBinary(
    type: ArtifactType,
    path: string,
    data: Uint8Array,
    mediaType: string,
    options: WriteOptions = {},
  ): Promise<ArtifactEntry> {
    const absolute = this.resolve(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    return this.register(type, path, mediaType, data, "not_scannable", options);
  }

  /** Registers a file that another component already wrote inside the run directory. */
  async registerFile(
    type: ArtifactType,
    path: string,
    mediaType: string,
    redaction: RedactionStatus,
    options: WriteOptions = {},
  ): Promise<ArtifactEntry> {
    const data = await readFile(this.resolve(path));
    return this.register(type, path, mediaType, data, redaction, options);
  }

  markMissing(type: ArtifactType, reason: string): void {
    this.missing.set(type, { type, reason });
    this.queueManifestWrite();
  }

  async writeMetadata(metadata: RunMetadata): Promise<void> {
    const valid = RunMetadata.parse({ ...metadata, redaction: { ...metadata.redaction, secretValuesTracked: this.secrets.size } });
    await this.writeJson("metadata", RUN_FILES.metadata, valid, { description: "Run identity, environment and status" });
  }

  /**
   * Consolidates the timeline, re-scrubs all text artifacts with the final
   * set of known secrets, and marks the manifest complete. Safe to call once.
   */
  async finalize(): Promise<ArtifactManifest> {
    if (this.finalized) throw new Error(`Run ${this.runId} is already finalized`);
    await this.writeChain;

    const timeline = Timeline.parse({ schemaVersion: "exegezis.timeline/v1", runId: this.runId, events: this.events });
    await this.writeJson("timeline", RUN_FILES.timeline, timeline, { description: "Ordered events of the run" });
    if (existsSync(this.resolve(RUN_FILES.log))) {
      // Written by a JsonlFileSink during the run; scrubbed below like any text artifact.
      await this.registerFile("log", RUN_FILES.log, "application/x-ndjson", "verified", {
        description: "Structured EXEGEZIS log for this run",
      });
    }

    for (const entry of [...this.artifacts.values()]) {
      if (isScannable(entry.mediaType)) await this.rescrub(entry);
    }
    // The consolidated timeline now exists; the crash-safety copy is redundant.
    await rm(this.resolve(RUN_FILES.timelinePartial), { force: true });

    // Let queued (incomplete) manifest writes land before the final one.
    await this.writeChain;
    this.finalized = true;
    const manifest = this.buildManifest();
    await this.writeManifestNow(manifest);
    return manifest;
  }

  manifest(): ArtifactManifest {
    return this.buildManifest();
  }

  /** Waits for pending manifest writes (for callers that stop without finalizing). */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  private async rescrub(entry: ArtifactEntry): Promise<void> {
    const absolute = this.resolve(entry.path);
    let text: string;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      return;
    }
    const scrubbed = this.secrets.scrub(text);
    if (scrubbed !== text) await writeFile(absolute, scrubbed, "utf8");
    const buffer = Buffer.from(scrubbed, "utf8");
    this.artifacts.set(entry.path, {
      ...entry,
      sizeBytes: buffer.byteLength,
      sha256: sha256(buffer),
      redaction: this.secrets.countLeaks(scrubbed) === 0 ? "verified" : "failed",
    });
  }

  private register(
    type: ArtifactType,
    path: string,
    mediaType: string,
    data: Uint8Array,
    redaction: RedactionStatus,
    options: WriteOptions,
  ): ArtifactEntry {
    const entry: ArtifactEntry = {
      type,
      path,
      mediaType,
      sizeBytes: data.byteLength,
      sha256: sha256(data),
      createdAt: this.timestamp(),
      redaction,
      ...(options.description === undefined ? {} : { description: options.description }),
    };
    this.artifacts.set(path, entry);
    this.missing.delete(type);
    this.queueManifestWrite();
    return entry;
  }

  private buildManifest(): ArtifactManifest {
    return ArtifactManifest.parse({
      schemaVersion: "exegezis.manifest/v1",
      runId: this.runId,
      updatedAt: this.timestamp(),
      complete: this.finalized,
      artifacts: [...this.artifacts.values()].sort((a, b) => a.path.localeCompare(b.path)),
      missing: [...this.missing.values()],
    });
  }

  private queueManifestWrite(): void {
    this.writeChain = this.writeChain.then(
      () => this.writeManifestNow(this.buildManifest()),
      () => this.writeManifestNow(this.buildManifest()),
    );
  }

  private async writeManifestNow(manifest: ArtifactManifest): Promise<void> {
    await writeFile(this.resolve(RUN_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

function isScannable(mediaType: string): boolean {
  return SCANNABLE_MEDIA_TYPES.some((prefix) => mediaType.startsWith(prefix));
}

/** Reads and validates a run's manifest from disk. */
export function readManifest(runDir: string): ArtifactManifest {
  return ArtifactManifest.parse(JSON.parse(readFileSync(join(runDir, RUN_FILES.manifest), "utf8")));
}
