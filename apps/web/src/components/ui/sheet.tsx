"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { buttonClass } from "./primitives";

/** Side panel opened by a button. The content is rendered by the server and passed in. */
export function Sheet({ trigger, title, subtitle, children, variant = "secondary" }: { trigger: ReactNode; title: string; subtitle?: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost" }) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <>
      <button type="button" className={buttonClass(variant, "sm")} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onMouseDown={() => setOpen(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="flex h-full w-full max-w-3xl flex-col border-l-[length:var(--panel-border-width)] border-panel-border bg-panel shadow-[var(--panel-shadow)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-fg">{title}</div>
                {subtitle !== undefined && <div className="truncate font-mono text-[11px] text-faint">{subtitle}</div>}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg" aria-label={t("close")}>
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          </aside>
        </div>
      )}
    </>
  );
}
