import type { Device } from "@exegezis/core";

/*
 * The devices a page is visited as (web inspection, docs/07-web-inspection.md).
 * The mobile and tablet user agents are those of Chrome on Android, so a site
 * serves what a phone or tablet would get, with EXEGEZIS-Inspector at the end:
 * the inspection always says what it is.
 */

export interface DeviceProfile {
  viewport: { width: number; height: number };
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
  userAgent(inspector: string): string;
}

export const DEVICE_PROFILES: Record<Device, DeviceProfile> = {
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: (inspector) => inspector },
  mobile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: (inspector) => `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 ${inspector}`,
  },
  tablet: {
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: (inspector) => `Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ${inspector}`,
  },
};

/** Inspections visit every page on desktop and on mobile unless told otherwise. */
export const DEFAULT_DEVICES: readonly Device[] = ["desktop", "mobile"];

/** The run folder of a visit: desktop keeps the folders of before (run-N). */
export function runFolder(device: Device, run: number): string {
  return device === "desktop" ? `run-${run}` : `${device}-run-${run}`;
}
