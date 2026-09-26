import type {
  ConsoleFile,
  EvidenceRef,
  InspectionObservation,
  NetworkFile,
  ObservationsFile,
  PageInspectionFile,
  Severity,
} from "@exegezis/core";

/** What a check may look at: everything the adapter recorded for one page in one run. */
export interface PageEvidence {
  /** Normalized page URL. */
  page: string;
  origin: string;
  depth: number;
  run: number;
  /** Run directory, relative to the inspection directory. */
  runPath: string;
  console: ConsoleFile;
  network: NetworkFile;
  inspection: PageInspectionFile;
  observations: ObservationsFile | null;
  /** Status of every internal link of the page (visited, probed with GET, or skipped). */
  links: LinkStatus[];
  hasTrace: boolean;
}

export interface LinkStatus {
  url: string;
  /** null when the link was not checked (robots.txt, budget) or the request failed. */
  status: number | null;
  error: string | null;
  checked: boolean;
}

/**
 * A deterministic check: a pure function of the page's evidence. No model
 * is involved in inspection. Add a check by adding a module to CHECKS.
 */
export interface Check {
  id: string;
  version: string;
  description: string;
  /** Default severity; a check may assign per observation (e.g. axe impact). */
  severity: Severity;
  run(evidence: PageEvidence): InspectionObservation[];
}

/** The part of a message that is the same on every run (up to the first number), for assertions. */
export function stableFragment(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const beforeDigits = clean.split(/\d/)[0]?.trim() ?? "";
  const fragment = beforeDigits.length >= 16 ? beforeDigits : clean;
  return fragment.slice(0, 120);
}

/** Same-origin URLs as a path (so a spec can be pointed elsewhere with BASE_URL), others absolute. */
export function portableUrl(url: string, origin: string): string {
  try {
    const u = new URL(url);
    return u.origin === origin ? `${u.pathname}${u.search}` : `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Evidence every finding of a page shares: screenshot, DOM, trace of that visit. */
export function pageEvidence(e: PageEvidence, extra: EvidenceRef[] = []): EvidenceRef[] {
  const refs: EvidenceRef[] = [...extra];
  const shot = e.observations?.screenshots[0];
  if (shot !== undefined) refs.push({ kind: "screenshot", path: `${e.runPath}/${shot.path}`, ref: shot.id, description: "Page after it settled" });
  const dom = e.observations?.domSnapshots[0];
  if (dom !== undefined) refs.push({ kind: "dom", path: `${e.runPath}/${dom.path}`, ref: dom.id, description: "DOM after it settled" });
  if (e.hasTrace) refs.push({ kind: "trace", path: `${e.runPath}/trace.zip`, description: "Playwright trace of the visit" });
  return refs;
}
