import { REDACTED, SecretRegistry } from "@exegezis/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { normalizeAriaNodes } from "../src/session.js";
import { sanitizeTraceArchive } from "../src/trace-redaction.js";

describe("sanitizeTraceArchive", () => {
  const networkLine = JSON.stringify({
    type: "resource-snapshot",
    snapshot: {
      request: {
        headers: [
          { name: "Authorization", value: "Bearer trace-bearer-123456" },
          { name: "Accept", value: "*/*" },
        ],
        cookies: [{ name: "sid", value: "trace-cookie-abcdef" }],
      },
    },
  });

  it("redacts sensitive headers and cookies structurally, then scrubs every text entry", () => {
    const registry = new SecretRegistry();
    registry.addExplicit("typed-password-1");
    const archive = zipSync({
      "trace.network": strToU8(`${networkLine}\n`),
      "trace.trace": strToU8(`${JSON.stringify({ type: "before", params: { value: "typed-password-1" } })}\n`),
      // The bearer only appears raw in a resource; it is discovered from the network entry.
      "resources/page.html": strToU8("<script>fetch('/', {headers: {Authorization: 'Bearer trace-bearer-123456'}})</script>"),
      "resources/shot.jpeg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0x81]),
    });

    const result = sanitizeTraceArchive(archive, registry);
    expect(result.leaks).toBe(0);
    expect(result.entriesSkipped).toBe(1);

    const entries = unzipSync(result.data);
    const network = JSON.parse(strFromU8(entries["trace.network"] ?? new Uint8Array()).trim()) as {
      snapshot: { request: { headers: { name: string; value: string }[]; cookies: { value: string }[] } };
    };
    expect(network.snapshot.request.headers).toEqual([
      { name: "Authorization", value: REDACTED },
      { name: "Accept", value: "*/*" },
    ]);
    expect(network.snapshot.request.cookies[0]?.value).toBe(REDACTED);
    const all = Object.values(entries).map((bytes) => Buffer.from(bytes).toString("latin1")).join("\n");
    for (const secret of ["trace-bearer-123456", "trace-cookie-abcdef", "typed-password-1"]) {
      expect(all).not.toContain(secret);
    }
    // Binary entries are passed through untouched.
    expect(entries["resources/shot.jpeg"]).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0x81]));
  });

  it("leaves an archive without secrets semantically unchanged", () => {
    const archive = zipSync({ "trace.trace": strToU8('{"type":"context-options"}\n') });
    const result = sanitizeTraceArchive(archive, new SecretRegistry());
    expect(result.entriesModified).toBe(0);
    expect(strFromU8(unzipSync(result.data)["trace.trace"] ?? new Uint8Array())).toBe('{"type":"context-options"}\n');
  });
});

describe("normalizeAriaNodes", () => {
  it("turns bare text fragments into text nodes at any depth", () => {
    expect(
      normalizeAriaNodes([{ role: "list", children: [{ role: "listitem", children: ["One", { role: "button", name: "Remove" }] }] }]),
    ).toEqual([
      {
        role: "list",
        children: [{ role: "listitem", children: [{ role: "text", text: "One" }, { role: "button", name: "Remove" }] }],
      },
    ]);
  });

  it("wraps a single root node in a list", () => {
    expect(normalizeAriaNodes({ role: "main" })).toEqual([{ role: "main" }]);
  });
});
