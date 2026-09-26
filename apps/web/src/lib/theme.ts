/** Theme preference: stored per browser; "system" follows prefers-color-scheme. */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];
export const THEME_LABEL: Record<ThemePreference, string> = { light: "Claro", dark: "Oscuro", system: "Sistema" };
export const THEME_STORAGE_KEY = "exegezis-theme";

/**
 * Runs inline in <head> before the first paint, so there is no flash of the
 * wrong theme. Storage can be unavailable (private mode, blocked site data):
 * then the OS preference applies.
 */
export const THEME_BOOT_SCRIPT = `(function(){var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}var t=p==="light"||p==="dark"?p:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t)})();`;

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(pref: ThemePreference): void {
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

export function resolveTheme(pref: ThemePreference, prefersDark: boolean): "light" | "dark" {
  return pref === "system" ? (prefersDark ? "dark" : "light") : pref;
}

export function applyTheme(pref: ThemePreference): void {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", resolveTheme(pref, dark));
}
