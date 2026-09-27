import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discover } from "../src/lib/evidence/discover";
import { loadSummaries, type InvestigationSummary } from "../src/lib/evidence/investigations";
import { isExpectedNegative, matchesStatus } from "../src/lib/filters";
import { createTranslator } from "next-intl";
import { CATALOGS } from "../src/i18n/messages";
import { probeTarget } from "../src/lib/probe";
import { translateUi } from "../src/lib/ui-message";
import { shortReason } from "../src/lib/reasons";

describe("short reasons for results that are not VERIFIED", () => {
  it("names the recorded reason, never invents one", () => {
    expect(shortReason("INCONCLUSIVE", "the failure reproduced, but: the failing assertion (step 4) is an anchor: the premise of the plan about the application does not hold, which is not a bug")).toBe("falsePremise");
    expect(shortReason("INCONCLUSIVE", "the failure reproduced, but: weakly anchored: step 2 EXPECTATION_WITHOUT_ANCHOR")).toBe("weakAnchor");
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

  it("accepts any HTTP answer and refuses a target that does not answer, saying why", async () => {
    expect(await probeTarget(url)).toBeNull();
    // A port with nothing listening (like buggy-shop on :3000 when it is not started).
    const closed = await new Promise<number>((done) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const a = probe.address();
        probe.close(() => done(typeof a === "object" && a !== null ? a.port : 0));
      });
    });
    const refused = await probeTarget(`http://127.0.0.1:${closed}/`, 2000);
    expect(refused).toEqual({ key: "common.errors.targetDown", values: { url: `http://127.0.0.1:${closed}/`, cause: { key: "common.errors.cause.ECONNREFUSED" } } });
    // In both languages, with the cause inside.
    const en = createTranslator({ locale: "en", messages: CATALOGS.en as never });
    const es = createTranslator({ locale: "es", messages: CATALOGS.es as never });
    expect(translateUi(en as never, refused!)).toMatch(/did not respond \(connection refused: nothing is listening at that address\).*the planner was not called/);
    expect(translateUi(es as never, refused!)).toMatch(/no respondió \(conexión rechazada: no hay nada escuchando en esa dirección\).*no se llamó al planner/);
    // localhost resolves to ::1 and 127.0.0.1: the real cause is inside an AggregateError with an empty message.
    expect((await probeTarget(`http://localhost:${closed}/`, 2000))?.values?.["cause"]).toEqual({ key: "common.errors.cause.ECONNREFUSED" });
  });
});
