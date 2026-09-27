import { msg, type EngineMessage } from "./messages.js";
import type { Assertion } from "./schemas/assertion.js";
import type { PlanStep } from "./schemas/test-plan.js";
import { describeTarget } from "./schemas/target.js";

/*
 * Assertions and plan steps as engine messages, for every language
 * (docs/11-i18n.md). A target (`button "Add"`, `css "#x"`) is a locator,
 * written the same in every language; values are shown as JSON.
 */

export function assertionMessage(assertion: Assertion): EngineMessage {
  const json = (v: unknown) => JSON.stringify(v);
  switch (assertion.kind) {
    case "text":
      return msg("assertText", { target: describeTarget(assertion.target), op: assertion.operator, expected: json(assertion.expected) });
    case "visibility":
    case "existence":
      return msg("assertState", { target: describeTarget(assertion.target), state: assertion.expected });
    case "attribute":
      return msg("assertAttribute", { name: assertion.name, target: describeTarget(assertion.target), op: assertion.operator, expected: json(assertion.expected) });
    case "url":
      return msg("assertUrl", { op: assertion.operator, expected: json(assertion.expected) });
    case "count":
      return msg("assertCount", { target: describeTarget(assertion.target), expected: assertion.expected });
    case "visual":
      return msg("assertVisual", { target: assertion.target === undefined ? msg("thePage") : describeTarget(assertion.target), baseline: assertion.baseline });
    case "console":
      return msg("assertConsole", { level: assertion.level, text: json(assertion.contains) });
    case "page_error":
      return msg("assertPageError", { text: json(assertion.contains) });
    case "request":
      return msg("assertRequest", { method: assertion.request.method ?? "ANY", url: assertion.request.url });
    case "link":
      return msg("assertLink", { url: assertion.url });
    case "a11y":
      return msg("assertA11y", { rule: assertion.rule, selector: json(assertion.selector) });
    case "http": {
      const parts: EngineMessage[] = [];
      if (assertion.expected.status !== undefined) parts.push(msg("assertHttpStatus", { status: assertion.expected.status }));
      if (assertion.expected.body !== undefined) parts.push(msg("assertHttpBody", { pointer: assertion.expected.body.pointer, expected: json(assertion.expected.body.equals) }));
      return msg("assertHttp", { request: `${assertion.request.method ?? "ANY"} ${assertion.request.path}`, parts });
    }
  }
}

export function stepMessage(step: PlanStep): EngineMessage {
  switch (step.type) {
    case "navigate":
      return msg("stepNavigate", { url: step.url });
    case "click":
      return msg("stepClick", { target: describeTarget(step.target) });
    case "fill":
      return msg("stepFill", { target: describeTarget(step.target), value: step.sensitive === true ? "[REDACTED]" : JSON.stringify(step.value) });
    case "press":
      return step.target === undefined ? msg("stepPress", { key: step.key }) : msg("stepPressOn", { key: step.key, target: describeTarget(step.target) });
    case "wait":
      return step.condition.kind === "timeout"
        ? msg("stepWaitMs", { ms: step.condition.ms })
        : step.condition.kind === "element"
          ? msg("stepWaitElement", { target: describeTarget(step.condition.target), state: step.condition.state })
          : msg("stepWaitLoad", { state: step.condition.state });
    case "screenshot":
      return step.name === undefined ? msg("stepScreenshot") : msg("stepScreenshotNamed", { name: step.name });
    case "observe":
      return step.label === undefined ? msg("stepObserve") : msg("stepObserveLabel", { label: step.label });
    case "assert":
      return assertionMessage(step.assertion);
  }
}
