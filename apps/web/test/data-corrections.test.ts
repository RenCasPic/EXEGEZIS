import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discover } from "../src/lib/evidence/discover";
import { loadSummaries, type InvestigationSummary } from "../src/lib/evidence/investigations";
import { isExpectedNegative, matchesStatus } from "../src/lib/filters";
import { probeTarget } from "../src/lib/probe";
import { shortReason } from "../src/lib/reasons";

describe("short reasons for results that are not VERIFIED", () => {
  it("names the recorded reason, never invents one", () => {
    expect(shortReason("INCONCLUSIVE", "the failure reproduced, but: the failing assertion (step 4) is an anchor: the premise of the plan about the application does not hold, which is not a bug")).toBe("false premise");
    expect(shortReason("INCONCLUSIVE", "the failure reproduced, but: weakly anchored: step 2 EXPECTATION_WITHOUT_ANCHOR")).toBe("weak anchor");
    expect(shortReason("INCONCLUSIVE", "10 of 10 attempts timed out without a conclusion; a timeout is never counted as a failure")).toBe("timeout");
    expect(shortReason("INCONCLUSIVE", "something new")).toBeNull();
    expect(shortReason("VERIFIED", "every verification criterion is met")).toBeNull();
  });
});

/*
 * Against the archived Benchmark B results (committed in the repository),
 * with an empty runs/ so the test does not depend on local runs.
 */
describe("archived results: filters and root-cause links", () => {
  let runs: string;
  let summaries: InvestigationSummary[];
  const previous = process.env.EXEGEZIS_RUNS_DIR;
  beforeAll(async () => {
    runs = await mkdtemp(join(tmpdir(), "exegezis-web-fix-"));
    process.env.EXEGEZIS_RUNS_DIR = runs;
    summaries = await loadSummaries(await discover());
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.EXEGEZIS_RUNS_DIR;
    else process.env.EXEGEZIS_RUNS_DIR = previous;
    await rm(runs, { recursive: true, force: true });
  });

  it("files negative cases with the expected outcome under Expected, never Needs Evidence", () => {
    const expected = summaries.filter(isExpectedNegative);
    expect(expected.length).toBeGreaterThan(0);
    for (const s of expected) {
      expect(matchesStatus(s, "expected")).toBe(true);
      expect(matchesStatus(s, "needs-evidence")).toBe(false);
      expect(matchesStatus(s, "failed")).toBe(false);
      expect(matchesStatus(s, "not-verified")).toBe(false);
    }
  });

  it("links the recorded root cause of BUG-001/002/003 instead of NOT IMPLEMENTED", () => {
    for (const id of ["BUG-001", "BUG-002", "BUG-003"]) {
      const rows = summaries.filter((s) => s.ref.caseId === id);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((s) => s.rootCause !== null && s.rootCause.entryId !== "")).toBe(true);
    }
  });
});

describe("the target check before the planner is called", () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end("not here");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/`;
  });
  afterAll(() => {
    server.close();
  });

  it("accepts any HTTP answer and refuses a target that does not answer", async () => {
    expect(await probeTarget(url)).toBeNull();
    expect(await probeTarget("http://127.0.0.1:1/", 2000)).toMatch(/did not respond .*the planner was not called/);
  });
});
