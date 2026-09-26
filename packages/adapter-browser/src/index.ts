export { BROWSER_ADAPTER_DESCRIPTOR, BrowserAdapter } from "./adapter.js";
export { axeSelector, evaluateAssertion, matchesRequestUrl, SUPPORTED_ASSERTIONS, type AssertionContext, type EvaluateOptions } from "./assertions.js";
export { toLocator } from "./locator.js";
export { BrowserAdapterOptions, type BrowserAdapterOptionsInput } from "./options.js";
export { BrowserSession, TRACE_FILE } from "./session.js";
export { sanitizeTraceArchive, type TraceSanitizeResult } from "./trace-redaction.js";
export { HttpProbe, type HttpProbeOptions, type ProbeResult } from "./probe.js";
export {
  BROWSER_CHANNELS,
  CHANNEL_LABEL,
  candidatesFor,
  launchBrowser,
  launchErrorSummary,
  probeBrowsers,
  remedyFor,
  type BrowserChannel,
  type BrowserProbe,
  type ConcreteChannel,
  type LaunchedBrowser,
  type Launcher,
} from "./browsers.js";
