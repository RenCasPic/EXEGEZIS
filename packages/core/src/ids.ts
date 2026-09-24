import { randomBytes } from "node:crypto";

/** Crockford base32 alphabet used by ULID (no I, L, O, U). */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const MAX_TIME = 2 ** 48 - 1;

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Generates a ULID: 48-bit millisecond timestamp + 80 bits of randomness,
 * encoded as 26 Crockford base32 characters. ULIDs sort lexicographically by
 * creation time, which makes run directories naturally ordered on disk.
 */
export function ulid(timeMs: number = Date.now()): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME) {
    throw new RangeError(`ULID time must be an integer in [0, ${MAX_TIME}], got ${timeMs}`);
  }
  let time = "";
  let remaining = timeMs;
  for (let i = 0; i < TIME_LENGTH; i++) {
    time = ULID_ALPHABET.charAt(remaining % 32) + time;
    remaining = Math.floor(remaining / 32);
  }
  // 16 chars * 5 bits = 80 bits. Take the low 5 bits of each random byte;
  // 256 is divisible by 32, so there is no modulo bias.
  const bytes = randomBytes(RANDOM_LENGTH);
  let random = "";
  for (const byte of bytes) {
    random += ULID_ALPHABET.charAt(byte & 31);
  }
  return time + random;
}

/** Decodes the millisecond timestamp embedded in a ULID. */
export function ulidTime(id: string): number {
  if (!ULID_PATTERN.test(id)) {
    throw new TypeError(`Not a ULID: ${id}`);
  }
  let time = 0;
  for (const char of id.slice(0, TIME_LENGTH)) {
    time = time * 32 + ULID_ALPHABET.indexOf(char);
  }
  return time;
}

/**
 * Deterministic, per-run sequential identifiers (e.g. `evt-000001`, `net-0003`).
 * Evidence IDs are sequential rather than random so that two runs of the same
 * plan produce comparable identifiers, which makes run-to-run diffs readable.
 */
export class SequentialIds {
  private readonly counters = new Map<string, number>();

  next(prefix: string, width = 4): string {
    const value = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, value);
    return `${prefix}-${String(value).padStart(width, "0")}`;
  }
}
