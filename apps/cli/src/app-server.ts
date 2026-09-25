import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface AppSpec {
  command: readonly string[];
  cwd: string;
  portEnv: string;
  healthPath: string;
  /** Environment of the process. Defaults to the current environment. */
  env?: NodeJS.ProcessEnv;
}

export interface RunningApp {
  baseUrl: string;
  stop(): void;
  /** Stops the process and resolves once it has exited (its files are released). */
  stopAndWait(): Promise<void>;
}

/** Starts an application on a free port and waits for its health check. */
export async function startApp(app: AppSpec, name: string): Promise<RunningApp> {
  const port = await freePort();
  const [command, ...args] = app.command as [string, ...string[]];
  const child: ChildProcess = spawn(command === "node" ? process.execPath : command, args, {
    cwd: app.cwd,
    env: { ...(app.env ?? process.env), [app.portEnv]: String(port) },
    stdio: "ignore",
  });
  const baseUrl = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(new URL(app.healthPath, baseUrl))).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error(`the application of ${name} did not become healthy at ${baseUrl}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const exited = new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) done();
    else child.once("exit", () => done());
  });
  return {
    baseUrl,
    stop: () => child.kill(),
    stopAndWait: async () => {
      child.kill();
      await exited;
    },
  };
}

/**
 * The environment of an experiment's application: only what the runtime
 * needs to start. No credentials or other secrets of the caller are passed on.
 */
export function minimalEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", HOST: "127.0.0.1" };
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}
