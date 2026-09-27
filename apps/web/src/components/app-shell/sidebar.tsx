"use client";

import {
  Activity,
  BadgeCheck,
  Beaker,
  BookOpenCheck,
  CircleCheckBig,
  Bot,
  FolderGit2,
  Gauge,
  Globe,
  GitPullRequestDraft,
  HelpCircle,
  Home,
  LayoutList,
  Microscope,
  Repeat,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LogoMark } from "./logo";

export interface SidebarCounts {
  all: number;
  active: number;
  verified: number;
  needsEvidence: number;
  expected: number;
}

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
  count?: number;
  tag?: string;
  match: (path: string, status: string | null) => boolean;
}

export function SidebarNav({ counts, onNavigate }: { counts: SidebarCounts; onNavigate?: () => void }) {
  const path = usePathname();
  const status = useSearchParams().get("status");
  const investigationsList = (s: string | null) => (p: string, current: string | null) => p === "/investigations" && current === s;

  const groups: { title: string | null; items: Item[] }[] = [
    {
      title: null,
      items: [
        { href: "/", label: "Inicio", icon: <Home />, match: (p) => p === "/" },
        { href: "/overview", label: "Overview", icon: <Gauge />, match: (p) => p.startsWith("/overview") },
        { href: "/inspections", label: "Inspections", icon: <Globe />, match: (p) => p.startsWith("/inspections") },
        { href: "/searches", label: "Búsquedas", icon: <Search />, match: (p) => p.startsWith("/searches") },
      ],
    },
    {
      title: "Investigations",
      items: [
        { href: "/investigations", label: "All Investigations", icon: <LayoutList />, count: counts.all, match: investigationsList(null) },
        { href: "/investigations?status=active", label: "Active", icon: <Activity />, count: counts.active, match: investigationsList("active") },
        { href: "/investigations?status=verified", label: "Verified", icon: <BadgeCheck />, count: counts.verified, match: investigationsList("verified") },
        {
          href: "/investigations?status=needs-evidence",
          label: "Needs Evidence",
          icon: <HelpCircle />,
          count: counts.needsEvidence,
          match: investigationsList("needs-evidence"),
        },
        { href: "/investigations?status=expected", label: "Expected", icon: <CircleCheckBig />, count: counts.expected, match: investigationsList("expected") },
      ],
    },
    {
      title: "Verification",
      items: [
        { href: "/verification/reproductions", label: "Reproductions", icon: <Repeat />, match: (p) => p.startsWith("/verification/reproductions") },
        { href: "/planner", label: "AI Plans", icon: <Bot />, match: (p) => p.startsWith("/planner") },
        { href: "/verification/root-causes", label: "Root Causes", icon: <Microscope />, match: (p) => p.startsWith("/verification/root-causes") },
        { href: "/verification/fixes", label: "Fixes", icon: <GitPullRequestDraft />, tag: "N/I", match: (p) => p.startsWith("/verification/fixes") },
      ],
    },
    {
      title: null,
      items: [
        { href: "/projects", label: "Projects", icon: <FolderGit2 />, match: (p) => p.startsWith("/projects") },
        { href: "/benchmarks", label: "Benchmarks", icon: <Beaker />, match: (p) => p.startsWith("/benchmarks") },
        { href: "/settings", label: "Settings", icon: <Settings />, match: (p) => p.startsWith("/settings") },
      ],
    },
  ];

  return (
    <nav className="flex flex-col gap-4" aria-label="Main">
      {groups.map((group, i) => (
        <div key={group.title ?? `g${i}`} className="flex flex-col gap-px">
          {group.title !== null && <div className="px-2 pb-1 text-[11px] font-medium text-faint">{group.title}</div>}
          {group.items.map((item) => {
            const active = item.match(path, status);
            return (
              <Link
                key={item.href}
                href={item.href}
                {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors [&>svg]:size-4 [&>svg]:shrink-0",
                  active ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
                )}
              >
                <span className={cn("[&>svg]:size-4", active ? "text-accent-text" : "text-faint group-hover:text-muted")}>{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.count !== undefined && <span className="font-mono text-[11px] text-faint">{item.count}</span>}
                {item.tag !== undefined && (
                  <span title="Not implemented yet" className="rounded border border-dashed border-line-strong px-1 font-mono text-[9px] text-faint">
                    {item.tag}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <LogoMark className="size-7 shrink-0 text-fg" />
      <div className="leading-tight">
        <div className="font-mono text-[13px] font-semibold tracking-[0.18em] text-fg">EXEGEZIS</div>
        <div className="text-[11px] text-faint">Software Verification</div>
      </div>
    </Link>
  );
}

export function SidebarFooter({ workspace, repository, user }: { workspace: string; repository: string; user: string }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="px-2">
        <div className="text-[11px] font-medium text-faint">Workspace</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fg">
          <BookOpenCheck className="size-3.5 text-faint" />
          {workspace}
        </div>
        <div className="truncate font-mono text-[11px] text-faint" title={repository}>
          {repository}
        </div>
      </div>
      <div className="flex items-center gap-2.5 px-2">
        <span className="grid size-7 place-items-center rounded-full border border-line-strong bg-panel-2 font-mono text-[11px] uppercase text-muted">
          {user.slice(0, 2)}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] text-fg">{user}</div>
          <div className="text-[11px] text-faint">Local user · no auth</div>
        </div>
      </div>
    </div>
  );
}
