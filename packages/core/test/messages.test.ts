import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { classifyReproduction, deriveOutcome, ENGINE_MESSAGES, EngineMessage, formatEngineMessage, msg } from "../src/index.js";

/** Argument names of an ICU message (plain, number, date, plural, select), from its parsed form. */
function args(message: string): string {
  const names = new Set<string>();
  const walk = (elements: MessageFormatElement[]) => {
    for (const e of elements) {
      if (e.type === TYPE.argument || e.type === TYPE.number || e.type === TYPE.date || e.type === TYPE.time) names.add(e.value);
      if (e.type === TYPE.plural || e.type === TYPE.select) {
        names.add(e.value);
        for (const option of Object.values(e.options)) walk(option.value);
      }
      if (e.type === TYPE.tag) walk(e.children);
    }
  };
  walk(parse(message));
  return [...names].sort().join();
}

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
