import { Check, Circle, CircleDashed, Minus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StageState, Tone } from "@/lib/evidence/stages";
import { cn } from "@/lib/cn";
import { STAGE_ANCHOR } from "@/lib/urls";
import { StatusPill } from "@/components/ui/status";
import { useStageDetailText } from "./stage-detail";

function StageIcon({ tone }: { tone: Tone }) {
  const base = "size-3.5";
  switch (tone) {
    case "ok":
      return <Check className={cn(base, "text-ok")} />;
    case "bad":
    case "off":
      return <X className={cn(base, "text-bad")} />;
    case "warn":
      return <Minus className={cn(base, "text-warn")} />;
    case "running":
      return <Circle className={cn(base, "animate-pulse-dot fill-q text-q")} />;
    case "unimplemented":
      return <CircleDashed className={cn(base, "text-faint")} />;
    case "q":
      return <Circle className={cn(base, "text-q")} />;
  }
}

/**
 * Symptom → AI Plan → Reproduction → Evidence → Investigation → Root Cause →
 * Fix → Verification, each with the status its artifacts support. Every
 * stage links to its section.
 */
export function InvestigationPipeline({ stages }: { stages: StageState[] }) {
  const t = useTranslations("investigations.pipeline");
  const common = useTranslations("common.stages");
  const detail = useStageDetailText();
  return (
    <nav aria-label={t("label")} className="overflow-x-auto rounded-lg border border-line bg-panel">
      <ol className="flex min-w-max">
        {stages.map((stage, i) => (
          <li key={stage.id} className="flex flex-1 items-stretch">
            <a
              href={`#${STAGE_ANCHOR[stage.id] ?? stage.id}`}
              title={detail(stage.detail)}
              className={cn(
                "group flex min-w-36 flex-1 flex-col gap-2 px-3.5 py-3 transition-colors hover:bg-hover/60",
                stage.tone === "unimplemented" && "opacity-75",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className={cn("grid size-5 place-items-center rounded-full border", stage.tone === "unimplemented" ? "border-dashed border-line-strong" : "border-line-strong bg-panel-2")}>
                  <StageIcon tone={stage.tone} />
                </span>
                <span className="font-mono text-[10px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[13px] font-medium text-fg group-hover:underline group-hover:underline-offset-4">{common(`${stage.id}.label`)}</span>
              </span>
              <span className="self-start">
                <StatusPill status={stage.status} tone={stage.tone} size="xs" />
              </span>
            </a>
            {i < stages.length - 1 && (
              <span aria-hidden className="flex items-center">
                <span className={cn("h-px w-3", stages[i + 1]?.tone === "unimplemented" ? "border-t border-dashed border-line-strong" : "bg-line-strong")} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
