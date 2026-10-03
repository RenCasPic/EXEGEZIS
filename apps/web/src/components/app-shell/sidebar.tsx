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
import { useTranslations } from "next-intl";
import type { AccountSummary } from "./user-menu";
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
  const t = useTranslations("shell.nav");
  const path = usePathname();
  const status = useSearchParams().get("status");
  const investigationsList = (s: string | null) => (p: string, current: string | null) => p === "/investigations" && current === s;

  const groups: { title: string | null; items: Item[] }[] = [
    {
      title: null,
      items: [
        { href: "/", label: t("home"), icon: <Home />, match: (p) => p === "/" },
        { href: "/overview", label: t("overview"), icon: <Gauge />, match: (p) => p.startsWith("/overview") },
        { href: "/inspections", label: t("inspections"), icon: <Globe />, match: (p) => p.startsWith("/inspections") },
        { href: "/searches", label: t("searches"), icon: <Search />, match: (p) => p.startsWith("/searches") },
      ],
    },
    {
      title: t("investigationsGroup"),
      items: [
        { href: "/investigations", label: t("allInvestigations"), icon: <LayoutList />, count: counts.all, match: investigationsList(null) },
        { href: "/investigations?status=active", label: t("active"), icon: <Activity />, count: counts.active, match: investigationsList("active") },
        { href: "/investigations?status=verified", label: t("verified"), icon: <BadgeCheck />, count: counts.verified, match: investigationsList("verified") },
        {
          href: "/investigations?status=needs-evidence",
          label: t("needsEvidence"),
          icon: <HelpCircle />,
          count: counts.needsEvidence,
          match: investigationsList("needs-evidence"),
        },
        { href: "/investigations?status=expected", label: t("expected"), icon: <CircleCheckBig />, count: counts.expected, match: investigationsList("expected") },
      ],
    },
    {
      title: t("verificationGroup"),
      items: [
        { href: "/verification/reproductions", label: t("reproductions"), icon: <Repeat />, match: (p) => p.startsWith("/verification/reproductions") },
        { href: "/planner", label: t("aiPlans"), icon: <Bot />, match: (p) => p.startsWith("/planner") },
        { href: "/verification/root-causes", label: t("rootCauses"), icon: <Microscope />, match: (p) => p.startsWith("/verification/root-causes") },
        { href: "/verification/fixes", label: t("fixes"), icon: <GitPullRequestDraft />, tag: t("notImplementedTag"), match: (p) => p.startsWith("/verification/fixes") },
      ],
    },
    {
      title: null,
      items: [
        { href: "/projects", label: t("projects"), icon: <FolderGit2 />, match: (p) => p.startsWith("/projects") },
        { href: "/benchmarks", label: t("benchmarks"), icon: <Beaker />, match: (p) => p.startsWith("/benchmarks") },
        { href: "/settings", label: t("settings"), icon: <Settings />, match: (p) => p.startsWith("/settings") },
      ],
    },
  ];

  return (
    <nav className="flex flex-col gap-4" aria-label={t("label")}>
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
                  <span title={t("notImplementedYet")} className="rounded border border-dashed border-line-strong px-1 font-mono text-[9px] text-faint">
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
  const t = useTranslations("shell");
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <LogoMark className="size-7 shrink-0 text-heading" />
      <div className="leading-tight">
        <div className="font-mono text-[13px] font-semibold tracking-[0.18em] text-heading">EXEGEZIS</div>
        <div className="text-[11px] text-faint">{t("brandTagline")}</div>
      </div>
    </Link>
  );
}

export function SidebarFooter({ workspace, repository, user, account = null }: { workspace: string; repository: string; user: string; account?: AccountSummary | null }) {
  const t = useTranslations("shell.footer");
  if (account !== null)
    return (
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <div className="min-w-0 px-2 leading-tight">
          <div className="truncate text-[13px] text-fg">{account.name || account.email}</div>
          <div className="truncate text-[11px] text-faint">{account.email}</div>
          <div className="mt-1 text-[11px] text-faint">{account.plan}</div>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="px-2">
        <div className="text-[11px] font-medium text-faint">{t("workspace")}</div>
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
          <div className="text-[11px] text-faint">{t("localUser")}</div>
        </div>
      </div>
    </div>
  );
}
