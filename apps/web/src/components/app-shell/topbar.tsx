"use client";

import { Bell, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { setScope } from "@/app/actions";
import { cn } from "@/lib/cn";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { SidebarBrand, SidebarNav, type SidebarCounts } from "./sidebar";
import { ThemeSwitcher } from "./theme-switcher";

export interface RunningJob {
  id: string;
  symptom: string;
  startedAt: string;
}

interface TopbarProps {
  projects: { id: string; label: string }[];
  environments: string[];
  scope: { project: string | null; environment: string | null };
  palette: PaletteItem[];
  running: RunningJob[];
  counts: SidebarCounts;
  user: string;
}

function ScopeSelect({ label, value, options, onChange, disabled }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-[13px]">
      <span className="text-faint">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-40 cursor-pointer appearance-none bg-transparent pr-1 font-medium text-fg outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} className="bg-panel text-fg">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Topbar({ projects, environments, scope, palette, running, counts, user }: TopbarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [activity, setActivity] = useState(false);
  const activityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activity) return;
    const close = (e: MouseEvent) => {
      if (activityRef.current !== null && !activityRef.current.contains(e.target as Node)) setActivity(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [activity]);

  const update = (project: string | null, environment: string | null) =>
    startTransition(async () => {
      await setScope(project, environment);
      router.refresh();
    });

  return (
    <>
      <header className="sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur md:gap-3 lg:px-6">
        <button type="button" className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
          <Menu className="size-4" />
        </button>
        <div className={cn("flex min-w-0 items-center gap-2", pending && "opacity-60")}>
          <ScopeSelect
            label="Project"
            value={scope.project ?? ""}
            disabled={pending}
            options={[{ id: "", label: "All projects" }, ...projects]}
            onChange={(v) => update(v === "" ? null : v, scope.environment)}
          />
          <div className="hidden md:block">
            <ScopeSelect
              label="Environment"
              value={scope.environment ?? ""}
              disabled={pending}
              options={[{ id: "", label: "All" }, ...environments.map((e) => ({ id: e, label: e }))]}
              onChange={(v) => update(scope.project, v === "" ? null : v)}
            />
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-[13px] text-faint hover:text-muted sm:w-56"
        >
          <Search className="size-3.5" />
          <span className="hidden flex-1 text-left sm:inline">Search</span>
          <kbd className="hidden rounded border border-line-strong px-1 font-mono text-[10px] sm:inline">⌘ K</kbd>
        </button>
        <ThemeSwitcher />
        <div className="relative" ref={activityRef}>
          <button
            type="button"
            onClick={() => setActivity((v) => !v)}
            className="relative grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            aria-label={`Activity: ${running.length} running`}
          >
            <Bell className="size-4" />
            {running.length > 0 && <span className="animate-pulse-dot absolute top-1.5 right-1.5 size-1.5 rounded-full bg-q" />}
          </button>
          {activity && (
            <div className="absolute right-0 mt-2 w-80 rounded-lg border border-line-strong bg-panel p-1.5 shadow-2xl">
              <div className="px-2.5 py-1.5 text-[11px] font-medium text-faint">Running and queued</div>
              {running.length === 0 ? (
                <div className="px-2.5 pb-2.5 text-[13px] text-muted">Nothing is running. Notifications beyond local runs are not implemented.</div>
              ) : (
                running.map((job) => (
                  <Link key={job.id} href={`/jobs/${job.id}`} onClick={() => setActivity(false)} className="block rounded-md px-2.5 py-2 hover:bg-hover">
                    <div className="truncate text-[13px] text-fg">{job.symptom}</div>
                    <div className="font-mono text-[11px] text-muted">{job.id}</div>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
        <span title={`${user} (local, no authentication)`} className="grid size-8 place-items-center rounded-full border border-line-strong bg-panel-2 font-mono text-[11px] uppercase text-muted">
          {user.slice(0, 2)}
        </span>
      </header>

      <CommandPalette items={palette} open={paletteOpen} onOpenChange={setPaletteOpen} />

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col gap-5 overflow-y-auto border-r border-line bg-bg p-3">
            <div className="flex items-center justify-between">
              <SidebarBrand />
              <button type="button" onClick={() => setDrawer(false)} className="rounded-md p-1.5 text-muted hover:bg-hover" aria-label="Close navigation">
                <X className="size-4" />
              </button>
            </div>
            <Suspense>
              <SidebarNav counts={counts} onNavigate={() => setDrawer(false)} />
            </Suspense>
          </aside>
        </div>
      )}
    </>
  );
}
