import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PlannerOutput } from "./draft.js";
import {
  ModelPlanGenerator,
  PlannerConfigurationError,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type PlanGenerator,
} from "./generator.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export interface AnthropicOptions {
  model?: string;
  /**
   * Defaults to EXEGEZIS_ANTHROPIC_API_KEY, then ANTHROPIC_API_KEY (or
   * ANTHROPIC_AUTH_TOKEN). The EXEGEZIS-specific variable lets the product use
   * its own key without changing other tools that read ANTHROPIC_API_KEY.
   */
  apiKey?: string;
  /**
   * API endpoint. Taken only from this option or EXEGEZIS_ANTHROPIC_BASE_URL,
   * never implicitly from ANTHROPIC_BASE_URL: another tool's endpoint in the
   * environment must not silently receive EXEGEZIS traffic.
   */
  baseURL?: string;
  /** Injected client (tests). */
  client?: Pick<Anthropic, "messages">;
}

/**
 * Anthropic provider: one Messages API call with structured outputs. The JSON
 * schema comes from the same Zod schema the pipeline validates with; the SDK
 * strips constraints the API does not support, and the pipeline re-checks
 * everything client-side (the response is never trusted).
 */
export class AnthropicModelClient implements ModelClient {
  readonly provider = "anthropic";
  readonly model: string;
  private readonly client: Pick<Anthropic, "messages"> | undefined;
  private readonly apiKey: string | undefined;
  private readonly baseURL: string;

  constructor(options: AnthropicOptions = {}) {
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.client = options.client;
    this.apiKey = options.apiKey ?? process.env["EXEGEZIS_ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"];
    this.baseURL = options.baseURL ?? process.env["EXEGEZIS_ANTHROPIC_BASE_URL"] ?? DEFAULT_ANTHROPIC_BASE_URL;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const client = this.client ?? this.createClient();
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: { format: zodOutputFormat(PlannerOutput) },
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new PlannerConfigurationError(`Anthropic rejected the credentials (${error.status}): ${error.message}`);
      }
      throw error;
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return {
      text,
      model: message.model,
      stopReason:
        message.stop_reason === "end_turn"
          ? "end"
          : message.stop_reason === "max_tokens"
            ? "max_tokens"
            : message.stop_reason === "refusal"
              ? "refusal"
              : "other",
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }

  private createClient(): Anthropic {
    const authToken = process.env["ANTHROPIC_AUTH_TOKEN"];
    if ((this.apiKey === undefined || this.apiKey === "") && (authToken === undefined || authToken === "")) {
      throw new PlannerConfigurationError(
        "No Anthropic credentials: set EXEGEZIS_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN) in the environment, or use --planner mock.",
      );
    }
    return new Anthropic({
      baseURL: this.baseURL,
      ...(this.apiKey === undefined || this.apiKey === "" ? { authToken } : { apiKey: this.apiKey }),
    });
  }
}

/** A recorded model answer: the raw text the model would return. */
export interface MockResponse {
  text: string;
  stopReason?: ModelResponse["stopReason"];
}

/**
 * Deterministic provider for tests and CI: returns recorded answers instead
 * of calling a model. It goes through exactly the same parsing and
 * validation as a real provider — it only replaces the network call.
 */
export class MockModelClient implements ModelClient {
  readonly provider = "mock";
  readonly model = "mock-planner";

  constructor(private readonly respond: (request: ModelRequest) => MockResponse | Promise<MockResponse>) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const answer = await this.respond(request);
    return { text: answer.text, model: this.model, stopReason: answer.stopReason ?? "end", usage: null };
  }
}

export type ProviderName = "anthropic" | "mock";
export const PROVIDERS: readonly ProviderName[] = ["anthropic", "mock"];

export function createPlanGenerator(
  provider: ProviderName,
  options: { model?: string; mock?: (request: ModelRequest) => MockResponse | Promise<MockResponse> } = {},
): PlanGenerator {
  switch (provider) {
    case "anthropic":
      return new ModelPlanGenerator(new AnthropicModelClient(options.model === undefined ? {} : { model: options.model }));
    case "mock":
      if (options.mock === undefined) throw new PlannerConfigurationError("the mock planner needs recorded responses");
      return new ModelPlanGenerator(new MockModelClient(options.mock));
  }
}
