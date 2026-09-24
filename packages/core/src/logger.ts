import { appendFileSync } from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  runId?: string;
  eventId?: string;
  data?: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export interface LogBindings {
  component?: string;
  runId?: string;
}

/**
 * Structured logger. Every record is a JSON object bound to a component and,
 * when available, a run and a timeline event, so a log line can always be
 * traced back to the moment of the run it describes.
 */
export class Logger {
  constructor(
    private readonly sinks: readonly LogSink[],
    private readonly bindings: LogBindings = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  child(bindings: LogBindings): Logger {
    return new Logger(this.sinks, { ...this.bindings, ...bindings }, this.now);
  }

  debug(message: string, data?: Record<string, unknown>, eventId?: string): void {
    this.log("debug", message, data, eventId);
  }

  info(message: string, data?: Record<string, unknown>, eventId?: string): void {
    this.log("info", message, data, eventId);
  }

  warn(message: string, data?: Record<string, unknown>, eventId?: string): void {
    this.log("warn", message, data, eventId);
  }

  error(message: string, data?: Record<string, unknown>, eventId?: string): void {
    this.log("error", message, data, eventId);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>, eventId?: string): void {
    const record: LogRecord = {
      timestamp: this.now().toISOString(),
      level,
      component: this.bindings.component ?? "exegezis",
      message,
      ...(this.bindings.runId === undefined ? {} : { runId: this.bindings.runId }),
      ...(eventId === undefined ? {} : { eventId }),
      ...(data === undefined ? {} : { data }),
    };
    for (const sink of this.sinks) {
      try {
        sink.write(record);
      } catch {
        // A failing sink must never break a run; other sinks still receive the record.
      }
    }
  }
}

/** Appends one JSON object per line. Synchronous so records survive a crash. */
export class JsonlFileSink implements LogSink {
  constructor(
    private readonly path: string,
    private readonly minLevel: LogLevel = "debug",
  ) {}

  write(record: LogRecord): void {
    if (LEVEL_ORDER[record.level] < LEVEL_ORDER[this.minLevel]) return;
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}

export class StreamSink implements LogSink {
  constructor(
    private readonly stream: NodeJS.WritableStream,
    private readonly minLevel: LogLevel = "info",
  ) {}

  write(record: LogRecord): void {
    if (LEVEL_ORDER[record.level] < LEVEL_ORDER[this.minLevel]) return;
    this.stream.write(`${JSON.stringify(record)}\n`);
  }
}

export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];

  write(record: LogRecord): void {
    this.records.push(record);
  }
}

export const silentLogger = new Logger([]);
