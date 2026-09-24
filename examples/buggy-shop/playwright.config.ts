import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["TEST_PORT"] ?? 3100);

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
  },
  projects: [
    // The suite a typical team would have. It passes although the shop has 3 bugs.
    { name: "conventional", testDir: "tests/conventional" },
    // Lab ground truth: asserts correct behavior, marked test.fail() while the bug exists.
    { name: "known-bugs", testDir: "tests/known-bugs" },
  ],
  webServer: {
    command: "node src/server.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env["CI"],
    stdout: "ignore",
  },
});
