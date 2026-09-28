"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** A command to run in a terminal, with a button that copies it. */
export function CopyCommand({ command, label, className }: { command: string; label?: string; className?: string }) {
  const t = useTranslations("common.copy");
  const [copied, setCopied] = useState(false);
  const name = label ?? t("copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. not a secure context): the command stays selectable.
    }
  };
  return (
    <div className={cn("flex items-stretch overflow-hidden rounded-md border border-line-strong bg-sunken", className)}>
      <code className="min-w-0 flex-1 overflow-x-auto px-3 py-2 font-mono text-[13px] whitespace-nowrap text-fg select-all">{command}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`${name}: ${command}`}
        className="flex shrink-0 items-center gap-1.5 border-l border-line-strong px-3 text-[12px] text-muted hover:bg-hover hover:text-fg"
      >
        {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        <span aria-live="polite">{copied ? t("copied") : name}</span>
      </button>
    </div>
  );
}

/** The fixes the CLI proposes, in the reader's language (the CLI's text is English); unknown lines are shown as they are. */
function remedyText(t: (key: "install" | "doctor" | "installed") => string, line: string, command: string | null): string {
  if (command === "pnpm exegezis doctor --install") return t("install");
  if (command === "pnpm exegezis doctor") return t("doctor");
  if (/Google Chrome|Microsoft Edge/.test(line) && /--browser-channel auto/.test(line)) return t("installed");
  return command === null ? line : line.replace(command, "").replace(/:\s*$/, "");
}

/** The ENGINE_ERROR / no-browser explanation, with each fix copyable. */
export function EngineProblem({ message, remedy, detail }: { message: string; remedy: string[]; detail?: string[] }) {
  const t = useTranslations("common.engineProblem");
  const commands = remedy.map((r) => /pnpm exegezis [^\s]+(?: --\S+)*/.exec(r)?.[0] ?? null);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-bad/30 bg-bad-bg p-4 text-[13px] text-fg">
      <div>
        <strong className="block text-[14px] font-semibold text-bad">{t("title")}</strong>
        <span className="text-fg">{message}</span>
      </div>
      {detail !== undefined && detail.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 font-mono text-[11px] break-all text-muted" translate="no">
          {detail.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-fg">{t("howTo")}</span>
        {remedy.map((r, i) => {
          const command = commands[i];
          return command === null || command === undefined ? (
            <p key={r} className="text-[12px] text-muted">
              {remedyText(t, r, null)}
            </p>
          ) : (
            <div key={r} className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">{remedyText(t, r, command)}</span>
              <CopyCommand command={command} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
