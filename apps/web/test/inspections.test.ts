import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS } from "@exegezis/inspect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/api/artifacts/[id]/[...path]/route";
import { discover } from "../src/lib/evidence/discover";
import { filterFindings, loadFindingEvidence, pageRows, parseFindingFilters, sortFindings } from "../src/lib/evidence/inspections";
import { INSPECT_CHECKS, parseInspectForm } from "../src/lib/inspect-options";
import { inspectionJobState } from "../src/lib/inspection-state";
import { commandFor, JobRecord, readJob, startInspection } from "../src/lib/jobs";
import { buildReport, writeInspection } from "./inspection-fixture";

const env = { runs: process.env.EXEGEZIS_RUNS_DIR, root: process.env.EXEGEZIS_ROOT };
function restoreEnv() {
  if (env.runs === undefined) delete process.env.EXEGEZIS_RUNS_DIR;
  else process.env.EXEGEZIS_RUNS_DIR = env.runs;
  if (env.root === undefined) delete process.env.EXEGEZIS_ROOT;
  else process.env.EXEGEZIS_ROOT = env.root;
}

const ID = "01M3TEST00000000000000000A";
const JOB_ID = "01M3JOB0000000000000000000";

describe("discovery of inspections", () => {
  let runs: string;
  beforeAll(async () => {
    runs = await mkdtemp(join(tmpdir(), "exegezis-web-insp-"));
    process.env.EXEGEZIS_RUNS_DIR = runs;
    await writeInspection(join(runs, "inspections", ID));
    await writeInspection(join(runs, "web", "jobs", JOB_ID, "out", "inspections", "01M3TEST00000000000000000B"), buildReport("01M3TEST00000000000000000B"));
    // A tampered report: a finding promoted to VERIFIED that the observations do not support.
    const tampered = JSON.parse(JSON.stringify(buildReport("01M3TEST00000000000000000C"))) as { findings: { verdict: string }[] };
    for (const f of tampered.findings) f.verdict = "VERIFIED";
    await mkdir(join(runs, "inspections", "01M3TEST00000000000000000C"), { recursive: true });
    await writeFile(join(runs, "inspections", "01M3TEST00000000000000000C", "inspection-report.json"), JSON.stringify(tampered));
    // Evidence directories are never walked: a bug report inside them is not an investigation.
    await mkdir(join(runs, "inspections", ID, "pages", "run-1", "R1", "nested"), { recursive: true });
    await writeFile(join(runs, "inspections", ID, "pages", "run-1", "R1", "nested", "bug-report.json"), "{}");
  });
  afterAll(async () => {
    restoreEnv();
    await rm(runs, { recursive: true, force: true });
  });

  it("finds reports in runs/inspections and in web jobs, newest first, and links the job", async () => {
    const index = await discover();
    expect(index.inspections.map((i) => i.id)).toEqual(["01M3TEST00000000000000000C", "01M3TEST00000000000000000B", ID]);
    expect(index.inspections.find((i) => i.id === "01M3TEST00000000000000000B")?.jobId).toBe(JOB_ID);
    expect(index.inspections.find((i) => i.id === ID)?.jobId).toBeNull();
    expect(index.investigations.filter((i) => i.dir.includes("pages"))).toEqual([]);
  });

  it("loads a consistent report and refuses a tampered one", async () => {
    const index = await discover();
    expect(index.inspections.find((i) => i.id === ID)?.report.status).toBe("ok");
    const tampered = index.inspections.find((i) => i.id === "01M3TEST00000000000000000C");
    expect(tampered?.report.status).toBe("invalid");
  });

  it("resolves the evidence a finding points at", async () => {
    const ref = (await discover()).inspections.find((i) => i.id === ID);
    if (ref?.report.status !== "ok") throw new Error("fixture did not load");
    const verified = ref.report.value.findings.find((f) => f.verdict === "VERIFIED");
    if (verified === undefined) throw new Error("no verified finding");
    const evidence = await loadFindingEvidence(ref, verified);
    expect(evidence.exchanges.map((x) => x.response?.status)).toEqual([500]);
    expect(evidence.spec).toBe("// spec\n");
  });

  describe("the artifact route", () => {
    const get = (id: string, path: string[], query = "") =>
      GET(new Request(`http://127.0.0.1/api/artifacts/${id}/${path.join("/")}${query}`), { params: Promise.resolve({ id, path }) });

    it("serves inspection files and downloads specs as attachments", async () => {
      const spec = await get(ID, ["specs", "INSPECT-F-001.spec.ts"], "?download=1");
      expect(spec.status).toBe(200);
      expect(spec.headers.get("Content-Disposition")).toBe('attachment; filename="INSPECT-F-001.spec.ts"');
      expect(await spec.text()).toBe("// spec\n");
      const inline = await get(ID, ["inspection-report.json"]);
      expect(inline.headers.get("Content-Disposition")).toBeNull();
      expect(inline.headers.get("Content-Security-Policy")).toMatch(/^sandbox/);
    });

    it("never leaves the inspection directory", async () => {
      expect((await get(ID, ["..", "01M3TEST00000000000000000C", "inspection-report.json"])).status).toBe(404);
      expect((await get(ID, ["..", "..", "..", "package.json"])).status).toBe(404);
      expect((await get(ID, ["%2e%2e", "%2e%2e", "package.json"])).status).toBe(404);
      expect((await get("unknown", ["inspection-report.json"])).status).toBe(404);
    });
  });
});

