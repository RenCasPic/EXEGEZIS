/*
 * The queue of browser jobs (inspections and searches) of this server.
 * - Workers: how many run at once (EXEGEZIS_WORKERS, default 1). Each job
 *   already visits up to 3 pages in parallel, so one worker keeps a small
 *   server busy; a bigger server can take more.
 * - First come, first served, across users. A queued job knows its place and
 *   when it should start: the work ahead of it (what the running jobs have
 *   left, then the queued ones in order) spread over the workers.
 * - The time a job takes is estimated from its size (pages × runs × devices)
 *   and the pace measured on the jobs this server has finished; once a job
 *   runs, from how far it has got (its progress) and the time it took.
 *
 * One server process keeps the queue in memory; its jobs are files
 * (job.json), so a restart shows the queued ones as LOST. Several servers
 * would share a queue in the database instead (docs/13-accounts.md).
 */

export interface QueueEntry {
  id: string;
  /** Visits the job will make: pages × runs × devices (an estimate before it runs). */
  visits: number;
  enqueuedAt: number;
}

interface Running extends QueueEntry {
  startedAt: number;
}

export interface QueueStatus {
  state: "queued" | "running";
  /** 1 = next to start. Only for queued jobs. */
  position: number | null;
  /** Milliseconds until it should start (queued) or end (running), roughly. */
  etaMs: number;
}

/** Milliseconds per visit before any job has finished here (measured: ~5 s with 3 pages at a time). */
const DEFAULT_MS_PER_VISIT = 5_000;

export function workerCount(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const n = Number((env["EXEGEZIS_WORKERS"] ?? "").trim());
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 16) : 1;
}

export class JobQueue {
  private readonly waiting: QueueEntry[] = [];
  private readonly running = new Map<string, Running>();
  private msPerVisit = DEFAULT_MS_PER_VISIT;

  constructor(
    private readonly workers: number,
    private readonly start: (id: string) => Promise<boolean>,
  ) {}

  /** Adds a job at the end; it starts at once if a worker is free. */
  async enqueue(entry: Omit<QueueEntry, "enqueuedAt">): Promise<void> {
    this.waiting.push({ ...entry, enqueuedAt: Date.now() });
    await this.fill();
  }

  /** A job ended: its worker takes the next one, and its pace refines the estimates. */
  async finished(id: string): Promise<void> {
    const r = this.running.get(id);
    this.running.delete(id);
    if (r !== undefined && r.visits > 0) {
      const pace = (Date.now() - r.startedAt) / r.visits;
      // A moving average: recent jobs count more, one odd job does not swing it.
      this.msPerVisit = Math.round(0.7 * this.msPerVisit + 0.3 * Math.min(Math.max(pace, 500), 60_000));
    }
    await this.fill();
  }

  /** `done`: how far each running job has got (0–1, from its progress), when known. */
  status(id: string, now = Date.now(), done: ReadonlyMap<string, number> = new Map()): QueueStatus | null {
    const left = (x: Running) => {
      const elapsed = now - x.startedAt;
      const f = done.get(x.id);
      // Measured progress beats the estimate once there is enough of it.
      if (f !== undefined && f >= 0.05) return Math.max(0, (elapsed * (1 - Math.min(f, 1))) / f);
      return Math.max(0, this.duration(x) - elapsed);
    };
    const r = this.running.get(id);
    if (r !== undefined) return { state: "running", position: null, etaMs: left(r) };
    const index = this.waiting.findIndex((e) => e.id === id);
    if (index < 0) return null;
    // When each worker is free: what the running jobs have left, then the queued jobs ahead, in order.
    const free = [...this.running.values()].map(left);
    while (free.length < this.workers) free.push(0);
    for (const ahead of this.waiting.slice(0, index)) {
      free.sort((a, b) => a - b);
      free[0] = (free[0] ?? 0) + this.duration(ahead);
    }
    return { state: "queued", position: index + 1, etaMs: Math.min(...free) };
  }

  /** The jobs running now (their progress refines the estimates). */
  runningIds(): string[] {
    return [...this.running.keys()];
  }

  /** How many are waiting and running (for tests and the operator). */
  size(): { waiting: number; running: number } {
    return { waiting: this.waiting.length, running: this.running.size };
  }

  private duration(e: QueueEntry): number {
    return Math.max(1, e.visits) * this.msPerVisit;
  }

  private async fill(): Promise<void> {
    while (this.running.size < this.workers) {
      const next = this.waiting.shift();
      if (next === undefined) return;
      this.running.set(next.id, { ...next, startedAt: Date.now() });
      // A job that can no longer start (deleted, not queued any more) frees its place at once.
      if (!(await this.start(next.id))) this.running.delete(next.id);
    }
  }
}
