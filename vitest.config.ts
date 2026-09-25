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
          name: "cli",
          root: "apps/cli",
          include: ["test/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
