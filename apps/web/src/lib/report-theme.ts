/**
 * The owner's report's print palette (lib/owner-report.ts). A printed PDF does not follow the app's
 * light and dark themes: fixed colours, dark enough on white for WCAG AA, and severities that are
 * also written as words (never colour alone).
 */
export const PRINT = {
  text: "#1b2433",
  line: "#c9d1de",
  muted: "#4a566b",
  brand: "#1b3157",
  critical: "#8a1020",
  serious: "#a3361a",
  moderate: "#7a5600",
  minor: "#3d4b63",
  lineSoft: "#d5dbe6",
} as const;
