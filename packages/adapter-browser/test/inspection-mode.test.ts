import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
    // trace() follows redirects one hop at a time, with GET as well.
    expect(methods.sort()).toEqual(["check", "dispose", "get", "head", "send", "trace"]);
    const probe = await HttpProbe.create({ userAgent: UA, timeoutMs: 5_000 });
    try {
      expect(await probe.get(`${server.url}/assertions`)).toMatchObject({ ok: true, status: 200 });
      expect(await probe.head(`${server.url}/missing-page`)).toMatchObject({ ok: true, status: 404 });
      expect(await probe.get("http://127.0.0.1:1/")).toMatchObject({ ok: false });
      expect(await probe.trace(`${server.url}/missing-page`)).toEqual({ hops: [{ url: `${server.url}/missing-page`, status: 404 }], error: null });
      expect((await probe.trace("http://127.0.0.1:1/")).error).not.toBeNull();
    } finally {
      await probe.dispose();
    }
  }, 60_000);
});

describe("HttpProbe.check: links checked safely (docs/07 §4)", () => {
  it("HEAD first, GET only when HEAD is not supported, and a redirect towards a refused address is never followed", async () => {
    const calls: string[] = [];
    const site = createServer((req, res) => {
      calls.push(`${req.method ?? ""} ${req.url ?? ""}`);
      if (req.url === "/no-head" && req.method === "HEAD") {
        res.writeHead(405);
        res.end();
      } else if (req.url === "/go") {
        res.writeHead(302, { location: "/logout" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      }
    });
    await new Promise<void>((done) => site.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    const probe = await HttpProbe.create({ userAgent: UA, timeoutMs: 5_000 });
    const refuse = (url: string) => (url.endsWith("/logout") ? "an action" : null);
    try {
      expect(await probe.check(`${base}/page`, refuse)).toMatchObject({ ok: true, status: 200 });
      expect(await probe.check(`${base}/no-head`, refuse)).toMatchObject({ ok: true, status: 200 });
      expect(await probe.check(`${base}/go`, refuse)).toMatchObject({ ok: false, refused: "an action" });
      expect(await probe.check(`${base}/logout`, refuse)).toMatchObject({ ok: false, refused: "an action" });
    } finally {
      await probe.dispose();
      site.close();
    }
    expect(calls).toEqual(["HEAD /page", "HEAD /no-head", "GET /no-head", "HEAD /go"]);
  }, 60_000);
});
