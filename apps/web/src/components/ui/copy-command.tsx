"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** A command to run in a terminal, with a button that copies it. */
export function CopyCommand({ command, label = "Copiar", className }: { command: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
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
        aria-label={`${label}: ${command}`}
        className="flex shrink-0 items-center gap-1.5 border-l border-line-strong px-3 text-[12px] text-muted hover:bg-hover hover:text-fg"
      >
        {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        <span aria-live="polite">{copied ? "Copiado" : label}</span>
      </button>
    </div>
  );
}

/** Spanish wording for the fixes the CLI proposes (its own text is English); unknown lines are shown as they are. */
function remedyText(line: string, command: string | null): string {
  if (command === "pnpm exegezis doctor --install") return "Instala el Chromium de Playwright (descarga unos 150 MB, solo cuando ejecutas esto):";
  if (command === "pnpm exegezis doctor") return "Comprueba qué navegadores tiene este equipo y qué falta:";
  if (/Google Chrome|Microsoft Edge/.test(line) && /--browser-channel auto/.test(line)) {
    return "O usa un navegador que ya esté instalado: Google Chrome (https://www.google.com/chrome/) o Microsoft Edge (viene con Windows), con el navegador en «Automático» (--browser-channel auto).";
  }
  return command === null ? line : line.replace(command, "").replace(/:\s*$/, "");
}

/** The ENGINE_ERROR / no-browser explanation, with each fix copyable. */
export function EngineProblem({ message, remedy, detail }: { message: string; remedy: string[]; detail?: string[] }) {
  const commands = remedy.map((r) => /pnpm exegezis [^\s]+(?: --\S+)*/.exec(r)?.[0] ?? null);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-bad/30 bg-bad-bg p-4 text-[13px] text-fg">
      <div>
        <strong className="block text-[14px] font-semibold text-bad">El problema está en este equipo, no en el sitio.</strong>
        <span className="text-fg">{message}</span>
      </div>
      {detail !== undefined && detail.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 font-mono text-[11px] break-all text-muted">
          {detail.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-fg">Cómo solucionarlo (desde la carpeta del repositorio; funciona igual en CMD de Windows, PowerShell, macOS y Linux):</span>
        {remedy.map((r, i) => {
          const command = commands[i];
          return command === null || command === undefined ? (
            <p key={r} className="text-[12px] text-muted">
              {remedyText(r, null)}
            </p>
          ) : (
            <div key={r} className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">{remedyText(r, command)}</span>
              <CopyCommand command={command} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
