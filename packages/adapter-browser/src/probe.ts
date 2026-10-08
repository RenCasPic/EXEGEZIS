import { request, type APIRequestContext } from "playwright";

export interface HttpProbeOptions {
  userAgent: string;
  /** Playwright storageState file; read by Playwright, never recorded. */
  storageState?: string;
  /** Tests only (self-signed fixtures). Not exposed by the CLI. */
  ignoreHTTPSErrors?: boolean;
  timeoutMs: number;
}

export type ProbeResult =
  | { ok: true; status: number; finalUrl: string; contentType: string | null; text: string | null }
  | { ok: false; error: string };

const MAX_TEXT_BYTES = 256 * 1024;

/**
 * The inspection's own HTTP requests (link checks, robots.txt). By
 * construction it can only GET and HEAD: there is no method to do anything else.
 */
export class HttpProbe {
  private constructor(private readonly context: APIRequestContext) {}

  static async create(options: HttpProbeOptions): Promise<HttpProbe> {
    const context = await request.newContext({
      userAgent: options.userAgent,
      timeout: options.timeoutMs,
      ignoreHTTPSErrors: options.ignoreHTTPSErrors === true,
      ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
    });
    return new HttpProbe(context);
  }

  get(url: string, options: { text?: boolean } = {}): Promise<ProbeResult> {
    return this.send("GET", url, options.text === true);
  }

  head(url: string): Promise<ProbeResult> {
    return this.send("HEAD", url, false);
  }

  /**
   * Whether a link works, as safely as HTTP allows: HEAD first; GET only when
   * the server does not support HEAD (405, 501). Redirects are followed one hop
   * at a time and stop before any address `refuse` turns down (an action, a
   * technical route): that hop is never requested.
   */
  async check(url: string, refuse: (url: string) => string | null, maxHops = 10): Promise<ProbeResult & { refused?: string }> {
    let current = url;
    let method: "HEAD" | "GET" = "HEAD";
    try {
      for (let i = 0; i <= maxHops; i++) {
        const reason = refuse(current);
        if (reason !== null) return { ok: false, error: `not requested: ${reason}`, refused: reason };
        const response = method === "HEAD" ? await this.context.head(current, { failOnStatusCode: false, maxRedirects: 0 }) : await this.context.get(current, { failOnStatusCode: false, maxRedirects: 0 });
        const status = response.status();
        const location = response.headers()["location"];
        const contentType = response.headers()["content-type"] ?? null;
        await response.dispose();
        if (method === "HEAD" && (status === 405 || status === 501)) {
          method = "GET";
          i--;
          continue;
        }
        if (status < 300 || status >= 400 || location === undefined) return { ok: true, status, finalUrl: current, contentType, text: null };
        current = new URL(location, current).href;
      }
      return { ok: false, error: "too many redirects" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error) };
    }
  }

  /**
   * Follows a URL's redirects one hop at a time (GET), up to `maxHops`, and
   * returns every answer: where HTTP leads, how long the chain is.
   */
  async trace(url: string, maxHops = 10): Promise<{ hops: { url: string; status: number }[]; error: string | null }> {
    const hops: { url: string; status: number }[] = [];
    let current = url;
    try {
      for (let i = 0; i <= maxHops; i++) {
        const response = await this.context.get(current, { failOnStatusCode: false, maxRedirects: 0 });
        const status = response.status();
        const location = response.headers()["location"];
        await response.dispose();
        hops.push({ url: current, status });
        if (status < 300 || status >= 400 || location === undefined) return { hops, error: null };
        current = new URL(location, current).href;
      }
      return { hops, error: "too many redirects" };
    } catch (error) {
      return { hops, error: error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error) };
    }
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }

  private async send(method: "GET" | "HEAD", url: string, withText: boolean): Promise<ProbeResult> {
    try {
      const response = method === "GET" ? await this.context.get(url, { failOnStatusCode: false, maxRedirects: 10 }) : await this.context.head(url, { failOnStatusCode: false, maxRedirects: 10 });
      let text: string | null = null;
      if (withText) {
        const body = await response.body();
        text = body.subarray(0, MAX_TEXT_BYTES).toString("utf8");
      }
      const result: ProbeResult = { ok: true, status: response.status(), finalUrl: response.url(), contentType: response.headers()["content-type"] ?? null, text };
      await response.dispose();
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error) };
    }
  }
}
