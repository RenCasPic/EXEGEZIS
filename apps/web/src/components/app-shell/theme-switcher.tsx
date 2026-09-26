"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { applyTheme, readThemePreference, THEME_LABEL, THEME_PREFERENCES, writeThemePreference, type ThemePreference } from "@/lib/theme";

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Light / Dark / System. The choice is kept in localStorage (when storage is
 * available) and applied before paint by the inline script in the layout.
 * Desktop: a segmented control. Mobile: one 44 px button that cycles.
 */
export function ThemeSwitcher() {
  const [pref, setPref] = useState<ThemePreference>("system");

  useEffect(() => {
    setPref(readThemePreference());
  }, []);

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
  const next = THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(pref) + 1) % THEME_PREFERENCES.length] ?? "system";
  const Current = ICON[pref];

  return (
    <>
      <div role="radiogroup" aria-label="Tema" className="hidden h-8 items-center rounded-md border border-line bg-panel p-0.5 md:flex">
        {THEME_PREFERENCES.map((p) => {
          const Icon = ICON[p];
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={pref === p}
              onClick={() => choose(p)}
              title={THEME_LABEL[p]}
              className={cn(
                "flex h-full items-center gap-1 rounded px-2 text-[12px] transition-colors",
                pref === p ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="hidden xl:inline">{THEME_LABEL[p]}</span>
              <span className="sr-only xl:hidden">{THEME_LABEL[p]}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => choose(next)}
        aria-label={`Tema: ${THEME_LABEL[pref]}. Cambiar a ${THEME_LABEL[next]}`}
        className="grid size-11 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg md:hidden"
      >
        <Current className="size-5" aria-hidden />
      </button>
    </>
  );
}
