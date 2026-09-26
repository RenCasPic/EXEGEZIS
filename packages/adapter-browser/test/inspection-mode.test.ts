import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NetworkFile, PageInspectionFile, RunRecorder, silentLogger } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserAdapter, HttpProbe, type BrowserAdapterOptionsInput } from "../src/index.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/server.js";

let server: FixtureServer;
let outputDir: string;
const UA = "EXEGEZIS-Inspector/test";

beforeAll(async () => {
  server = await startFixtureServer();
  outputDir = await mkdtemp(join(tmpdir(), "exegezis-inspect-mode-"));
});

afterAll(async () => {
  await server.close();
  await rm(outputDir, { recursive: true, force: true });
});

/** Loads a page in inspection mode and returns what the adapter recorded. */
async function inspect(path: string, options: BrowserAdapterOptionsInput = {}) {
  const recorder = await RunRecorder.create({ outputDir });
  const session = await new BrowserAdapter({ inspect: true, userAgent: UA, trace: false, ...options }).start({ recorder, logger: silentLogger });
  try {
    await session.execute({ type: "navigate", url: `${server.url}${path}` }, "act-0001");
    await session.collectEvidence();
  } finally {
    await session.close();
  }
  const page = PageInspectionFile.parse(JSON.parse(await readFile(join(recorder.dir, "inspection.json"), "utf8")));
  const network = NetworkFile.parse(JSON.parse(await readFile(join(recorder.dir, "network.json"), "utf8")));
  return { page, network, dir: recorder.dir };
}

describe("inspection mode", () => {
  it("records links, metadata and axe results with the axe version and the rules it ran", async () => {
    const { page } = await inspect("/health");
    expect(page.links.map((l) => new URL(l.href).pathname)).toEqual(["/assertions", "/missing-page"]);
    expect(page.meta).toMatchObject({ title: "Health", lang: "en", h1Count: 1, protocol: "http:" });
    expect(page.axe?.version).toBe("4.13.0");
    expect(page.axe?.rules).toContain("image-alt");
    const imageAlt = page.axe?.violations.find((v) => v.id === "image-alt");
    expect(imageAlt?.nodes.map((n) => n.selector)).toEqual(["#logo"]);
    expect(page.highlight).toBe("screenshots/axe-highlight.png");
    expect(page.settled).toEqual({ network: true, dom: true });
    expect(page.blockSignals).toMatchObject({ markers: [], passwordField: false, consent: null, cookieNames: [], login: { visiblePassword: false } });
  }, 60_000);

  it("identifies itself with its own User-Agent", async () => {
    const { network } = await inspect("/health");
    const document = network.exchanges.find((x) => x.request.isNavigation);
    expect(document?.request.headers["user-agent"]).toBe(UA);
  }, 60_000);

  it("records deterministic block signals and never acts on them", async () => {
    const { page, network } = await inspect("/challenge");
    expect(page.blockSignals.markers).toEqual(expect.arrayContaining([".g-recaptcha", "text: Verify you are human"]));
    expect(network.exchanges.every((x) => x.request.method === "GET")).toBe(true);
  }, 60_000);

  it("lets the page's own writes through by default and records them", async () => {
    const { page, network } = await inspect("/assertions");
    expect(page.blockedWrites).toEqual([]);
    const write = network.exchanges.find((x) => x.request.method === "POST");
    expect(write?.response?.status).toBe(200);
  }, 60_000);

  it("--strict-readonly blocks the page's writes and records each one", async () => {
    const { page, network } = await inspect("/assertions", { blockPageWrites: true });
    expect(page.blockedWrites).toEqual([{ method: "POST", url: `${server.url}/api/total` }]);
    const write = network.exchanges.find((x) => x.request.method === "POST");
    expect(write?.response).toBeUndefined();
    expect(write?.failure?.errorText).toMatch(/BLOCKED_BY_CLIENT/i);
  }, 60_000);
});

describe("HttpProbe", () => {
  it("can only GET and HEAD", async () => {
    const methods = Object.getOwnPropertyNames(HttpProbe.prototype).filter((m) => m !== "constructor");
    expect(methods.sort()).toEqual(["dispose", "get", "head", "send"]);
    const probe = await HttpProbe.create({ userAgent: UA, timeoutMs: 5_000 });
    try {
      expect(await probe.get(`${server.url}/assertions`)).toMatchObject({ ok: true, status: 200 });
      expect(await probe.head(`${server.url}/missing-page`)).toMatchObject({ ok: true, status: 404 });
      expect(await probe.get("http://127.0.0.1:1/")).toMatchObject({ ok: false });
    } finally {
      await probe.dispose();
    }
  }, 60_000);
});
