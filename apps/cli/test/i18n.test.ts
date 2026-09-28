import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { cliLocale, localeOf, resolveCliLocale, setCliLocale, systemLocale } from "../src/i18n.js";
import { main } from "../src/main.js";
import { CLI_MESSAGES_EN, CLI_MESSAGES_ES } from "../src/messages-catalog.js";

/** The argument names of an ICU message (plural/select included), sorted. */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: readonly unknown[]) => {
    for (const node of nodes as { type: number; value?: string; options?: Record<string, { value: unknown[] }> }[]) {
      if (node.type !== 0 && typeof node.value === "string") names.add(node.value);
      for (const option of Object.values(node.options ?? {})) walk(option.value);
    }
  };
  walk(new IntlMessageFormat(message, "en", undefined, { ignoreTag: true }).getAst());
  return [...names].sort();
}

async function run(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const stderrStream = { write: (text: string) => ((stderr += text), true) } as unknown as NodeJS.WriteStream;
  const code = await main(argv, { stdout: { write: (text: string) => (stdout += text) }, stderr: stderrStream, cwd: process.cwd() }, env);
  return { code, stdout, stderr };
}

describe("CLI message catalogs", () => {
  it("have the same keys, no empty text, and the same placeholders in both languages", () => {
    expect(Object.keys(CLI_MESSAGES_ES).sort()).toEqual(Object.keys(CLI_MESSAGES_EN).sort());
    for (const [key, en] of Object.entries(CLI_MESSAGES_EN)) {
      const es = CLI_MESSAGES_ES[key as keyof typeof CLI_MESSAGES_EN];
      expect(en.trim(), key).not.toBe("");
      expect(es.trim(), key).not.toBe("");
      expect(argumentsOf(es), key).toEqual(argumentsOf(en));
    }
  });
});

describe("the CLI's language", () => {
  it("is --lang, else EXEGEZIS_LANG, else the system's language, else English", () => {
    expect(resolveCliLocale(["--lang", "es", "doctor"], { EXEGEZIS_LANG: "en" })).toEqual({ locale: "es", argv: ["doctor"], invalid: null });
    expect(resolveCliLocale(["doctor", "--lang=en"], { EXEGEZIS_LANG: "es" }).locale).toBe("en");
    expect(resolveCliLocale(["doctor"], { EXEGEZIS_LANG: "es_MX.UTF-8" }).locale).toBe("es");
    expect(resolveCliLocale(["doctor"], { LANG: "es_ES.UTF-8" }).locale).toBe("es");
    expect(resolveCliLocale(["--lang", "fr"], { EXEGEZIS_LANG: "en" }).invalid).toBe("fr");
    expect(localeOf("pt-BR")).toBeNull();
    expect(systemLocale({ LC_ALL: "en_US.UTF-8" })).toBe("en");
  });

  it("--help is fully Spanish with --lang es and English with --lang en", async () => {
    const es = await run(["--lang", "es", "--help"]);
    expect(es.code).toBe(0);
    expect(es.stdout).toContain("Software que se explica a sí mismo");
    expect(es.stdout).toContain("Códigos de salida");
    expect(es.stdout).not.toMatch(/\bUsage:|Exit codes:|Commands:/);
    const en = await run(["--help"], { EXEGEZIS_LANG: "en" });
    expect(en.stdout).toContain("Software that explains itself");
    expect(en.stdout).not.toMatch(/Uso:|Códigos de salida/);
  });

  it("usage errors, including Node's own option errors, follow the language", async () => {
    expect((await run(["--lang", "es", "inspect"])).stderr).toBe("Error: Falta la opción obligatoria --url <url>.\n");
    expect((await run(["--lang", "en", "inspect"])).stderr).toBe("Error: Missing required option --url <url>.\n");
    expect((await run(["--lang", "es", "inspect", "--nope"])).stderr).toContain("Opción desconocida --nope");
    expect((await run(["--lang", "es", "search", "--url", "https://a.test/"])).stderr).toContain("Di qué buscar");
    const bad = await run(["--lang", "xx", "doctor"], { EXEGEZIS_LANG: "en" });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--lang must be en or es, got "xx"');
  });

  it("is set once per invocation", async () => {
    await run(["--lang", "es", "--version"]);
    expect(cliLocale()).toBe("es");
    await run(["--version"], { EXEGEZIS_LANG: "en" });
    expect(cliLocale()).toBe("en");
    setCliLocale("en");
  });
});
