import { describe, expect, it, vi } from "vitest";
import { JobQueue, workerCount } from "../src/lib/queue";

describe("the queue of browser jobs", () => {
  it("runs as many jobs as workers, first come first served; the next starts when one ends", async () => {
    const started: string[] = [];
    const q = new JobQueue(2, async (id) => {
      started.push(id);
      return true;
    });
    for (const id of ["a", "b", "c", "d"]) await q.enqueue({ id, visits: 10 });
    expect(started).toEqual(["a", "b"]);
    expect(q.size()).toEqual({ waiting: 2, running: 2 });
    await q.finished("b");
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("tells a queued job its place and when it should start; a running one, when it should end", async () => {
    vi.useFakeTimers({ now: 0 });
    const q = new JobQueue(1, async () => true);
    await q.enqueue({ id: "running", visits: 10 }); // 10 visits × 5 s = 50 s
    await q.enqueue({ id: "next", visits: 20 }); // 100 s
    await q.enqueue({ id: "last", visits: 4 });
    vi.setSystemTime(20_000);
    expect(q.status("running")).toEqual({ state: "running", position: null, etaMs: 30_000 });
    expect(q.status("next")).toEqual({ state: "queued", position: 1, etaMs: 30_000 });
    expect(q.status("last")).toEqual({ state: "queued", position: 2, etaMs: 130_000 });
    expect(q.status("unknown")).toBeNull();
    vi.useRealTimers();
  });

  it("with two workers, the wait is spread over both", async () => {
    vi.useFakeTimers({ now: 0 });
    const q = new JobQueue(2, async () => true);
    await q.enqueue({ id: "a", visits: 10 }); // ends at 50 s
    await q.enqueue({ id: "b", visits: 2 }); // ends at 10 s
    await q.enqueue({ id: "c", visits: 1 });
    await q.enqueue({ id: "d", visits: 1 });
    expect(q.status("c")?.etaMs).toBe(10_000);
    expect(q.status("d")?.etaMs).toBe(15_000);
    vi.useRealTimers();
  });

  it("learns the pace from finished jobs, and a job that cannot start frees its place", async () => {
    vi.useFakeTimers({ now: 0 });
    const q = new JobQueue(1, async (id) => id !== "gone");
    await q.enqueue({ id: "a", visits: 10 });
    vi.setSystemTime(200_000); // 20 s a visit instead of 5
    await q.finished("a");
    await q.enqueue({ id: "gone", visits: 1 });
    await q.enqueue({ id: "b", visits: 10 });
    expect(q.size()).toEqual({ waiting: 0, running: 1 });
    expect(q.status("b")?.etaMs).toBe(95_000); // 0.7 × 5 s + 0.3 × 20 s = 9.5 s a visit
    vi.useRealTimers();
  });

  it("EXEGEZIS_WORKERS sets the workers (1 by default, at most 16)", () => {
    expect(workerCount({})).toBe(1);
    expect(workerCount({ EXEGEZIS_WORKERS: "3" })).toBe(3);
    expect(workerCount({ EXEGEZIS_WORKERS: "0" })).toBe(1);
    expect(workerCount({ EXEGEZIS_WORKERS: "99" })).toBe(16);
    expect(workerCount({ EXEGEZIS_WORKERS: "x" })).toBe(1);
  });
});

describe("the estimate of a running job", () => {
  it("follows its real progress once there is enough of it", async () => {
    vi.useFakeTimers({ now: 0 });
    const q = new JobQueue(1, async () => true);
    await q.enqueue({ id: "a", visits: 120 }); // estimated 600 s
    await q.enqueue({ id: "b", visits: 10 });
    vi.setSystemTime(60_000);
    // A quarter done in a minute: three more minutes, not nine.
    expect(q.status("a", Date.now(), new Map([["a", 0.25]]))?.etaMs).toBe(180_000);
    expect(q.status("b", Date.now(), new Map([["a", 0.25]]))?.etaMs).toBe(180_000);
    // Too little progress to trust: the estimate.
    expect(q.status("a", Date.now(), new Map([["a", 0.01]]))?.etaMs).toBe(540_000);
    vi.useRealTimers();
  });
});
