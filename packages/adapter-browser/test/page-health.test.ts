import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Assertion, RunRecorder, silentLogger, type AdapterSession, type AssertionEvaluation, type AssertionInput } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { axeSelector, BrowserAdapter, matchesRequestUrl } from "../src/index.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/server.js";

let server: FixtureServer;
let outputDir: string;
let session: AdapterSession;

beforeAll(async () => {
  server = await startFixtureServer();
  outputDir = await mkdtemp(join(tmpdir(), "exegezis-health-"));
  const recorder = await RunRecorder.create({ outputDir });
  session = await new BrowserAdapter().start({ recorder, logger: silentLogger });
  await session.execute({ type: "navigate", url: `${server.url}/health` }, "act-0001");
  await session.execute({ type: "wait", condition: { kind: "loadState", state: "networkidle" } }, "act-0002");
}, 60_000);

afterAll(async () => {
  await session.close();
  await server.close();
  await rm(outputDir, { recursive: true, force: true });
});

function check(assertion: AssertionInput): Promise<AssertionEvaluation> {
  return session.assert(Assertion.parse(assertion), { timeoutMs: 2_000, stabilityMs: 100, baseUrl: `${server.url}/` });
}

describe("page-health assertions", () => {
  it("console: fails on a matching console error, passes otherwise", async () => {
    expect(await check({ kind: "console", level: "error", contains: "fixture console failure", expected: "absent" })).toMatchObject({ status: "failed" });
    expect(await check({ kind: "console", level: "error", contains: "never logged", expected: "absent" })).toMatchObject({ status: "passed" });
  });

  it("page_error: fails on a matching uncaught exception", async () => {
    expect(await check({ kind: "page_error", contains: "fixture health exception", expected: "absent" })).toMatchObject({ status: "failed" });
    expect(await check({ kind: "page_error", contains: "something else", expected: "absent" })).toMatchObject({ status: "passed" });
  });

  it("request: fails when the page's request answered >= 400; passes when it succeeded or never happened", async () => {
    const failed = await check({ kind: "request", request: { method: "GET", url: "/api/broken" }, expected: "ok" });
    expect(failed).toMatchObject({ status: "failed", actual: ["500"] });
    expect(await check({ kind: "request", request: { url: "/logo.svg" }, expected: "ok" })).toMatchObject({ status: "passed" });
    expect(await check({ kind: "request", request: { url: "/never" }, expected: "ok" })).toMatchObject({ status: "passed", actual: "not requested" });
  });

  it("link: a GET made by the assertion itself", async () => {
    expect(await check({ kind: "link", url: "/missing-page", expected: "ok" })).toMatchObject({ status: "failed", actual: 404 });
    expect(await check({ kind: "link", url: "/assertions", expected: "ok" })).toMatchObject({ status: "passed", actual: 200 });
  });

  it("a11y: compares by rule + node selector, never by a total count", async () => {
    expect(await check({ kind: "a11y", rule: "image-alt", selector: "#logo", expected: "no_violation" })).toMatchObject({ status: "failed" });
    expect(await check({ kind: "a11y", rule: "image-alt", selector: "#described", expected: "no_violation" })).toMatchObject({ status: "passed" });
  });
});

describe("helpers", () => {
  it("matches request URLs by absolute URL or by path", () => {
    expect(matchesRequestUrl("http://a.test/api/x?q=1", "/api/x?q=1")).toBe(true);
    expect(matchesRequestUrl("http://a.test/api/x?q=1", "/api/x")).toBe(true);
    expect(matchesRequestUrl("http://a.test/api/x#f", "http://a.test/api/x")).toBe(true);
    expect(matchesRequestUrl("http://a.test/api/y", "/api/x")).toBe(false);
  });
  it("joins axe targets", () => {
    expect(axeSelector(["#a"])).toBe("#a");
    expect(axeSelector([["iframe", "#b"], "#c"])).toBe("iframe >>> #b #c");
  });
});
