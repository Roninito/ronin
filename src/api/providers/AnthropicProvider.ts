/**
 * AnthropicProvider — Claude API integration via Anthropic
 * Supports both streaming and tool use
 */

import { APIError, BaseProvider, type AIProvider } from "./BaseProvider.js";
import type { CompletionOptions, Message, Tool, ToolCall } from "../../types/api.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1";

export class AnthropicProvider extends BaseProvider implements AIProvider {
  readonly name = "anthropic";
  private model: string;
  private static readonly DEFAULT_MODEL = "claude-3-5-sonnet-latest";
  private static readonly LEGACY_MODEL_MAP: Record<string, string> = {
    "claude-3-5-sonnet-20241022": "claude-3-5-sonnet-latest",
  };
  private static readonly FALLBACK_MODELS = [
    "claude-3-7-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
  ];
  
  private normalizeModel(model?: string): string {
    const chosen = (model || this.model || AnthropicProvider.DEFAULT_MODEL).trim();
    return AnthropicProvider.LEGACY_MODEL_MAP[chosen] || chosen;
  }

  private getModelCandidates(preferred?: string): string[] {
    const normalizedPreferred = this.normalizeModel(preferred);
    return [...new Set([normalizedPreferred, ...AnthropicProvider.FALLBACK_MODELS])];
  }

  private isModelNotFoundError(error: unknown): boolean {
    if (!(error instanceof APIError) || error.statusCode !== 404) return false;
    const raw = typeof error.details?.error === "string" ? error.details.error : "";
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { error?: { type?: string } };
      return parsed.error?.type === "not_found_error";
    } catch {
      return raw.includes("not_found_error") || raw.includes("model:");
    }
  }

  private async requestWithModelFallback<T>(
    preferredModel: string | undefined,
    runner: (model: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (const model of this.getModelCandidates(preferredModel)) {
      try {
        return await runner(model);
      } catch (error) {
        lastError = error;
        if (!this.isModelNotFoundError(error)) throw error;
      }
    }
    throw lastError;
  }

  private splitSystemMessages(messages: Message[]): {
    system?: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  } {
    const systemParts: string[] = [];
    const convertedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content);
      } else {
        convertedMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    if (convertedMessages.length === 0) {
      convertedMessages.push({ role: "user", content: "" });
    }

    return {
      system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages: convertedMessages,
    };
  }

  constructor(config: { apiKey: string; model?: string; timeout?: number }) {
    super({
      baseUrl: ANTHROPIC_API_URL,
      apiKey: config.apiKey,
      timeout: config.timeout,
    });
    this.model = this.normalizeModel(config.model || AnthropicProvider.DEFAULT_MODEL);
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const response = await this.requestWithModelFallback(options?.model, (model) => this.request<{
      content: Array<{ type: string; text?: string }>;
    }>("/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey || "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: options?.maxTokens || 2048,
        system: options?.systemPrompt,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature,
        top_p: options?.topP,
      },
    }));

    const textContent = response.content.find((c) => c.type === "text");
    return textContent?.text || "";
  }

  async chat(messages: Message[], options?: { temperature?: number; maxTokens?: number }): Promise<Message> {
    const { system, messages: convertedMessages } = this.splitSystemMessages(messages);

    const response = await this.requestWithModelFallback(undefined, (model) => this.request<{
      content: Array<{ type: string; text?: string }>;
    }>("/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey || "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: options?.maxTokens || 2048,
        system,
        messages: convertedMessages,
        temperature: options?.temperature,
      },
    }));

    const textContent = response.content.find((c) => c.type === "text");
    return {
      role: "assistant",
      content: textContent?.text || "",
    };
  }

  async *stream(prompt: string, options?: CompletionOptions): AsyncIterable<string> {
    const model = this.normalizeModel(options?.model);
    const response = await fetch(`${this.baseUrl}/messages/stream`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey || "",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens || 2048,
        system: options?.systemPrompt,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
                yield data.delta.text;
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *streamChat(messages: Message[]): AsyncIterable<string> {
    const { system, messages: convertedMessages } = this.splitSystemMessages(messages);

    const response = await fetch(`${this.baseUrl}/messages/stream`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey || "",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.normalizeModel(),
        max_tokens: 2048,
        system,
        messages: convertedMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
                yield data.delta.text;
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async callTools(
    prompt: string,
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const preferredModel = this.normalizeModel(options?.model);
    
    // Create a mapping from sanitized names back to original names
    // Anthropic only allows a-z, A-Z, 0-9, _, - in tool names
    const nameMapping: Record<string, string> = {};
    const anthropicTools = tools.map((tool) => {
      const toolName = (tool as any).name || tool.function?.name;
      const toolDescription = (tool as any).description || tool.function?.description || "";
      const toolParameters = (tool as any).parameters || tool.function?.parameters || {};
      if (!toolName) {
        throw new Error("Invalid tool schema: missing tool name");
      }
      const sanitizedName = toolName.replace(/\./g, "_");
      nameMapping[sanitizedName] = toolName;
      return {
        name: sanitizedName,
        description: toolDescription,
        input_schema: {
          type: "object",
          properties: toolParameters?.properties || {},
          required: toolParameters?.required || [],
        },
      };
    });

    const response = await this.requestWithModelFallback(preferredModel, (model) => this.request<{
      content: Array<{ type: string; text?: string; tool_use?: { id: string; name: string; input: Record<string, unknown> } }>;
    }>("/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey || "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: options?.maxTokens || 2048,
        system: options?.systemPrompt,
        messages: [{ role: "user", content: prompt }],
        tools: anthropicTools,
      },
    }));

    const toolCalls: ToolCall[] = [];
    let messageText = "";

    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        messageText = block.text;
      } else if (block.type === "tool_use" && block.tool_use) {
        // Map the sanitized name back to the original name with dots
        const toolName = nameMapping[block.tool_use.name] || block.tool_use.name;
        toolCalls.push({
          id: block.tool_use.id,
          name: toolName,
          arguments: block.tool_use.input,
        });
      }
    }

    return {
      message: { role: "assistant", content: messageText },
      toolCalls,
    };
  }

  async checkModel(model?: string): Promise<boolean> {
    try {
      const testModel = this.normalizeModel(model);
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey || "",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 256,
          messages: [{ role: "user", content: "test" }],
        }),
      });

      return response.ok || response.status === 400; // 400 might indicate model doesn't exist
    } catch {
      return false;
    }
  }
}
