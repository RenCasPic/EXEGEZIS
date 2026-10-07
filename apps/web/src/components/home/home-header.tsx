"use client";

import { ChevronDown, Menu, Monitor, Moon, Sun, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { setScope } from "@/app/actions";
import { LanguageSwitcher } from "@/components/app-shell/language-switcher";
import { UserMenu, type AccountSummary } from "@/components/app-shell/user-menu";
import { cn } from "@/lib/cn";
import { applyTheme, readThemePreference, THEME_PREFERENCES, writeThemePreference, type ThemePreference } from "@/lib/theme";

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** The mark of docs/design/: a page with three lines, in the text colour. */
export function HomeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 8h8" />
      <path d="M8 12h5" />
      <path d="M8 16h8" />
    </svg>
  );
}

function useTheme() {
  const [pref, setPref] = useState<ThemePreference>("system");
  useEffect(() => setPref(readThemePreference()), []);
  useEffect(() => {
    if (pref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [pref]);
  const choose = (next: ThemePreference) => {
    setPref(next);
    writeThemePreference(next);
    applyTheme(next);
  };
  return [pref, choose] as const;
}

/**
 * The home's header (docs/design/home-app.html): logo · Home, Inspections,
 * Investigations, Root causes, Benchmarks, Settings · Light / Dark / System ·
 * language · project. From 1280 px to 1536 px the theme buttons show only
 * their icons, so everything fits on one row. Below 1280 px the sections go into a menu and the theme
 * is one button, as in home-app-mobile.html.
 */
export function HomeHeader({ projects, project, account }: { projects: { id: string; label: string }[]; project: string | null; account: AccountSummary }) {
  const t = useTranslations("home.header");
  const nav = useTranslations("shell.nav");
  const theme = useTranslations("shell.theme");
  const router = useRouter();
  const [pref, choose] = useTheme();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const links = [
    { href: "/", label: nav("home") },
    { href: "/inspections", label: nav("inspections") },
    { href: "/investigations", label: nav("investigationsGroup") },
    { href: "/verification/root-causes", label: nav("rootCauses") },
    { href: "/benchmarks", label: nav("benchmarks") },
    { href: "/settings", label: nav("settings") },
  ];
  const pick = (value: string) =>
    start(async () => {
      await setScope(value === "" ? null : value, null);
      router.refresh();
    });
  const current = projects.find((p) => p.id === project)?.label ?? t("allProjects");
  // The theme in use (set before paint by the boot script); read after mounting to avoid a hydration mismatch.
  const [resolvedDark, setResolvedDark] = useState(false);
  useEffect(() => setResolvedDark(document.documentElement.getAttribute("data-theme") === "dark"), [pref]);
  const nextTheme: ThemePreference = resolvedDark ? "light" : "dark";

  const projectSelect = (
    <label className={cn("relative flex h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg", pending && "opacity-60")}>
      <span className="text-muted whitespace-nowrap">{t("project")}</span>
      <span className="max-w-40 truncate font-medium whitespace-nowrap">{current}</span>
      <ChevronDown className="size-3.5 text-muted" aria-hidden />
      <select value={project ?? ""} disabled={pending} aria-label={t("project")} onChange={(e) => pick(e.target.value)} className="absolute inset-0 cursor-pointer appearance-none opacity-0">
        <option value="">{t("allProjects")}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <header className="relative border-b border-line bg-bg">
      <div className="flex h-14 items-center justify-between gap-4 pr-2 pl-4 xl:h-16 xl:px-6 2xl:px-12">
        <div className="flex items-center gap-6 2xl:gap-10">
          <Link href="/" className="flex items-center gap-2 text-heading xl:gap-2.5">
            <HomeLogo className="size-5 text-fg xl:size-[22px]" />
            <span className="font-mono text-[14px] font-semibold tracking-[0.14em] xl:text-[15px]">EXEGEZIS</span>
          </Link>
          <nav aria-label={nav("label")} className="hidden gap-1 text-[14px] xl:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={l.href === "/" ? "page" : undefined}
                className={cn("rounded-lg px-2.5 py-2 whitespace-nowrap 2xl:px-3", l.href === "/" ? "panel-frame bg-panel font-medium text-fg" : "border-[length:var(--panel-border-width)] border-transparent text-muted hover:text-fg")}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="hidden items-center gap-2 xl:flex 2xl:gap-3">
          <LanguageSwitcher />
          <div role="radiogroup" aria-label={theme("label")} className="flex gap-0.5 rounded-[10px] border border-line bg-sunken p-[3px]">
            {THEME_PREFERENCES.map((p) => {
              const Icon = ICON[p];
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={pref === p}
                  aria-label={theme(p)}
                  title={theme(p)}
                  onClick={() => choose(p)}
                  className={cn("flex h-[30px] items-center gap-1.5 rounded-[7px] px-2 text-[13px] whitespace-nowrap 2xl:px-2.5", pref === p ? "bg-panel font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.14)]" : "text-muted hover:text-fg")}
                >
                  <Icon className="size-[15px]" aria-hidden />
                  {/* Below 1536 px only the icon fits (its name is the label and the tooltip). */}
                  <span className="hidden 2xl:inline">{theme(p)}</span>
                </button>
              );
            })}
          </div>
          {projectSelect}
          <UserMenu account={account} />
        </div>
        <div className="flex items-center xl:hidden">
          <UserMenu account={account} />
          <button type="button" onClick={() => choose(nextTheme)} aria-label={theme(nextTheme === "dark" ? "toDark" : "toLight")} className="grid size-11 place-items-center text-fg">
            {resolvedDark ? <Sun className="size-5" strokeWidth={1.8} aria-hidden /> : <Moon className="size-5" strokeWidth={1.8} aria-hidden />}
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="home-menu" aria-label={open ? t("closeMenu") : t("openMenu")} className="grid size-11 place-items-center text-fg">
            {open ? <X className="size-[22px]" strokeWidth={1.8} aria-hidden /> : <Menu className="size-[22px]" strokeWidth={1.8} aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <div id="home-menu" className="panel-frame absolute inset-x-4 top-full z-40 mt-2 flex flex-col gap-1 rounded-xl bg-panel p-2 xl:hidden">
          <nav aria-label={nav("label")} className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={l.href === "/" ? "page" : undefined}
                className={cn("rounded-lg px-3 py-2.5 text-[15px] hover:bg-hover", l.href === "/" ? "font-medium text-fg" : "text-muted")}
              >
                {l.label}
              </Link>
            ))}
            <Link href="/?modo=buscar" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[15px] text-muted hover:bg-hover">
              {t("search")}
            </Link>
          </nav>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-1 pt-2">
            <LanguageSwitcher />
            {projectSelect}
          </div>
        </div>
      )}
    </header>
  );
}
