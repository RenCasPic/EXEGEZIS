/** Deletes `distDir` (relative to apps/web) when the app's structure changed since it was built; true when it did. */
export function ensureFreshCache(distDir?: string): boolean;
export function fingerprint(): string;
