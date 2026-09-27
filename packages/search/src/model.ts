import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/*
 * The model behind searches by meaning and term suggestions. One Messages API
 * call per batch, with structured output; thinking is off so the output (and
 * the cost) stays bounded by max_tokens. The answer is never trusted: it is
 * parsed with the same schema and every quote is checked literally.
 */

export interface ModelAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: "end" | "max_tokens" | "refusal" | "other";
}

export interface SearchModelClient {
  readonly provider: string;
  readonly model: string;
  /** Exact input tokens of a request, or null when counting is not available. */
  count(system: string, user: string): Promise<number | null>;
  complete(system: string, user: string, schema: z.ZodType, maxTokens: number): Promise<ModelAnswer>;
}

export class ModelConfigurationError extends Error {
  override readonly name = "ModelConfigurationError";
}

function credentials(): { apiKey?: string; authToken?: string } | null {
  const apiKey = process.env["EXEGEZIS_ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"];
  if (apiKey !== undefined && apiKey !== "") return { apiKey };
  const authToken = process.env["ANTHROPIC_AUTH_TOKEN"];
  if (authToken !== undefined && authToken !== "") return { authToken };
  return null;
}

export function modelCredentialsConfigured(): boolean {
  return credentials() !== null;
}

export class AnthropicSearchClient implements SearchModelClient {
  readonly provider = "anthropic";
  private client: Pick<Anthropic, "messages"> | null;

  constructor(
    readonly model: string,
    client?: Pick<Anthropic, "messages">,
  ) {
    this.client = client ?? null;
  }

  private sdk(): Pick<Anthropic, "messages"> {
    if (this.client !== null) return this.client;
    const c = credentials();
    if (c === null) {
      throw new ModelConfigurationError("No Anthropic credentials: set EXEGEZIS_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in the environment. The exact search does not need them.");
    }
    // The endpoint is only ever this option or EXEGEZIS_ANTHROPIC_BASE_URL (same rule as the planner).
    this.client = new Anthropic({ baseURL: process.env["EXEGEZIS_ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com", ...c });
    return this.client;
  }

  async count(system: string, user: string): Promise<number | null> {
    try {
      const r = await this.sdk().messages.countTokens({ model: this.model, system, messages: [{ role: "user", content: user }] });
      return r.input_tokens;
    } catch (error) {
      if (error instanceof ModelConfigurationError) throw error;
      return null;
    }
  }

  async complete(system: string, user: string, schema: z.ZodType, maxTokens: number): Promise<ModelAnswer> {
    let message: Anthropic.Message;
    try {
      message = await this.sdk().messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(schema) },
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ModelConfigurationError(`Anthropic rejected the credentials (${error.status}): ${error.message}`);
      }
      throw error;
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      stopReason: message.stop_reason === "end_turn" ? "end" : message.stop_reason === "max_tokens" ? "max_tokens" : message.stop_reason === "refusal" ? "refusal" : "other",
    };
  }
}

/** Tests and demos: recorded answers, through the same parsing and verification. */
export class MockSearchClient implements SearchModelClient {
  readonly provider = "mock";
  readonly model: string;
  calls = 0;

  constructor(
    private readonly respond: (system: string, user: string) => string,
    model = "claude-sonnet-5",
  ) {
    this.model = model;
  }

  count(): Promise<number | null> {
    return Promise.resolve(null);
  }

  complete(system: string, user: string): Promise<ModelAnswer> {
    this.calls += 1;
    const text = this.respond(system, user);
    return Promise.resolve({ text, inputTokens: Math.ceil((system.length + user.length) / 3), outputTokens: Math.ceil(text.length / 3), stopReason: "end" });
  }
}
