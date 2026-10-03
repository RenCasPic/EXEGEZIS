"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/primitives";

/** A page that failed to render, in the reader's language (the technical message stays as the server wrote it). */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("shell.error");
  return (
    <EmptyState
      icon={<AlertTriangle />}
      title={t("title")}
      action={
        <button type="button" onClick={reset} className="rounded-md border border-line-strong bg-panel-2 px-3 py-1.5 text-[13px] text-fg hover:bg-hover">
          {t("retry")}
        </button>
      }
    >
      {t("body")}
      <code className="mt-2 block font-mono text-[12px] break-all text-muted">{error.digest ?? error.message}</code>
    </EmptyState>
  );
}