describe("findings: filters, order and page rows", () => {
  const report = buildReport();

  it("parses filters from the URL and ignores unknown severities", () => {
    expect(parseFindingFilters({ severity: "serious", check: "a11y", q: "x" })).toEqual({ severity: "serious", check: "a11y", page: null, q: "x" });
    expect(parseFindingFilters({ severity: "catastrophic" }).severity).toBeNull();
  });

  it("filters by severity, check, page and text", () => {
    const all = report.findings;
    expect(filterFindings(all, { severity: "serious", check: null, page: null, q: "" })).toHaveLength(2);
    expect(filterFindings(all, { severity: "minor", check: null, page: null, q: "" })).toHaveLength(0);
    expect(filterFindings(all, { severity: null, check: null, page: null, q: "FLAKY" }).map((f) => f.title)).toEqual(["GET /api/flaky → 500"]);
    expect(filterFindings(all, { severity: null, check: "a11y", page: null, q: "" })).toHaveLength(0);
  });

  it("keeps verdicts as recorded: 3/3 VERIFIED with a spec, 1/3 INTERMITTENT without", () => {
    const byTitle = new Map(report.findings.map((f) => [f.title, f]));
    expect(byTitle.get("GET /api/fail → 500")).toMatchObject({ verdict: "VERIFIED", occurrences: [1, 2, 3], spec: "specs/INSPECT-F-001.spec.ts" });
    expect(byTitle.get("GET /api/flaky → 500")).toMatchObject({ verdict: "INTERMITTENT", occurrences: [1], spec: null });
    expect(sortFindings(report.findings).map((f) => f.id)).toEqual([...report.findings.map((f) => f.id)].sort());
  });

  it("summarizes one row per page with its visits", () => {
    expect(pageRows(report)).toEqual([{ url: "http://127.0.0.1:4300/", depth: 0, status: "OK", httpStatus: 200, reason: null, runs: 3, findings: 1 }]);
  });
});

