import { describe, expect, it } from "vitest";
import { parseCliArgs, UsageError } from "../src/args.js";

const common = { output: "./runs", headed: false, verbose: false };

describe("parseCliArgs", () => {
  it("parses observe with defaults and every option", () => {
    expect(parseCliArgs(["observe", "--url", "http://localhost:3000"])).toEqual({ kind: "observe", url: "http://localhost:3000/", ...common });
    expect(
      parseCliArgs(["observe", "--url", "https://app.test/x", "--output", "out", "--actions", "plan.json", "--headed", "--verbose"]),
    ).toEqual({ kind: "observe", url: "https://app.test/x", actionsFile: "plan.json", output: "out", headed: true, verbose: true });
  });

  it("parses run, reproduce, compile and verify", () => {
    expect(parseCliArgs(["run", "--plan", "p.json"])).toEqual({ kind: "run", planFile: "p.json", ...common });
    expect(parseCliArgs(["run", "--plan", "p.json", "--base-url", "https://staging.test"])).toMatchObject({ baseUrl: "https://staging.test/" });
    expect(parseCliArgs(["reproduce", "--plan", "p.json"])).toEqual({ kind: "reproduce", planFile: "p.json", runs: 10, ...common });
    expect(parseCliArgs(["reproduce", "--plan", "p.json", "--runs", "3"])).toMatchObject({ runs: 3 });
    expect(parseCliArgs(["compile", "--plan", "p.json", "--output", "specs"])).toEqual({ kind: "compile", planFile: "p.json", output: "specs" });
    expect(parseCliArgs(["verify", "--plan", "p.json", "--runs=5"])).toEqual({ kind: "verify", planFile: "p.json", runs: 5, ...common });
  });

  it("parses validate and benchmark", () => {
    expect(parseCliArgs(["validate", "--plan", "p.json"])).toEqual({ kind: "validate", planFile: "p.json", ...common });
    expect(parseCliArgs(["benchmark", "--suite", "buggy-shop"])).toEqual({ kind: "benchmark", suite: "buggy-shop", examples: true, ...common });
    expect(parseCliArgs(["benchmark", "--suite", "buggy-shop", "--runs", "3", "--case", "BUG-001", "--case", "BUG-002"])).toMatchObject({
      runs: 3,
      caseIds: ["BUG-001", "BUG-002"],
    });
  });

  it("returns help and version", () => {
    expect(parseCliArgs([])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["verify", "-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
  });

  it.each([
    [["observe"], /Missing required option --url/],
    [["observe", "--url", "not a url"], /Invalid --url/],
    [["observe", "--url", "file:///etc/passwd"], /must use http or https/],
    [["observe", "--url", "http://x", "--output", ""], /--output must not be empty/],
    [["observe", "--url", "http://x", "--bogus"], /Unknown option/],
    [["observe", "--url", "http://x", "extra"], /Unexpected argument "extra"/],
    [["observe", "--url", "http://x", "--plan", "p.json"], /--plan is not valid for "observe"/],
    [["run"], /Missing required option --plan/],
    [["run", "--plan", "p.json", "--runs", "3"], /--runs is not valid for "run"/],
    [["reproduce", "--plan", "p.json", "--runs", "0"], /--runs must be an integer between 1 and 100/],
    [["verify", "--plan", "p.json", "--runs", "2.5"], /--runs must be an integer/],
    [["verify", "--plan", "p.json", "--base-url", "ftp://x"], /--base-url must use http or https/],
    [["compile", "--plan", "p.json", "--headed"], /not valid for "compile"/],
    [["launch"], /Unknown command "launch"/],
    [["benchmark"], /Missing required option --suite/],
    [["benchmark", "--suite", "x", "--plan", "p.json"], /--plan is not valid for "benchmark"/],
    [["validate", "--plan", "p.json", "--runs", "3"], /--runs is not valid for "validate"/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});
