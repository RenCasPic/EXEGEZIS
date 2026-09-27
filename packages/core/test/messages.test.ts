import { describe, expect, it } from "vitest";
import { classifyReproduction, deriveOutcome, ENGINE_MESSAGES, EngineMessage, formatEngineMessage, msg } from "../src/index.js";

const args = (t: string) => [...new Set([...t.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]))].sort().join();

describe("engine messages", () => {
  it("have the same codes and placeholders in English and Spanish, and no empty text", () => {
    expect(Object.keys(ENGINE_MESSAGES.es).sort()).toEqual(Object.keys(ENGINE_MESSAGES.en).sort());
    for (const [code, en] of Object.entries(ENGINE_MESSAGES.en)) {
      const es = ENGINE_MESSAGES.es[code] ?? "";
      expect(es.trim(), code).not.toBe("");
      expect(args(es), code).toBe(args(en));
    }
  });

  it("keep the English text of older versions, and read in Spanish with nested messages", () => {
    const repro = classifyReproduction([{ verdict: "passed" }, { verdict: "passed" }]);
    expect(repro.reason).toBe("all 2 attempts met every expectation");
    const outcome = deriveOutcome({ status: "valid", issues: [], reference: null }, repro, []);
    expect(outcome.reason).toBe("the expectation held: all 2 attempts met every expectation");
    expect(formatEngineMessage(outcome.message, "es")).toBe("la expectativa se cumplió: los 2 intentos cumplieron todas las expectativas");
    expect(EngineMessage.parse(outcome.message)).toEqual(outcome.message);
  });

  it("join a list of messages with «; »", () => {
    const m = msg("outcomeUnmet", { details: [msg("critTestNotRun"), msg("critNoFailingAttempt")] });
    expect(formatEngineMessage(m)).toBe("the failure reproduced, but: the compiled test was not executed; no failing attempt to take evidence from");
  });
});
