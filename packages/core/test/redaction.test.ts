import { describe, expect, it } from "vitest";
import {
  isSensitiveHeader,
  redactBody,
  redactHeaders,
  redactUrl,
  REDACTED,
  SecretRegistry,
} from "../src/index.js";

describe("header redaction", () => {
  it("redacts the credential headers named in the policy, keeping their presence visible", () => {
    const registry = new SecretRegistry();
    const headers = redactHeaders(
      {
        Authorization: "Bearer sk-live-abcdef123456",
        Cookie: "theme=dark; shop_sid=sid-9f8e7d6c5b",
        "Set-Cookie": "shop_sid=sid-9f8e7d6c5b; Path=/; HttpOnly",
        "X-API-Key": "key-000111222333",
        "x-session-token": "tok-555666777",
        "content-type": "application/json",
        accept: "*/*",
      },
      registry,
    );
    expect(headers).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      "Set-Cookie": REDACTED,
      "X-API-Key": REDACTED,
      "x-session-token": REDACTED,
      "content-type": "application/json",
      accept: "*/*",
    });
  });

  it("tracks the secret parts so they can be scrubbed anywhere else", () => {
    const registry = new SecretRegistry();
    redactHeaders({ authorization: "Bearer sk-live-abcdef123456", cookie: "a=1; shop_sid=sid-9f8e7d6c5b" }, registry);
    const leaked = 'console: token=sk-live-abcdef123456 sid="sid-9f8e7d6c5b"';
    expect(registry.scrub(leaked)).toBe(`console: token=${REDACTED} sid="${REDACTED}"`);
    expect(registry.countLeaks(registry.scrub(leaked))).toBe(0);
  });

  it("does not treat ordinary headers as sensitive", () => {
    for (const name of ["content-type", "accept", "user-agent", ":authority", "cache-control", "etag"]) {
      expect(isSensitiveHeader(name), name).toBe(false);
    }
  });
});

describe("SecretRegistry", () => {
  it("ignores values too short to be scrubbed safely", () => {
    const registry = new SecretRegistry();
    registry.add("1");
    registry.add("abc");
    registry.add(REDACTED);
    expect(registry.size).toBe(0);
    expect(registry.scrub("abc 1")).toBe("abc 1");
  });

  it("replaces longer secrets first when one contains another", () => {
    const registry = new SecretRegistry();
    registry.add("secret-value");
    registry.add("secret-value-extended");
    expect(registry.scrub("x secret-value-extended y")).toBe(`x ${REDACTED} y`);
  });
});

describe("URL redaction", () => {
  it("redacts sensitive query parameters and userinfo passwords", () => {
    const registry = new SecretRegistry();
    const url = redactUrl("https://user:p4ssw0rd!@api.test/items?page=2&api_key=abcdef123456&token=zz-top-secret", registry);
    expect(url).not.toContain("abcdef123456");
    expect(url).not.toContain("zz-top-secret");
    expect(url).not.toContain("p4ssw0rd");
    expect(url).toContain("page=2");
    expect(registry.scrub("leak abcdef123456")).toBe(`leak ${REDACTED}`);
  });

  it("leaves URLs without secrets untouched", () => {
    const registry = new SecretRegistry();
    expect(redactUrl("http://localhost:3000/cart?item=1", registry)).toBe("http://localhost:3000/cart?item=1");
  });
});

describe("body redaction", () => {
  it("redacts sensitive JSON fields at any depth", () => {
    const registry = new SecretRegistry();
    const body = JSON.stringify({ user: { email: "a@b.c", password: "hunter2hunter2" }, token: "tok-abcdef-123", items: [1] });
    const redacted = JSON.parse(redactBody(body, "application/json; charset=utf-8", registry)) as Record<string, unknown>;
    expect(redacted).toEqual({ user: { email: "a@b.c", password: REDACTED }, token: REDACTED, items: [1] });
    expect(registry.countLeaks("hunter2hunter2 tok-abcdef-123")).toBe(2);
  });

  it("redacts form-encoded fields", () => {
    const registry = new SecretRegistry();
    const redacted = redactBody("username=ana&password=hunter2hunter2", "application/x-www-form-urlencoded", registry);
    expect(new URLSearchParams(redacted).get("password")).toBe(REDACTED);
    expect(new URLSearchParams(redacted).get("username")).toBe("ana");
  });

  it("falls back to scrubbing known secrets for other media types", () => {
    const registry = new SecretRegistry();
    registry.add("sk-live-abcdef123456");
    expect(redactBody("auth sk-live-abcdef123456", "text/plain", registry)).toBe(`auth ${REDACTED}`);
    expect(redactBody("{not json sk-live-abcdef123456", "application/json", registry)).toBe(`{not json ${REDACTED}`);
  });
});
