import type { EvidenceLevel, VerificationOutcome } from "@exegezis/core";
import { CircleCheck, CircleDashed, CircleHelp, CircleMinus, OctagonX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { label, outcomeTone, type Tone } from "@/lib/evidence/stages";
import { EVIDENCE_LEVELS, evidenceLevelIndex, verdictTone, type RunMark } from "@/lib/verdicts";

/*
 * The design system's status components (docs/08-design-system.md). A
 * verdict is always colour + icon + text; blue never appears here.
 */

const TONE: Record<Tone, string> = {
  ok: "text-ok bg-ok-bg border-ok/30",
  warn: "text-warn bg-warn-bg border-warn/30",
  q: "text-q bg-q-bg border-q/25",
  off: "text-off bg-off-bg border-off/25",
  bad: "text-bad bg-bad-bg border-bad/30",
  running: "text-q bg-q-bg border-q/25",
  unimplemented: "text-muted border-dashed border-line-strong bg-transparent",
};

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  const c = cn("shrink-0", className);
  switch (tone) {
    case "ok":
      return <CircleCheck className={c} aria-hidden />;
    case "warn":
      return <TriangleAlert className={c} aria-hidden />;
    case "q":
      return <CircleHelp className={c} aria-hidden />;
    case "off":
      return <CircleMinus className={c} aria-hidden />;
    case "bad":
      return <OctagonX className={c} aria-hidden />;
    case "running":
      return <span className={cn("animate-pulse-dot rounded-full bg-q", c, "size-1.5")} aria-hidden />;
    case "unimplemented":
      return <CircleDashed className={c} aria-hidden />;
  }
}

export function toneText(tone: Tone): string {
  return TONE[tone].split(" ")[0] ?? "";
}

/** The one way a status is displayed: its exact name, its family's colour and icon. */
export function StatusPill({ status, tone, size = "sm", title }: { status: string; tone: Tone; size?: "xs" | "sm"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-semibold tracking-wide",
        size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]",
        TONE[tone],
      )}
    >
      <ToneIcon tone={tone} className={size === "xs" ? "size-3" : "size-3.5"} />
      {status}
    </span>
  );
}

/** A verdict by name (VERIFIED, REFUTED, INTERMITTENT, FALSE VALIDATION…), coloured by its family. */
export function VerdictPill({ verdict, size, title }: { verdict: string; size?: "xs" | "sm"; title?: string }) {
  return <StatusPill status={label(verdict)} tone={verdictTone(verdict)} {...(size === undefined ? {} : { size })} {...(title === undefined ? {} : { title })} />;
}

export function OutcomePill({ outcome, size }: { outcome: VerificationOutcome | null; size?: "xs" | "sm" }) {
  if (outcome === null) return <StatusPill status="NOT RUN" tone="q" {...(size === undefined ? {} : { size })} />;
  return <StatusPill status={label(outcome)} tone={outcomeTone(outcome)} {...(size === undefined ? {} : { size })} />;
}

/** Something EXEGEZIS cannot do yet: dashed outline, no fill. */
export function NotImplemented({ size }: { size?: "xs" | "sm" }) {
  return <StatusPill status="NOT IMPLEMENTED" tone="unimplemented" {...(size === undefined ? {} : { size })} />;
}

/** Where a piece of data comes from. There is no demo data in this UI. */
export function SourceTag({ kind }: { kind: "real" | "archived" }) {
  return kind === "real" ? (
    <span className="whitespace-nowrap rounded border border-line-strong px-1.5 py-px text-[11px] text-muted">Real evidence</span>
  ) : (
    <span className="whitespace-nowrap rounded border border-line-strong px-1.5 py-px text-[11px] text-muted">Archived result</span>
  );
}

/** A recorded model response replayed (mock planner): never a live AI result. */
export function ReplayTag({ children = "REPLAY", title }: { children?: ReactNode; title?: string }) {
  return (
    <span title={title} className="bg-stripes inline-flex shrink-0 items-center rounded border border-line-strong px-1.5 py-px text-[10px] font-semibold tracking-wide text-fg">
      {children}
    </span>
  );
}

const LEVEL_LABEL: Record<EvidenceLevel, string> = {
  NONE: "None",
  REPRODUCED: "Reproduced",
  SUFFICIENT: "Sufficient",
  CANDIDATE: "Candidate",
  VALIDATED: "Validated",
};

/**
 * How far the evidence for a bug goes: NONE → REPRODUCED → SUFFICIENT →
 * CANDIDATE → VALIDATED. `null` means nothing was measured (shown as "—").
 */
export function EvidenceMeter({ level, labels = LEVEL_LABEL }: { level: EvidenceLevel | null; labels?: Record<EvidenceLevel, string> }) {
  const index = level === null ? -1 : evidenceLevelIndex(level);
  const tone: Tone = level === "VALIDATED" ? "ok" : level === "CANDIDATE" || level === "SUFFICIENT" ? "warn" : "q";
  const fill = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-q";
  const text = level === null ? "—" : labels[level];
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={`Evidence: ${text}${level === null ? "" : ` (${index + 1} of ${EVIDENCE_LEVELS.length})`}`}>
      <span className="flex gap-0.5" aria-hidden>
        {EVIDENCE_LEVELS.map((l, i) => (
          <span key={l} className={cn("h-2 w-3 rounded-[2px]", i <= index ? fill : "border border-line-strong")} />
        ))}
      </span>
      <span className={cn("text-[12px]", level === null ? "text-faint" : toneText(tone))} aria-hidden>
        {text}
      </span>
    </span>
  );
}

/** One dot per run, oldest first: ok filled, q filled, off outlined. */
export function RunHistory({ runs, label: name = "Runs" }: { runs: readonly RunMark[]; label?: string }) {
  if (runs.length === 0) return <span className="text-[12px] text-faint">—</span>;
  const count = (m: RunMark) => runs.filter((r) => r === m).length;
  const description = `${name}: ${count("ok")} proven, ${count("q")} inconclusive, ${count("off")} not proven`;
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={description} title={description}>
      {runs.map((r, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("size-2 rounded-full", r === "ok" ? "bg-ok" : r === "q" ? "bg-q" : "border border-off")}
        />
      ))}
    </span>
  );
}
