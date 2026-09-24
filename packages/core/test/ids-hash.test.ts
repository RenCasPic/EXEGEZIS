import { describe, expect, it } from "vitest";
import { canonicalJson, hashJson, SequentialIds, ULID_PATTERN, ulid, ulidTime } from "../src/index.js";

describe("ulid", () => {
  it("produces 26-char Crockford base32 ids that encode their creation time", () => {
    const time = Date.UTC(2026, 8, 24, 12, 0, 0);
    const id = ulid(time);
    expect(id).toMatch(ULID_PATTERN);
    expect(ulidTime(id)).toBe(time);
  });

  it("sorts lexicographically by time", () => {
    const ids = [ulid(3_000), ulid(1_000), ulid(2_000)];
    expect([...ids].sort().map(ulidTime)).toEqual([1_000, 2_000, 3_000]);
  });

  it("is unique within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid(1)));
    expect(ids.size).toBe(1000);
  });

  it("rejects out-of-range times", () => {
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(2 ** 48)).toThrow(RangeError);
  });
});

describe("SequentialIds", () => {
  it("counts independently per prefix", () => {
    const ids = new SequentialIds();
    expect(ids.next("net")).toBe("net-0001");
    expect(ids.next("net")).toBe("net-0002");
    expect(ids.next("con")).toBe("con-0001");
    expect(ids.next("evt", 6)).toBe("evt-000001");
  });
});

describe("canonical hashing", () => {
  it("ignores key order and undefined members", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
    expect(hashJson({ x: 1, y: 2 })).toBe(hashJson({ y: 2, x: 1 }));
  });

  it("changes when any value changes", () => {
    expect(hashJson({ viewport: { width: 1280 } })).not.toBe(hashJson({ viewport: { width: 1281 } }));
    expect(hashJson({ x: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
