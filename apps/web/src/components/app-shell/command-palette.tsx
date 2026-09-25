"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface PaletteItem {
  href: string;
  title: string;
  group: string;
  hint?: string;
}

export function CommandPalette({ items, open, onOpenChange }: { items: PaletteItem[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q === "" ? items : items.filter((i) => `${i.title} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(q));
    return matched.slice(0, 50);
  }, [items, query]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const go = (item: PaletteItem | undefined) => {
    if (item === undefined) return;
    onOpenChange(false);
    router.push(item.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]" onMouseDown={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[cursor]);
              } else if (e.key === "Escape") {
                onOpenChange(false);
              }
            }}
            placeholder="Search investigations, benchmarks, pages…"
            className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line-strong px-1 font-mono text-[10px] text-faint">Esc</kbd>
        </div>
        <div ref={list} className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">No results for “{query}”.</div>}
          {results.map((item, i) => (
            <button
              key={`${item.group}:${item.href}`}
              type="button"
              data-index={i}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(item)}
              className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === cursor ? "bg-hover" : "")}
            >
              <span className="w-24 shrink-0 text-[11px] uppercase tracking-wider text-faint">{item.group}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{item.title}</span>
              {item.hint !== undefined && <span className="shrink-0 font-mono text-[11px] text-faint">{item.hint}</span>}
              {i === cursor && <CornerDownLeft className="size-3.5 shrink-0 text-faint" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
