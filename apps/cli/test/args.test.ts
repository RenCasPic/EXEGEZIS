import { describe, expect, it } from "vitest";
import { parseCliArgs, UsageError } from "../src/args.js";

describe("parseCliArgs", () => {
  it("parses observe with defaults", () => {
    expect(parseCliArgs(["observe", "--url", "http://localhost:3000"])).toEqual({
      kind: "observe",
      url: "http://localhost:3000/",
      output: "./runs",
      headed: false,
      verbose: false,
    });
  });

  it("parses every observe option", () => {
    expect(
      parseCliArgs(["observe", "--url", "https://app.test/x", "--output", "out", "--actions", "plan.json", "--headed", "--verbose"]),
    ).toEqual({
      kind: "observe",
      url: "https://app.test/x",
      output: "out",
      actionsFile: "plan.json",
      headed: true,
      verbose: true,
    });
    expect(parseCliArgs(["observe", "--url=http://localhost:3000", "--output=./r"])).toMatchObject({ output: "./r" });
  });

  it("returns help and version", () => {
    expect(parseCliArgs([])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["observe", "-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
  });

  it.each([
    [["observe"], /Missing required option --url/],
    [["observe", "--url", "not a url"], /Invalid --url/],
    [["observe", "--url", "file:///etc/passwd"], /must use http or https/],
    [["observe", "--url", "http://x", "--output", ""], /--output must not be empty/],
    [["observe", "--url", "http://x", "--bogus"], /Unknown option/],
    [["observe", "--url", "http://x", "extra"], /Unexpected argument "extra"/],
    [["launch"], /Unknown command "launch"/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});
