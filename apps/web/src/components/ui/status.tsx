import type { VerificationOutcome } from "@exegezis/core";
import { label, outcomeTone, type Tone } from "@/lib/evidence/stages";
import { cn } from "@/lib/cn";

const TONE: Record<Tone, string> = {
  positive: "text-positive border-positive/35 bg-positive/10",
  negative: "text-negative border-negative/35 bg-negative/10",
  critical: "text-critical border-critical/35 bg-critical/10",
  warning: "text-warning border-warning/35 bg-warning/10",
  neutral: "text-neutral border-line-strong bg-panel-2",
  running: "text-running border-running/40 bg-running/10",
  unimplemented: "text-faint border-dashed border-line-strong bg-transparent",
};

const DOT: Record<Tone, string> = {
  positive: "bg-positive",
  negative: "bg-negative",
  critical: "bg-critical",
  warning: "bg-warning",
  neutral: "bg-neutral",
  running: "bg-running animate-pulse-dot",
  unimplemented: "border border-faint bg-transparent",
};

export function toneText(tone: Tone): string {
  return TONE[tone].split(" ")[0] ?? "";
}

/** The one way a status is displayed: its exact name, coloured by family. */
export function StatusPill({ status, tone, size = "sm", title }: { status: string; tone: Tone; size?: "xs" | "sm"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border font-mono font-medium uppercase tracking-wide",
        size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]",
        TONE[tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden />
      {status}
    </span>
  );
}

export function OutcomePill({ outcome, size }: { outcome: VerificationOutcome | null; size?: "xs" | "sm" }) {
  if (outcome === null) return <StatusPill status="NOT RUN" tone="neutral" {...(size === undefined ? {} : { size })} />;
  return <StatusPill status={label(outcome)} tone={outcomeTone(outcome)} {...(size === undefined ? {} : { size })} />;
}

export function NotImplemented({ size }: { size?: "xs" | "sm" }) {
  return <StatusPill status="NOT IMPLEMENTED" tone="unimplemented" {...(size === undefined ? {} : { size })} />;
}

/** Where a piece of data comes from. There is no demo data in this UI. */
export function SourceTag({ kind }: { kind: "real" | "archived" }) {
  return kind === "real" ? (
    <span className="rounded border border-positive/30 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-positive">Real evidence</span>
  ) : (
    <span className="rounded border border-line-strong px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted">Archived result</span>
  );
}
