import { join } from "node:path";
import {
  AccessibilityFile,
  ArtifactManifest,
  AssertionsFile,
  ConsoleFile,
  NetworkFile,
  ObservationsFile,
  RunMetadata,
  Timeline,
} from "@exegezis/core";
import { isInside } from "../workspace";
import type { InvestigationRef } from "./discover";
import { readArtifact, type Loaded } from "./read";

/** The evidence bundle of one attempt, each file checked against its core schema. */
export interface AttemptEvidence {
  runPath: string;
  metadata: Loaded<RunMetadata>;
  manifest: Loaded<ArtifactManifest>;
  timeline: Loaded<Timeline>;
  assertions: Loaded<AssertionsFile>;
  console: Loaded<ConsoleFile>;
  network: Loaded<NetworkFile>;
  observations: Loaded<ObservationsFile>;
  accessibility: Loaded<AccessibilityFile>;
}

export async function loadAttempt(ref: InvestigationRef, runPath: string): Promise<AttemptEvidence | null> {
  const dir = join(ref.dir, runPath);
  if (!isInside(ref.dir, dir) || dir === ref.dir) return null;
  const [metadata, manifest, timeline, assertions, console, network, observations, accessibility] = await Promise.all([
    readArtifact(join(dir, "metadata.json"), RunMetadata),
    readArtifact(join(dir, "manifest.json"), ArtifactManifest),
    readArtifact(join(dir, "timeline.json"), Timeline),
    readArtifact(join(dir, "assertions.json"), AssertionsFile),
    readArtifact(join(dir, "console.json"), ConsoleFile),
    readArtifact(join(dir, "network.json"), NetworkFile),
    readArtifact(join(dir, "observations.json"), ObservationsFile),
    readArtifact(join(dir, "accessibility.json"), AccessibilityFile),
  ]);
  return { runPath, metadata, manifest, timeline, assertions, console, network, observations, accessibility };
}
