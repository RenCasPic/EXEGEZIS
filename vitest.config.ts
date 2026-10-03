import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "packages/core",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "adapter-browser",
          root: "packages/adapter-browser",
          include: ["test/**/*.test.ts"],
          // Real Chromium sessions: slower than unit tests.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "compiler-playwright",
          root: "packages/compiler-playwright",
          include: ["test/**/*.test.ts"],
          // Runs compiled specs with the real Playwright runner.
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "planner",
          root: "packages/planner",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "inspect",
          root: "packages/inspect",
          include: ["test/**/*.test.ts"],
          // Real Chromium inspections of local fixtures.
          testTimeout: 180_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: "search",
          root: "packages/search",
          include: ["test/**/*.test.ts"],
          // Real Chromium searches of local fixtures.
          testTimeout: 180_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: "access",
          root: "packages/access",
          include: ["test/**/*.test.ts"],
          // DPAPI round trips spawn Windows PowerShell (~1 s each).
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "accounts",
          root: "packages/accounts",
          include: ["test/**/*.test.ts"],
          // Postgres (PGlite, in WebAssembly) starts in a few seconds.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "web",
          root: "apps/web",
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
          setupFiles: ["test/setup.ts"],
        },
        resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
      },
      {
        test: {
          name: "site",
          root: "apps/site",
          include: ["test/**/*.test.ts"],
          // The end-to-end test starts its own `next dev` and a real browser.
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
      {
        test: {
          name: "cli",
          root: "apps/cli",
          include: ["test/**/*.test.ts"],
          // The assertions read the English output; this machine's own language must not change them.
          env: { EXEGEZIS_LANG: "en" },
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
