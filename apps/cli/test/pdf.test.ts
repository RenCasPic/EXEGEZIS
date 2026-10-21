import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCliArgs, UsageError } from "../src/args.js";
import { main } from "../src/main.js";

/** `exegezis pdf`: HTML to a tagged PDF, with no JavaScript and no network. */

let workDir: string;
let server: Server;
let calls = 0;
let base = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "exegezis-pdf-"));
  server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "image/png" });
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await rm(workDir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const code = await main(argv, { stdout: { write: (text: string) => (stdout += text) }, stderr: new PassThrough(), cwd: workDir });
  return { code, stdout };
}

describe("exegezis pdf", () => {
  it("needs --html and an --output ending in .pdf; --html belongs to pdf only", () => {
    expect(parseCliArgs(["pdf", "--html", "r.html", "--output", "r.pdf"])).toEqual({ kind: "pdf", html: "r.html", output: "r.pdf" });
    expect(() => parseCliArgs(["pdf", "--output", "r.pdf"])).toThrow(UsageError);
    expect(() => parseCliArgs(["pdf", "--html", "r.html"])).toThrow(UsageError);
    expect(() => parseCliArgs(["inspect", "--url", "https://a.test", "--html", "r.html"])).toThrow(UsageError);
  });

  it("prints the HTML to a PDF and requests nothing (no script runs, no image is fetched)", async () => {
    const html = join(workDir, "report.html");
    await writeFile(html, `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe</title></head><body><h1>Informe</h1><img src="${base}/tracker.png" alt=""><script>fetch("${base}/script")</script></body></html>`);
    const out = join(workDir, "report.pdf");
    const r = await cli(["--lang", "es", "pdf", "--html", html, "--output", out]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("PDF escrito");
    expect(readFileSync(out).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(calls).toBe(0);
  }, 120_000);
});
