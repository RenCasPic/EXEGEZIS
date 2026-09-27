"use client";

import { useState, useTransition } from "react";
import { reviewMarkAction } from "@/app/search-actions";
import { cn } from "@/lib/cn";

const MARKS = [
  { id: "relevant", label: "Relevante" },
  { id: "not-relevant", label: "No relevante" },
  { id: "pending", label: "Pendiente" },
] as const;

/** Relevante / No relevante / Pendiente: saved in review.json, the report is never touched. */
export function ReviewButtons({ searchId, hitId, mark }: { searchId: string; hitId: string; mark: string }) {
  const [current, setCurrent] = useState(mark);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Revisión">
      {MARKS.map((m) => (
        <button
          key={m.id}
          type="button"
          disabled={pending}
          aria-pressed={current === m.id}
          onClick={() =>
            start(async () => {
              const previous = current;
              setCurrent(m.id);
              const r = await reviewMarkAction(searchId, hitId, m.id);
              if (r.error !== null) {
                setCurrent(previous);
                setError(r.error);
              } else setError(null);
            })
          }
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[12px] transition-colors disabled:opacity-60",
            current === m.id
              ? m.id === "relevant"
                ? "border-ok/40 bg-ok-bg text-ok"
                : m.id === "not-relevant"
                  ? "border-line-strong bg-hover text-fg"
                  : "border-accent-text/40 bg-hover text-fg"
              : "border-line text-muted hover:text-fg",
          )}
        >
          {m.label}
        </button>
      ))}
      {error !== null && (
        <span role="alert" className="text-[12px] text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
