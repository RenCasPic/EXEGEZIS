/*
 * "Only inspect sites that are yours or that you are allowed to inspect"
 * (common.permission.text): confirmed once per external host, remembered in
 * this browser only.
 */

const PERMISSION_PREFIX = "exegezis-inspect-permission:";

export function hostOf(value: string): string | null {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
}

export function remembered(host: string): boolean {
  try {
    return window.localStorage.getItem(PERMISSION_PREFIX + host) === "1";
  } catch {
    return false;
  }
}

export function remember(host: string): void {
  try {
    window.localStorage.setItem(PERMISSION_PREFIX + host, "1");
  } catch {
    // Storage unavailable: the confirmation is asked again next time.
  }
}