describe("inspection jobs", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "exegezis-web-jobs-"));
    process.env.EXEGEZIS_ROOT = root;
    process.env.EXEGEZIS_RUNS_DIR = join(root, "runs");
    // A stand-in CLI: records its argv, waits a little, exits 1 (VERIFIED findings).
    await mkdir(join(root, "apps", "cli", "bin"), { recursive: true });
    await writeFile(
      join(root, "apps", "cli", "bin", "exegezis.js"),
      `const fs = require("node:fs"); const path = require("node:path");
       const out = process.argv[process.argv.indexOf("--output") + 1];
       fs.mkdirSync(out, { recursive: true });
       fs.writeFileSync(path.join(out, "argv.json"), JSON.stringify(process.argv.slice(2)));
       setTimeout(() => process.exit(1), 400);`,
    );
  });
  afterEach(async () => {
    restoreEnv();
    await rm(root, { recursive: true, force: true });
  });

  const input = { url: "https://example.com/a b?x=1;rm -rf", runs: 3, maxPages: 1, maxDepth: null, checks: ["a11y"], storageState: null, strictReadonly: true, ignoreRobots: false, browserChannel: "auto" as const, noSession: false };

  async function until(check: () => Promise<boolean>, ms = 15_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("runs one inspection at a time: the second waits queued, then runs; values are passed as single arguments", async () => {
    const first = await startInspection(input);
    const second = await startInspection({ ...input, url: "https://example.org/" });
    expect((await readJob(first.id))?.status).toBe("running");
    expect((await readJob(second.id))?.status).toBe("queued");
    await until(async () => (await readJob(second.id))?.job.status === "finished");
    const done = await readJob(first.id);
    expect(done).toMatchObject({ status: "finished", job: { exitCode: 1, kind: "inspect" } });
    const argv = JSON.parse(await readFile(join(root, "runs", "web", "jobs", first.id, "out", "argv.json"), "utf8")) as string[];
    expect(argv.slice(0, 9)).toEqual(["inspect", "--url", "https://example.com/a b?x=1;rm -rf", "--runs", "3", "--max-pages", "1", "--checks", "a11y"]);
    expect(argv).toContain("--strict-readonly");
    expect(argv).not.toContain("--ignore-robots");
    expect(argv).not.toContain("--max-depth");
  }, 30_000);

  it("reports a queued job whose server is gone as LOST", async () => {
    const dir = join(root, "runs", "web", "jobs", JOB_ID);
    await mkdir(dir, { recursive: true });
    const orphan = { schemaVersion: "exegezis.web-job/v1", id: JOB_ID, status: "queued", pid: null, startedAt: "2026-09-26T10:00:00.000Z", finishedAt: null, exitCode: null, error: null, serverPid: -1, kind: "inspect", ...input };
    await writeFile(join(dir, "job.json"), JSON.stringify(orphan));
    expect((await readJob(JOB_ID))?.status).toBe("lost");
  });

  it("still loads ai-verify jobs written before job kinds existed", () => {
    const legacy = {
      schemaVersion: "exegezis.web-job/v1",
      id: JOB_ID,
      status: "finished",
      pid: 10152,
      symptom: "The cart badge is wrong.",
      baseUrl: "http://localhost:3000/",
      planner: "anthropic",
      runs: 3,
      project: "buggy-shop",
      startedAt: "2026-09-25T15:19:46.784Z",
      finishedAt: "2026-09-25T15:20:40.830Z",
      exitCode: 4,
      error: null,
    };
    const job = JobRecord.parse(legacy);
    expect(job).toMatchObject({ kind: "ai-verify", serverPid: null });
    expect(commandFor(job).slice(0, 5)).toEqual(["ai-verify", "--symptom", "The cart badge is wrong.", "--base-url", "http://localhost:3000/"]);
  });

  it("names the state the user sees from the job and the report", () => {
    expect(inspectionJobState("queued", null, null).label).toBe("EN COLA");
    expect(inspectionJobState("finished", 4, "BLOCKED").label).toBe("BLOCKED");
    expect(inspectionJobState("finished", 1, "COMPLETED").label).toBe("TERMINADA");
    expect(inspectionJobState("finished", 2, null).label).toBe("ERROR");
    expect(inspectionJobState("lost", null, null).label).toBe("LOST");
  });
});

describe("the inspection form", () => {
  it("offers exactly the checks the inspector has", () => {
    expect(INSPECT_CHECKS.map((c) => c.id).sort()).toEqual(CHECKS.map((c) => c.id).sort());
  });

  const base = { url: "https://example.com", runs: "", maxPages: "", maxDepth: "", checks: [], storageState: "", strictReadonly: false, ignoreRobots: false, browserChannel: "auto", noSession: false };

  it("applies the CLI defaults and limits", () => {
    expect(parseInspectForm(base)).toEqual({
      ok: true,
      input: { url: "https://example.com/", runs: 3, maxPages: null, maxDepth: null, checks: null, storageState: null, strictReadonly: false, ignoreRobots: false, browserChannel: "auto", noSession: false },
    });
    expect(parseInspectForm({ ...base, runs: "21" }).ok).toBe(false);
    expect(parseInspectForm({ ...base, maxDepth: "0" })).toMatchObject({ ok: true, input: { maxDepth: 0 } });
    expect(parseInspectForm({ ...base, checks: ["a11y", "made-up"] }).ok).toBe(false);
  });

  it("only accepts http(s) URLs and existing storageState files", () => {
    expect(parseInspectForm({ ...base, url: "example.com" }).ok).toBe(false);
    expect(parseInspectForm({ ...base, url: "file:///etc/passwd" }).ok).toBe(false);
    expect(parseInspectForm({ ...base, url: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseInspectForm({ ...base, storageState: "no/such/state.json" }).ok).toBe(false);
  });
});
