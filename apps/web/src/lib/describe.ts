import { describeAssertion, describeTarget, type PlanStep } from "@exegezis/core";

/** One-line description of a plan step, built on core's own describers. */
export function describeStep(step: PlanStep): string {
  switch (step.type) {
    case "navigate":
      return `navigate to ${step.url}`;
    case "click":
      return `click ${describeTarget(step.target)}`;
    case "fill":
      return `fill ${describeTarget(step.target)} with ${step.sensitive === true ? "[REDACTED]" : JSON.stringify(step.value)}`;
    case "press":
      return `press ${step.key}${step.target === undefined ? "" : ` on ${describeTarget(step.target)}`}`;
    case "wait":
      return step.condition.kind === "timeout"
        ? `wait ${step.condition.ms} ms`
        : step.condition.kind === "element"
          ? `wait until ${describeTarget(step.condition.target)} is ${step.condition.state}`
          : `wait for ${step.condition.state}`;
    case "screenshot":
      return `screenshot${step.name === undefined ? "" : ` "${step.name}"`}`;
    case "observe":
      return `observe the page${step.label === undefined ? "" : ` (${step.label})`}`;
    case "assert":
      return describeAssertion(step.assertion);
  }
}
