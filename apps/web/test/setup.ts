import type * as NextIntl from "next-intl";
import type * as UserWorkspace from "../src/lib/user-workspace";
import { vi } from "vitest";

/*
 * next-intl outside Next.js: components and pages under test get their texts
 * from the real catalogs, in the language of `setTestLocale` (Spanish by
 * default, the language most assertions were written in).
 */

type TestLocale = "en" | "es";
const state = globalThis as unknown as { __exegezisTestLocale?: TestLocale };

export function setTestLocale(locale: TestLocale): void {
  state.__exegezisTestLocale = locale;
}

const current = (): TestLocale => state.__exegezisTestLocale ?? "es";

async function translator(namespace?: string) {
  const { createTranslator } = await vi.importActual<typeof NextIntl>("next-intl");
  const { CATALOGS } = await import("../src/i18n/messages");
  const locale = current();
  return createTranslator({ locale, messages: CATALOGS[locale] as never, ...(namespace === undefined ? {} : { namespace: namespace as never }) });
}

vi.mock("next-intl/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLocale: async () => current(),
  getTranslations: async (arg?: string | { namespace?: string }) => translator(typeof arg === "string" ? arg : arg?.namespace),
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof NextIntl>();
  const { CATALOGS } = await import("../src/i18n/messages");
  return {
    ...actual,
    useLocale: () => current(),
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: current(), messages: CATALOGS[current()] as never, ...(namespace === undefined ? {} : { namespace: namespace as never }) }),
  };
});

/*
 * Outside a request there is no signed-in user: the code under test reads and
 * writes the workspace the test chooses through the environment
 * (EXEGEZIS_RUNS_DIR, EXEGEZIS_ACCESS_DIR, EXEGEZIS_SEARCH_DIR), as the CLI does.
 */
vi.mock("../src/lib/user-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof UserWorkspace>();
  const { runsDir } = await import("../src/lib/workspace");
  const { defaultAccessDir } = await import("@exegezis/access");
  const { searchDataDir } = await import("@exegezis/search/light");
  const workspace = () => ({ runs: runsDir(), access: defaultAccessDir(), search: searchDataDir(), userId: "00000000-0000-4000-8000-000000000001" });
  return { ...actual, currentWorkspace: async () => workspace(), searchDir: async () => searchDataDir() };
});
