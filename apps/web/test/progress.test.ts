import { describe, expect, it } from "vitest";
import { jobPercent } from "../src/lib/progress";

const at = (phase: string, run: number, pagesDone: number, pagesPlanned: number, runs = 3) => jobPercent({ phase, run, runs, pagesDone, pagesPlanned });

describe("the job page's progress bar", () => {
  it("has no figure while robots.txt is read or nothing has been visited yet", () => {
    expect(at("robots", 1, 0, 0)).toBeNull();
    expect(at("crawl", 1, 0, 1)).toBeNull();
  });

  it("counts the pages of every repetition, up to 90 %", () => {
    expect(at("crawl", 1, 10, 20)).toBe(15);
    expect(at("crawl", 1, 20, 20)).toBe(30);
    expect(at("repeat", 2, 10, 20)).toBe(45);
    expect(at("repeat", 3, 20, 20)).toBe(90);
    expect(at("crawl", 1, 1, 1, 1)).toBe(90);
  });

  it("never goes back or past the end with odd figures", () => {
    expect(at("crawl", 1, 30, 20)).toBe(30);
    expect(at("repeat", 5, 1, 1)).toBe(90);
  });

  it("then 95 % (specs, search, AI) and 100 % when done", () => {
    expect(at("specs", 3, 20, 20)).toBe(95);
    expect(at("ai", 1, 0, 0)).toBe(95);
    expect(at("done", 3, 20, 20)).toBe(100);
  });
});

describe("the progress bar with several devices", () => {
  it("counts every run of every device", () => {
    const at = (deviceIndex: number, run: number, pagesDone: number) => jobPercent({ phase: "repeat", run, runs: 3, devices: 2, deviceIndex, pagesDone, pagesPlanned: 10 });
    expect(at(0, 3, 10)).toBe(45);
    expect(at(1, 1, 5)).toBe(53);
    expect(at(1, 3, 10)).toBe(90);
  });
});
