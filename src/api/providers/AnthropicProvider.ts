/**
 * AnthropicProvider — Claude API integration via Anthropic
 * Supports both streaming and tool use
 */

import { BaseProvider, type AIProvider } from "./BaseProvider.js";
import type { CompletionOptions, Message, Tool, ToolCall } from "../../types/api.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1";

export class AnthropicProvider extends BaseProvider implements AIProvider {
  readonly name = "anthropic";
  private model: string;

  constructor(config: { apiKey: string; model?: string; timeout?: number }) {
    super({
      baseUrl: ANTHROPIC_API_URL,
      apiKey: config.apiKey,
      timeout: config.timeout,
    });
    this.model = config.model || "claude-3-5-sonnet-20241022";
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const model = options?.model || this.model;
    const response = await this.request<{
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
    });

    const textContent = response.content.find((c) => c.type === "text");
    return textContent?.text || "";
  }

  async chat(messages: Message[], options?: { temperature?: number; maxTokens?: number }): Promise<Message> {
    const convertedMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await this.request<{
      content: Array<{ type: string; text?: string }>;
    }>("/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey || "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: this.model,
        max_tokens: options?.maxTokens || 2048,
        messages: convertedMessages,
        temperature: options?.temperature,
      },
    });

    const textContent = response.content.find((c) => c.type === "text");
    return {
      role: "assistant",
      content: textContent?.text || "",
    };
  }

  async *stream(prompt: string, options?: CompletionOptions): AsyncIterable<string> {
    const model = options?.model || this.model;
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
    const convertedMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await fetch(`${this.baseUrl}/messages/stream`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey || "",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
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
    const model = options?.model || this.model;
    const anthropicTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties: tool.parameters?.properties || {},
        required: tool.parameters?.required || [],
      },
    }));

    const response = await this.request<{
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
    });

    const toolCalls: ToolCall[] = [];
    let messageText = "";

    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        messageText = block.text;
      } else if (block.type === "tool_use" && block.tool_use) {
        toolCalls.push({
          id: block.tool_use.id,
          name: block.tool_use.name,
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
      const testModel = model || this.model;
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
