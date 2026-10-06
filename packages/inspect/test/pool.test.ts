import { describe, expect, it } from "vitest";
import { pool } from "../src/crawl.js";

describe("visiting pages in parallel", () => {
  it("never runs more than the limit at once, and keeps the results in the items' order", async () => {
    let running = 0;
    let most = 0;
    const out = await pool([50, 10, 30, 5, 20, 1], 3, async (ms, i) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    });
    expect(most).toBe(3);
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("with one lane it is one at a time; with no items, nothing", async () => {
    const order: number[] = [];
    await pool([3, 1, 2], 1, async (n) => {
      order.push(n);
    });
    expect(order).toEqual([3, 1, 2]);
    expect(await pool([], 3, async () => 1)).toEqual([]);
  });
});
