// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const browserGlobals = {
  document: "readonly",
  window: "readonly",
  navigator: "readonly",
  fetch: "readonly",
  sessionStorage: "readonly",
  console: "readonly",
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "runs/**", "**/test-results/**", "**/playwright-report/**", "**/.next/**", "**/.next-e2e/**", "**/next-env.d.ts", "**/test/.tmp/**", "**/test/.tmp-*/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: [
          "./packages/*/tsconfig.json",
          "./apps/*/tsconfig.json",
          "./tsconfig.tests.json",
          "./examples/buggy-shop/tsconfig.json",
          "./examples/inspect-lab/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "error",
    },
  },
  {
    // The CLI talks to the terminal through injected streams, never console.log.
    // The example app is a target, not part of EXEGEZIS: it may log.
    files: ["examples/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["examples/buggy-shop/public/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: "module", globals: browserGlobals },
  },
  {
    files: ["**/test/**/*.ts", "**/tests/**/*.ts"],
    rules: {
      // Tests assert on parsed JSON with explicit schemas or narrow casts.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // Fake adapters implement async interfaces without awaiting anything.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["**/*.js", "**/bin/*.js"],
    ignores: ["examples/buggy-shop/public/**"],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: "module", globals: { process: "readonly", console: "readonly" } },
  },
);
