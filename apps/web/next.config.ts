import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  // Workspace packages are plain Node ESM (they read the filesystem): load
  // them at runtime instead of bundling them.
  serverExternalPackages: ["@exegezis/core", "@exegezis/planner", "@exegezis/search"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  devIndicators: false,
};

export default config;
