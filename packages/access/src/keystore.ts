import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { platform } from "node:os";

/**
 * Protects the master key with the operating system (docs/09-access.md §2).
 * Secrets travel ONLY through stdin/stdout of the helper process, never as
 * command-line arguments: other processes can read arguments.
 */
export interface KeyProtector {
  readonly name: string;
  /** Returns an opaque blob only this user on this machine can unprotect (Windows), or stores the key (macOS, Linux). */
  protect(secret: Buffer): Promise<Buffer>;
  unprotect(blob: Buffer): Promise<Buffer>;
}

/** The OS protection is not available: nothing is saved, and the message says why and how to fix it. */
export class KeystoreUnavailableError extends Error {
  override readonly name = "KeystoreUnavailableError";
}

/** The saved access cannot be opened by this user on this machine (e.g. created by another Windows user). */
export class AccessUnreadableError extends Error {
  override readonly name = "AccessUnreadableError";
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], stdin: string, timeoutMs = 30_000): Promise<RunResult | { spawnError: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolve({ spawnError: error instanceof Error ? error.message : String(error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ spawnError: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

// The script is fixed text (no secret in it); the data comes from stdin as base64.
const DPAPI_SCRIPT = (op: "Protect" | "Unprotect") =>
  [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$in = [Console]::In.ReadToEnd().Trim()",
    `$out = [System.Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($in), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($out))",
  ].join("; ");

/** Windows DPAPI (current user) through the built-in Windows PowerShell. */
export class DpapiProtector implements KeyProtector {
  readonly name = "Windows DPAPI (current user)";

  private async call(op: "Protect" | "Unprotect", data: Buffer): Promise<Buffer> {
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT(op)], data.toString("base64"));
    if ("spawnError" in result) {
      throw new KeystoreUnavailableError(
        `Windows PowerShell could not be started (${result.spawnError}). EXEGEZIS uses it internally for DPAPI encryption; a system policy may be blocking it. Nothing was saved.`,
      );
    }
    if (result.code !== 0) {
      const detail = result.stderr.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? `exit code ${result.code}`;
      if (op === "Unprotect" && /key not valid|CryptographicException|parameter is incorrect/i.test(result.stderr)) {
        throw new AccessUnreadableError(
          "This saved access was encrypted by another Windows user or on another computer (DPAPI). It can only be opened by the same user on the same machine: sign in again to create a new one.",
        );
      }
      if (/disabled|blocked|policy|not recognized|AccessDenied/i.test(result.stderr)) {
        throw new KeystoreUnavailableError(`A system policy blocks Windows PowerShell, which EXEGEZIS needs for DPAPI encryption (${detail}). Nothing was saved.`);
      }
      throw new KeystoreUnavailableError(`DPAPI ${op.toLowerCase()} failed: ${detail}`);
    }
    return Buffer.from(result.stdout.trim(), "base64");
  }

  protect(secret: Buffer): Promise<Buffer> {
    return this.call("Protect", secret);
  }

  unprotect(blob: Buffer): Promise<Buffer> {
    return this.call("Unprotect", blob);
  }
}

const SERVICE = "EXEGEZIS";
const ACCOUNT = "access-master-key";

/** macOS Keychain. The key goes through `security -i` (commands on stdin), never through argv. */
export class KeychainProtector implements KeyProtector {
  readonly name = "macOS Keychain";

  async protect(secret: Buffer): Promise<Buffer> {
    const result = await run("security", ["-i"], `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${secret.toString("base64")}\n`);
    if ("spawnError" in result || result.code !== 0) throw new KeystoreUnavailableError("The macOS Keychain could not store the EXEGEZIS key. Nothing was saved.");
    return Buffer.from("keychain", "utf8");
  }

  async unprotect(): Promise<Buffer> {
    const result = await run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], "");
    if ("spawnError" in result || result.code !== 0) throw new AccessUnreadableError("The EXEGEZIS key is not in this user's Keychain: sign in again to create a new access.");
    return Buffer.from(result.stdout.trim(), "base64");
  }
}

/** Linux libsecret. `secret-tool store` reads the secret from stdin. */
export class SecretToolProtector implements KeyProtector {
  readonly name = "libsecret (secret-tool)";

  async protect(secret: Buffer): Promise<Buffer> {
    const result = await run("secret-tool", ["store", "--label=EXEGEZIS access key", "service", SERVICE, "account", ACCOUNT], secret.toString("base64"));
    if ("spawnError" in result) {
      throw new KeystoreUnavailableError(
        "secret-tool (libsecret) is not installed, so EXEGEZIS cannot encrypt saved access on this system and saved nothing. Install it (Debian/Ubuntu: sudo apt install libsecret-tools; Fedora: sudo dnf install libsecret) and try again.",
      );
    }
    if (result.code !== 0) throw new KeystoreUnavailableError(`secret-tool could not store the EXEGEZIS key (${result.stderr.trim()}). Nothing was saved.`);
    return Buffer.from("libsecret", "utf8");
  }

  async unprotect(): Promise<Buffer> {
    const result = await run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT], "");
    if ("spawnError" in result) throw new KeystoreUnavailableError("secret-tool (libsecret) is not installed: install libsecret-tools to use saved access.");
    if (result.code !== 0 || result.stdout.trim() === "") throw new AccessUnreadableError("The EXEGEZIS key is not in this user's keyring: sign in again to create a new access.");
    return Buffer.from(result.stdout.trim(), "base64");
  }
}

/**
 * A server with no desktop keyring (the EXEGEZIS web app): each user's master
 * key is wrapped with AES-256-GCM under a server key (EXEGEZIS_ACCESS_KEY, 32
 * bytes in base64), kept outside the data folder (a secret of the deployment).
 */
export class ServerKeyProtector implements KeyProtector {
  readonly name = "server key (EXEGEZIS_ACCESS_KEY)";
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) throw new KeystoreUnavailableError("EXEGEZIS_ACCESS_KEY must be 32 bytes in base64 (for example: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").");
    this.key = key;
  }

  protect(secret: Buffer): Promise<Buffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Promise.resolve(Buffer.concat([Buffer.from("EXSK1"), iv, cipher.getAuthTag(), body]));
  }

  unprotect(blob: Buffer): Promise<Buffer> {
    if (blob.length < 33 || blob.subarray(0, 5).toString() !== "EXSK1") return Promise.reject(new AccessUnreadableError("This saved access was not protected with the server key."));
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, blob.subarray(5, 17));
      decipher.setAuthTag(blob.subarray(17, 33));
      return Promise.resolve(Buffer.concat([decipher.update(blob.subarray(33)), decipher.final()]));
    } catch {
      return Promise.reject(new AccessUnreadableError("This saved access cannot be opened with the current server key."));
    }
  }
}

/** The server key when EXEGEZIS_ACCESS_KEY is set (cloud servers), otherwise the operating system's protection. */
export function systemProtector(): KeyProtector {
  const serverKey = process.env["EXEGEZIS_ACCESS_KEY"];
  if (serverKey !== undefined && serverKey !== "") return new ServerKeyProtector(serverKey);
  return osProtector();
}

/** The operating system's protection, whatever the environment says (to read the local store when moving it to the cloud). */
export function osProtector(): KeyProtector {
  switch (platform()) {
    case "win32":
      return new DpapiProtector();
    case "darwin":
      return new KeychainProtector();
    default:
      return new SecretToolProtector();
  }
}
