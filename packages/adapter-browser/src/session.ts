import { readFile, rm, writeFile } from "node:fs/promises";
import {
  AccessibilityNode,
  countAccessibilityNodes,
  redactBody,
  redactHeaders,
  redactUrl,
  toErrorInfo,
  type AccessibilitySnapshotEvidence,
  type Action,
  type AdapterSession,
  type Assertion,
  type AssertionEvaluation,
  type AssertOptions,
  type BodyCapture,
  type CollectorStatus,
  type ConsoleLevel,
  type ConsoleMessageEvidence,
  type DomSnapshotEvidence,
  type Logger,
  type NetworkExchangeEvidence,
  type Observation,
  type ObserveRequest,
  type PageErrorEvidence,
  type RunEnvironment,
  type RunRecorder,
  type ScreenshotEvidence,
  AxeImpact,
  PageInspectionFile,
  TextBlock,
  TextBlocksFile,
} from "@exegezis/core";
import type { Browser, BrowserContext, ConsoleMessage, Page, Request, Response, WebError } from "playwright";
import { z } from "zod";
import { AxeBuilder } from "@axe-core/playwright";
import { axeSelector, evaluateAssertion } from "./assertions.js";
import { toLocator } from "./locator.js";
import { domSettleScript, highlightScript, MAIN_THREAD_IDLE_SCRIPT, MAIN_VISIBLE_SCRIPT, PAGE_FACTS_SCRIPT, PageFacts, textBlocksScript, UNHIGHLIGHT_SCRIPT } from "./page-scripts.js";
import { drainWithDeadline } from "./drain.js";
import type { BrowserAdapterOptions } from "./options.js";
import { sameSite } from "./same-site.js";
import { sanitizeTraceArchive } from "./trace-redaction.js";

/** What the extraction script returns (validated: page scripts are never trusted). */
const ExtractedText = z.object({ lang: z.string().nullable(), title: z.string(), blocks: z.array(TextBlock), truncated: z.boolean() });

/** axe-core is turned off (search mode): not an error. */
class AxeSkipped extends Error {}

export const TRACE_FILE = "trace.zip";

/** Resource types whose bodies are worth keeping as evidence (API traffic). */
const BODY_RESOURCE_TYPES = new Set(["fetch", "xhr"]);
const TEXT_MEDIA_TYPE = /json|text\/|xml|x-www-form-urlencoded|graphql/i;

type Environment = Pick<RunEnvironment, "adapter" | "browser" | "automation">;

/**
 * One live browser session. All evidence flows through the recorder; this
 * class only keeps in memory what must be joined before it can be written
 * (e.g. a request with its response).
 */
export class BrowserSession implements AdapterSession {
  private readonly consoleMessages: ConsoleMessageEvidence[] = [];
  private readonly pageErrors: PageErrorEvidence[] = [];
  private readonly exchanges: NetworkExchangeEvidence[] = [];
  private readonly exchangeByRequest = new WeakMap<Request, NetworkExchangeEvidence>();
  private readonly accessibilitySnapshots: AccessibilitySnapshotEvidence[] = [];
  private readonly observations: Observation[] = [];
  private readonly screenshots: ScreenshotEvidence[] = [];
  private readonly domSnapshots: DomSnapshotEvidence[] = [];
  /** Async capture work (e.g. response bodies) that must finish before collecting. */
  private readonly pending = new Set<Promise<void>>();
  /** Captures of third-party requests (first-party readiness): waited for briefly, never a failure. */
  private readonly pendingThirdParty = new Set<Promise<void>>();
  /** The site being visited (first navigation): what counts as the page's own requests. */
  private site: string | null = null;
  /** The page's own requests in flight, and when the last one started or ended. */
  private readonly ownInFlight = new Set<Request>();
  private ownActivityAt = Date.now();
  /** Requests aborted by --strict-readonly (see blockPageWrites). */
  private readonly blockedRequests = new WeakSet<Request>();
  private readonly collectorFailures = new Map<string, string>();
  private readonly blockedWrites: { method: string; url: string }[] = [];
  private tracing: boolean;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly options: BrowserAdapterOptions,
    private readonly recorder: RunRecorder,
    private readonly logger: Logger,
    readonly environment: Environment,
    tracing: boolean,
    /** Saved access (session, credentials, token) is loaded: a trace that is not fully redacted is not kept. */
    private readonly withAccess = false,
  ) {
    this.tracing = tracing;
    this.attachListeners();
  }

  /** --strict-readonly: the page may read, never write. Blocked requests are recorded, not hidden. */
  async blockPageWrites(): Promise<void> {
    await this.context.route("**/*", async (route) => {
      const method = route.request().method();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        await route.fallback();
        return;
      }
      this.blockedWrites.push({ method, url: this.url(route.request().url()) });
      // Marked explicitly (the evidence must say why the request failed), from
      // whichever side runs second: Playwright may call this handler before or
      // after the "request" event that creates the evidence.
      this.blockedRequests.add(route.request());
      this.markBlocked(route.request());
      await route.abort("blockedbyclient");
    });
  }

  async execute(action: Action, actionId: string): Promise<void> {
    const page = this.page;
    const timeout = action.type === "screenshot" ? undefined : action.timeoutMs;
    switch (action.type) {
      case "navigate":
        this.site ??= safeHost(action.url);
        await page.goto(action.url, {
          waitUntil: action.waitUntil ?? "load",
          timeout: timeout ?? this.options.navigationTimeoutMs,
        });
        return;
      case "click":
        await toLocator(page, action.target).click({ timeout: timeout ?? this.options.actionTimeoutMs });
        return;
      case "fill": {
        const locator = toLocator(page, action.target);
        const inputType = await locator.getAttribute("type", { timeout: timeout ?? this.options.actionTimeoutMs });
        if (action.sensitive === true || inputType?.toLowerCase() === "password") {
          // Registered before typing so the value is scrubbed from the trace too.
          this.recorder.secrets.addExplicit(action.value);
        }
        await locator.fill(action.value, { timeout: timeout ?? this.options.actionTimeoutMs });
        return;
      }
      case "press":
        if (action.target === undefined) {
          await page.keyboard.press(action.key);
        } else {
          await toLocator(page, action.target).press(action.key, { timeout: timeout ?? this.options.actionTimeoutMs });
        }
        return;
      case "wait": {
        const condition = action.condition;
        const waitTimeout = timeout ?? this.options.actionTimeoutMs;
        if (condition.kind === "timeout") {
          await page.waitForTimeout(condition.ms);
        } else if (condition.kind === "element") {
          await toLocator(page, condition.target).waitFor({ state: condition.state, timeout: waitTimeout });
        } else {
          await page.waitForLoadState(condition.state, { timeout: waitTimeout });
        }
        return;
      }
      case "screenshot":
        await this.captureScreenshot("action", action.name ?? actionId, action.fullPage ?? true);
        return;
    }
  }

  async assert(assertion: Assertion, options: AssertOptions): Promise<AssertionEvaluation> {
    return evaluateAssertion(
      {
        page: this.page,
        baseUrl: options.baseUrl,
        lastResponse: async (method, path) => {
          // Response bodies are captured asynchronously; let them land first.
          await this.drainPending();
          for (let i = this.exchanges.length - 1; i >= 0; i--) {
            const exchange = this.exchanges[i];
            if (exchange?.response === undefined) continue;
            if (method !== undefined && exchange.request.method !== method) continue;
            if (new URL(exchange.request.url).pathname === path) return exchange;
          }
          return undefined;
        },
        consoleMessages: async () => {
          await this.drainPending();
          return this.consoleMessages;
        },
        pageErrors: async () => {
          await this.drainPending();
          return this.pageErrors;
        },
        exchanges: async () => {
          await this.drainPending();
          return this.exchanges;
        },
      },
      assertion,
      { timeoutMs: options.timeoutMs, stabilityMs: options.stabilityMs },
    );
  }

  async observe(request: ObserveRequest): Promise<Observation> {
    const page = this.page;
    const gaps: Observation["gaps"] = [];
    const evidence: Observation["evidence"] = {};

    let settled = false;
    if (this.options.readiness === "first-party") {
      settled = (await this.waitReady()).network;
    } else {
      try {
        await page.waitForLoadState("networkidle", { timeout: this.options.settleTimeoutMs });
        settled = true;
      } catch {
        // Not settling is a fact about the target, recorded in the observation.
      }
    }

    const url = this.url(page.url());
    let title = "";
    try {
      title = await page.title();
    } catch (error) {
      gaps.push({ evidence: "title", reason: toErrorInfo(error).message });
    }

    const label = request.label ?? request.reason;
    const capture = async (name: string, fn: () => Promise<string>): Promise<string | undefined> => {
      try {
        return await fn();
      } catch (error) {
        const info = toErrorInfo(error);
        gaps.push({ evidence: name, reason: info.message });
        this.recorder.emit("COLLECTOR_FAILED", "adapter", { collector: name, error: info });
        this.logger.warn("observation capture failed", { capture: name, error: info.message });
        return undefined;
      }
    };

    const accessibility = await capture("accessibility", () => this.captureAccessibility(url, title));
    if (accessibility !== undefined) evidence.accessibility = accessibility;
    const dom = await capture("dom", () => this.captureDom(url));
    if (dom !== undefined) evidence.dom = dom;
    const screenshot = await capture("screenshot", () =>
      this.captureScreenshot(request.reason === "failure" ? "failure" : "observation", label, true),
    );
    if (screenshot !== undefined) evidence.screenshot = screenshot;

    if (accessibility === undefined && dom === undefined && screenshot === undefined) {
      throw new Error(`observation failed: no evidence could be captured (${gaps.map((g) => g.reason).join("; ")})`);
    }

    const observation: Observation = {
      kind: "browser_page",
      id: this.recorder.ids.next("obs"),
      timestamp: this.recorder.timestamp(),
      ...(request.label === undefined ? {} : { label: request.label }),
      reason: request.reason,
      url,
      title,
      viewport: page.viewportSize(),
      settled,
      evidence,
      gaps,
    };
    this.observations.push(observation);
    this.recorder.emit("OBSERVATION", "adapter", { observationId: observation.id, url, title, settled });
    return observation;
  }

  async collectEvidence(): Promise<Record<string, CollectorStatus>> {
    await this.drainPending();
    const collectors: Record<string, CollectorStatus> = { browser: { status: "ok", detail: this.environment.browser?.version ?? "" } };

    const write = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
        const failure = this.collectorFailures.get(name);
        collectors[name] = failure === undefined ? { status: "ok" } : { status: "failed", detail: failure };
      } catch (error) {
        const info = toErrorInfo(error);
        collectors[name] = { status: "failed", detail: info.message };
        this.recorder.emit("COLLECTOR_FAILED", "adapter", { collector: name, error: info });
      }
    };

    await write("console", () =>
      this.recorder.writeJson(
        "console",
        "console.json",
        { schemaVersion: "exegezis.console/v1", messages: this.consoleMessages, pageErrors: this.pageErrors },
        { description: "Console messages and uncaught page errors" },
      ),
    );
    await write("network", () =>
      this.recorder.writeJson(
        "network",
        "network.json",
        { schemaVersion: "exegezis.network/v1", exchanges: this.exchanges },
        { description: "HTTP requests and responses (credentials redacted)" },
      ),
    );
    await write("accessibility", () =>
      this.recorder.writeJson(
        "accessibility",
        "accessibility.json",
        { schemaVersion: "exegezis.accessibility/v1", snapshots: this.accessibilitySnapshots },
        { description: "Accessibility tree snapshots" },
      ),
    );
    if (this.accessibilitySnapshots.length === 0) {
      collectors["accessibility"] = { status: "failed", detail: "no accessibility snapshot was captured" };
    }
    await write("observations", () =>
      this.recorder.writeJson(
        "observations",
        "observations.json",
        {
          schemaVersion: "exegezis.observations/v1",
          observations: this.observations,
          screenshots: this.screenshots,
          domSnapshots: this.domSnapshots,
        },
        { description: "Observations with their screenshots and DOM snapshots" },
      ),
    );
    collectors["screenshots"] =
      this.screenshots.length > 0
        ? { status: "ok", detail: `${this.screenshots.length} captured` }
        : { status: "failed", detail: "no screenshot was captured" };

    if (this.options.coverage) {
      await write("coverage", async () => {
        const entries = await this.page.coverage.stopJSCoverage();
        const scripts = entries
          .filter((e) => /^https?:/.test(e.url))
          .map((e) => ({
            // The URL path; the caller maps it to a source file if it can.
            file: new URL(e.url).pathname,
            url: e.url,
            functions: e.functions.map((f) => ({ functionName: f.functionName, ranges: f.ranges, isBlockCoverage: f.isBlockCoverage })),
          }));
        await this.recorder.writeJson(
          "coverage",
          "coverage.json",
          { schemaVersion: "exegezis.coverage/v1", runtime: "browser", scripts },
          { description: "JavaScript execution coverage of the page (V8)" },
        );
      });
    }
    if (this.options.inspect) await write("inspection", () => this.collectInspection());
    collectors["trace"] = await this.saveTrace();
    for (const [name, detail] of this.collectorFailures) {
      collectors[name] ??= { status: "failed", detail };
    }
    return collectors;
  }

  async close(): Promise<void> {
    try {
      await this.context.close();
    } finally {
      await this.browser.close();
      this.recorder.emit("ADAPTER_STOPPED", "adapter", { adapterId: this.environment.adapter.id });
    }
  }

  /**
   * Web inspection evidence of the current page: links, metadata, axe-core
   * (WCAG 2.1 A/AA) with the violating nodes outlined in a screenshot, and
   * deterministic block signals. Reads only; it never interacts with the page.
   */
  private async collectInspection(): Promise<void> {
    const page = this.page;
    let network = true;
    let dom: boolean;
    if (this.options.readiness === "first-party") {
      ({ network, dom } = await this.waitReady());
    } else {
      try {
        await page.waitForLoadState("networkidle", { timeout: this.options.settleTimeoutMs });
      } catch {
        network = false;
      }
      dom = await page.evaluate<boolean>(domSettleScript(this.options.domSettleTimeoutMs)).catch(() => false);
    }
    const facts = PageFacts.parse(await page.evaluate<unknown>(PAGE_FACTS_SCRIPT));

    let axe: PageInspectionFile["axe"] = null;
    let axeError: string | null = null;
    let highlight: string | null = null;
    try {
      if (!this.options.axe) throw new AxeSkipped();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const rules = [...new Set([...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map((r) => r.id))].sort();
      axe = {
        version: results.testEngine.version,
        rules,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: AxeImpact.safeParse(v.impact).data ?? null,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n) => ({
            selector: axeSelector(n.target as (string | string[])[]),
            html: n.html.slice(0, 500),
            summary: (n.failureSummary ?? "").slice(0, 500),
          })),
        })),
      };
      const selectors = axe.violations.flatMap((v) => v.nodes.map((n) => n.selector)).filter((s) => !s.includes(">>>")).slice(0, 10);
      if (selectors.length > 0) {
        await page.evaluate(highlightScript(selectors));
        const image = await page.screenshot({ fullPage: true });
        const entry = await this.recorder.writeBinary("screenshot", "screenshots/axe-highlight.png", image, "image/png");
        highlight = entry.path;
        await page.evaluate(UNHIGHLIGHT_SCRIPT);
      }
    } catch (error) {
      if (!(error instanceof AxeSkipped)) axeError = toErrorInfo(error).message;
    }

    const file: PageInspectionFile = {
      schemaVersion: "exegezis.page-inspection/v1",
      url: this.url(page.url()),
      settled: { network, dom },
      meta: facts.meta,
      links: facts.links.map((l) => ({ href: this.url(l.href), text: l.text })),
      axe,
      axeError,
      highlight,
      blockSignals: {
        markers: facts.markers,
        passwordField: facts.passwordField,
        login: facts.login,
        consent: facts.consent,
        // Names only: the values are session secrets and never leave the browser context.
        cookieNames: [...new Set((await this.context.cookies().catch(() => [])).map((c) => c.name))].sort(),
      },
      blockedWrites: this.blockedWrites,
    };
    await this.recorder.writeJson("inspection", "inspection.json", PageInspectionFile.parse(file), {
      description: "Web inspection: links, metadata, axe-core results, block signals",
    });
    if (this.options.extractText) {
      const extracted = ExtractedText.parse(await page.evaluate<unknown>(textBlocksScript(this.options.includeHiddenText)));
      const blocks: TextBlocksFile = { schemaVersion: "exegezis.text-blocks/v1", url: this.url(page.url()), ...extracted };
      await this.recorder.writeJson("text_blocks", "text-blocks.json", TextBlocksFile.parse(blocks), {
        description: "Page text in blocks (search extraction), with selectors, positions and visibility",
      });
    }
  }

  private async saveTrace(): Promise<CollectorStatus> {
    if (!this.tracing) return { status: "skipped", detail: "tracing disabled" };
    this.tracing = false;
    const path = this.recorder.resolve(TRACE_FILE);
    try {
      await this.context.tracing.stop({ path });
    } catch (error) {
      const info = toErrorInfo(error);
      this.recorder.emit("COLLECTOR_FAILED", "adapter", { collector: "trace", error: info });
      return { status: "failed", detail: info.message };
    }
    try {
      const result = sanitizeTraceArchive(await readFile(path), this.recorder.secrets);
      if (this.withAccess && result.leaks > 0) {
        await rm(path, { force: true });
        this.recorder.emit("COLLECTOR_FAILED", "adapter", { collector: "trace", error: { name: "TraceNotRedacted", message: `${result.leaks} secret value(s) could not be removed` } });
        return { status: "failed", detail: `trace discarded: ${result.leaks} secret value(s) of the saved access could not be redacted` };
      }
      await writeFile(path, result.data);
      this.logger.info("trace sanitized", { ...result, data: undefined });
      await this.recorder.registerFile("trace", TRACE_FILE, "application/zip", result.leaks === 0 ? "verified" : "failed", {
        description: "Playwright trace (open with `npx playwright show-trace`)",
      });
      this.recorder.emit("TRACE_SAVED", "adapter", { path: TRACE_FILE });
      return result.leaks === 0
        ? { status: "ok" }
        : { status: "failed", detail: `${result.leaks} tracked secret value(s) remain in the trace` };
    } catch (error) {
      // Never keep a trace we could not redact.
      await rm(path, { force: true });
      const info = toErrorInfo(error);
      this.recorder.emit("COLLECTOR_FAILED", "adapter", { collector: "trace", error: info });
      return { status: "failed", detail: `trace discarded, redaction failed: ${info.message}` };
    }
  }

  private async captureAccessibility(url: string, title: string): Promise<string> {
    const raw: unknown = await this.page.ariaSnapshotJSON({ timeout: this.options.actionTimeoutMs });
    const tree = z.array(AccessibilityNode).parse(normalizeAriaNodes(raw));
    const snapshot: AccessibilitySnapshotEvidence = {
      kind: "accessibility_snapshot",
      id: this.recorder.ids.next("ax"),
      timestamp: this.recorder.timestamp(),
      pageUrl: url,
      title,
      format: "playwright-aria-json",
      nodeCount: countAccessibilityNodes(tree),
      tree,
    };
    this.accessibilitySnapshots.push(snapshot);
    this.recorder.emit("ACCESSIBILITY_SNAPSHOT", "adapter", { evidenceId: snapshot.id, nodeCount: snapshot.nodeCount });
    return snapshot.id;
  }

  private async captureDom(url: string): Promise<string> {
    const html = await this.page.content();
    const id = this.recorder.ids.next("dom");
    const path = `dom/${id}.html`;
    const entry = await this.recorder.writeText("dom_snapshot", path, html, "text/html", { description: `DOM of ${url}` });
    this.domSnapshots.push({ kind: "dom_snapshot", id, timestamp: entry.createdAt, pageUrl: url, path, sizeBytes: entry.sizeBytes });
    this.recorder.emit("DOM_SNAPSHOT", "adapter", { evidenceId: id, path });
    return id;
  }

  private async captureScreenshot(reason: ScreenshotEvidence["reason"], label: string, fullPage: boolean): Promise<string> {
    const image = await this.page.screenshot({ fullPage, timeout: this.options.actionTimeoutMs });
    const id = this.recorder.ids.next("shot");
    const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 48);
    const path = `screenshots/${id}-${safeLabel}.png`;
    const entry = await this.recorder.writeBinary("screenshot", path, image, "image/png");
    const event = this.recorder.emit("SCREENSHOT", "adapter", { evidenceId: id, path, reason });
    this.screenshots.push({
      kind: "screenshot",
      id,
      timestamp: entry.createdAt,
      path,
      fullPage,
      pageUrl: this.url(this.page.url()),
      reason,
      triggerEventId: event.id,
    });
    return id;
  }

  private attachListeners(): void {
    const { context, page } = this;
    context.on("console", (message) => this.guard("console", () => this.onConsole(message)));
    context.on("weberror", (error) => this.guard("console", () => this.onWebError(error)));
    context.on("request", (request) => {
      this.trackOwn(request, true);
      this.guard("network", () => this.onRequest(request), this.thirdParty(request));
    });
    context.on("response", (response) => this.guard("network", () => this.onResponse(response), this.thirdParty(response.request())));
    context.on("requestfinished", (request) => {
      this.trackOwn(request, false);
      this.guard("network", () => this.onRequestFinished(request), this.thirdParty(request));
    });
    context.on("requestfailed", (request) => {
      this.trackOwn(request, false);
      this.guard("network", () => this.onRequestFailed(request), this.thirdParty(request));
    });
    page.on("load", () =>
      this.guard("page", () => {
        this.recorder.emit("PAGE_LOADED", "page", { url: this.url(page.url()) });
      }),
    );
    page.on("framenavigated", (frame) =>
      this.guard("page", () => {
        if (frame === page.mainFrame()) this.recorder.emit("PAGE_NAVIGATED", "page", { url: this.url(frame.url()) });
      }),
    );
    page.on("crash", () =>
      this.guard("page", () => {
        this.recorder.emit("PAGE_CRASHED", "page", { url: this.url(page.url()) });
        this.logger.error("page crashed", { url: page.url() });
      }),
    );
  }

  /**
   * Listener bodies must never throw into Playwright's event loop. A failure
   * is recorded against its collector, which is then reported as failed.
   */
  private guard(collector: string, fn: () => void | Promise<void>, thirdParty = false): void {
    const onError = (error: unknown): void => {
      const info = toErrorInfo(error);
      this.collectorFailures.set(collector, info.message);
      this.logger.error("collector failed", { collector, error: info.message });
      try {
        this.recorder.emit("COLLECTOR_FAILED", "adapter", { collector, error: info });
      } catch {
        // Recording the failure itself failed; the log line above remains.
      }
    };
    try {
      const result = fn();
      if (result instanceof Promise) this.track(result.catch(onError), thirdParty);
    } catch (error) {
      onError(error);
    }
  }

  private track(promise: Promise<void>, thirdParty = false): void {
    // Third parties are set apart only with first-party readiness; otherwise every capture counts the same.
    const set = thirdParty && this.options.readiness === "first-party" ? this.pendingThirdParty : this.pending;
    set.add(promise);
    void promise.finally(() => set.delete(promise));
  }

  private async drainPending(): Promise<void> {
    const left = await drainWithDeadline(this.pending, this.options.captureDrainTimeoutMs);
    if (left > 0) {
      // The recorded network/console evidence is incomplete: say so, never wait forever.
      this.collectorFailures.set("network", `${left} capture(s) still pending after ${this.options.captureDrainTimeoutMs} ms; the network evidence is incomplete`);
    }
    // Ads and analytics that never finish do not hold the page: a short wait, then what has arrived is written.
    await drainWithDeadline(this.pendingThirdParty, this.options.thirdPartyDrainTimeoutMs);
  }

  /** Is this request to another site than the one being visited (ads, analytics, chat, CDNs of others)? */
  private thirdParty(request: Request): boolean {
    return this.site !== null && !sameSite(this.site, safeHost(request.url()));
  }

  private trackOwn(request: Request, started: boolean): void {
    if (this.options.readiness !== "first-party" || this.thirdParty(request)) return;
    if (started) this.ownInFlight.add(request);
    else this.ownInFlight.delete(request);
    this.ownActivityAt = Date.now();
  }

  /**
   * First-party readiness: no request to the page's own site in flight for
   * 500 ms, the DOM stable for 500 ms and the main content visible, within
   * readyTimeoutMs. Third-party requests are not waited for. Returns which
   * signals were reached (not reaching them is a fact about the page).
   */
  private async waitReady(): Promise<{ network: boolean; dom: boolean }> {
    const page = this.page;
    const deadline = Date.now() + this.options.readyTimeoutMs;
    const quietMs = 500;
    let network = false;
    while (Date.now() < deadline) {
      if (this.ownInFlight.size === 0 && Date.now() - this.ownActivityAt >= quietMs) {
        const visible = await page.evaluate<boolean>(MAIN_VISIBLE_SCRIPT).catch(() => false);
        if (visible) {
          network = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // The page's own work after its requests (hydration, rendering): wait until its main thread is idle,
    // and for the load event, briefly (third-party iframes and ads can hold it back for a long time).
    await page.evaluate<boolean>(MAIN_THREAD_IDLE_SCRIPT).catch(() => false);
    await page.waitForLoadState("load", { timeout: Math.max(0, Math.min(this.options.loadGraceMs, deadline - Date.now())) }).catch(() => undefined);
    const left = Math.max(quietMs + 100, deadline - Date.now());
    const dom = await page.evaluate<boolean>(domSettleScript(Math.min(left, this.options.domSettleTimeoutMs))).catch(() => false);
    await page.evaluate<boolean>(MAIN_THREAD_IDLE_SCRIPT).catch(() => false);
    return { network, dom };
  }

  private onConsole(message: ConsoleMessage): void {
    const location = message.location();
    const evidence: ConsoleMessageEvidence = {
      kind: "console_message",
      id: this.recorder.ids.next("con"),
      timestamp: new Date(message.timestamp()).toISOString(),
      level: consoleLevel(message.type()),
      apiType: message.type(),
      text: message.text(),
      ...(location.url === "" ? {} : { location: { url: this.url(location.url), line: location.line, column: location.column } }),
      ...(message.page() === null ? {} : { pageUrl: this.url(message.page()?.url() ?? "") }),
    };
    this.consoleMessages.push(evidence);
    this.recorder.emit("CONSOLE_MESSAGE", "console", {
      evidenceId: evidence.id,
      level: evidence.level,
      text: truncate(evidence.text, 500),
    });
  }

  private onWebError(webError: WebError): void {
    const error = webError.error();
    const location = webError.location();
    const evidence: PageErrorEvidence = {
      kind: "page_error",
      id: this.recorder.ids.next("err"),
      timestamp: this.recorder.timestamp(),
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...(location.url === "" ? {} : { location: { url: this.url(location.url), line: location.line, column: location.column } }),
      ...(webError.page() === null ? {} : { pageUrl: this.url(webError.page()?.url() ?? "") }),
    };
    this.pageErrors.push(evidence);
    this.recorder.emit("PAGE_ERROR", "page", { evidenceId: evidence.id, name: evidence.name, message: truncate(evidence.message, 500) });
  }

  private async onRequest(request: Request): Promise<void> {
    const timestamp = this.recorder.timestamp();
    const evidence: NetworkExchangeEvidence = {
      kind: "network_exchange",
      id: this.recorder.ids.next("net"),
      request: {
        timestamp,
        method: request.method(),
        url: this.url(request.url()),
        resourceType: request.resourceType(),
        isNavigation: request.isNavigationRequest(),
        // Provisional headers; replaced below with the full set (incl. cookies).
        headers: redactHeaders(request.headers(), this.recorder.secrets),
      },
    };
    this.exchanges.push(evidence);
    this.exchangeByRequest.set(request, evidence);
    if (this.blockedRequests.has(request)) this.markBlocked(request);
    this.recorder.emit("NETWORK_REQUEST", "network", {
      evidenceId: evidence.id,
      method: evidence.request.method,
      url: evidence.request.url,
      resourceType: evidence.request.resourceType,
    });

    evidence.request.headers = redactHeaders(await request.allHeaders(), this.recorder.secrets);
    if (this.shouldCaptureBody(request.resourceType())) {
      const body = request.postDataBuffer();
      if (body !== null) {
        const mediaType = (await request.headerValue("content-type")) ?? "application/octet-stream";
        evidence.request.body = this.captureBody(body, mediaType);
      }
    }
  }

  private async onResponse(response: Response): Promise<void> {
    const evidence = this.exchangeByRequest.get(response.request());
    if (evidence === undefined) return;
    evidence.response = {
      timestamp: this.recorder.timestamp(),
      status: response.status(),
      statusText: response.statusText(),
      headers: redactHeaders(response.headers(), this.recorder.secrets),
      fromServiceWorker: response.fromServiceWorker(),
    };
    this.recorder.emit("NETWORK_RESPONSE", "network", {
      evidenceId: evidence.id,
      status: evidence.response.status,
      url: evidence.request.url,
    });
    const headers = await response.allHeaders();
    evidence.response.headers = redactHeaders(headers, this.recorder.secrets);
  }

  private async onRequestFinished(request: Request): Promise<void> {
    const evidence = this.exchangeByRequest.get(request);
    const response = await request.response();
    if (evidence === undefined || response === null) return;
    const timing = request.timing();
    if (timing.responseEnd >= 0) evidence.durationMs = Math.round(timing.responseEnd * 1000) / 1000;
    if (evidence.response === undefined || !this.shouldCaptureBody(request.resourceType())) return;
    const mediaType = (await response.headerValue("content-type")) ?? "application/octet-stream";
    try {
      evidence.response.body = this.captureBody(await response.body(), mediaType);
    } catch (error) {
      evidence.response.body = { captured: false, reason: `body unavailable: ${toErrorInfo(error).message}` };
    }
  }

  private markBlocked(request: Request): void {
    const evidence = this.exchangeByRequest.get(request);
    if (evidence !== undefined && evidence.failure === undefined) {
      evidence.failure = { timestamp: this.recorder.timestamp(), errorText: "net::ERR_BLOCKED_BY_CLIENT (EXEGEZIS --strict-readonly)" };
    }
  }

  private onRequestFailed(request: Request): void {
    const evidence = this.exchangeByRequest.get(request);
    if (evidence === undefined) return;
    // A write blocked by --strict-readonly keeps the explicit reason set by markBlocked.
    if (evidence.failure === undefined) evidence.failure = { timestamp: this.recorder.timestamp(), errorText: request.failure()?.errorText ?? "unknown" };
    const errorText = evidence.failure.errorText;
    this.recorder.emit("NETWORK_FAILED", "network", { evidenceId: evidence.id, url: evidence.request.url, errorText });
  }

  private shouldCaptureBody(resourceType: string): boolean {
    return this.options.captureBodies && BODY_RESOURCE_TYPES.has(resourceType);
  }

  private captureBody(body: Buffer, mediaType: string): BodyCapture {
    if (!TEXT_MEDIA_TYPE.test(mediaType)) {
      return { captured: false, reason: `non-text media type: ${mediaType}`, sizeBytes: body.byteLength };
    }
    const truncated = body.byteLength > this.options.maxBodyBytes;
    if (truncated && /json|x-www-form-urlencoded/i.test(mediaType)) {
      // A truncated structured body cannot be parsed, hence cannot be redacted by key.
      return {
        captured: false,
        reason: `structured body larger than maxBodyBytes (${this.options.maxBodyBytes}); not captured because it cannot be redacted safely`,
        sizeBytes: body.byteLength,
      };
    }
    const text = body.subarray(0, this.options.maxBodyBytes).toString("utf8");
    return {
      captured: true,
      mediaType,
      sizeBytes: body.byteLength,
      truncated,
      text: redactBody(text, mediaType, this.recorder.secrets),
    };
  }

  private url(url: string): string {
    return redactUrl(url, this.recorder.secrets);
  }
}

/**
 * `ariaSnapshotJSON()` mixes node objects with bare strings for static text
 * fragments (e.g. `["One", {role: "button", ...}]`). Normalizes strings to
 * `{role: "text", text}` so every node has the same shape.
 */
export function normalizeAriaNodes(raw: unknown): unknown[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [raw];
  return list.map((node) => {
    if (typeof node === "string") return { role: "text", text: node };
    if (node !== null && typeof node === "object" && "children" in node) {
      return { ...node, children: normalizeAriaNodes(node.children) };
    }
    return node;
  });
}

function consoleLevel(type: string): ConsoleLevel {
  switch (type) {
    case "log":
    case "debug":
    case "info":
    case "error":
    case "warning":
    case "trace":
      return type;
    case "assert":
      return "error";
    default:
      return "other";
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
