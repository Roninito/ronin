/**
 * OllamaProvider — Ollama API integration (local and remote)
 */

import { BaseProvider, type AIProvider } from "./BaseProvider.js";
import type { CompletionOptions, Message, Tool, ToolCall } from "../../types/api.js";

export class OllamaProvider extends BaseProvider implements AIProvider {
  readonly name = "ollama";
  private model: string;
  private temperature: number;

  constructor(config: {
    baseUrl?: string;
    model?: string;
    temperature?: number;
    timeout?: number;
    apiKey?: string;
  }) {
    const baseUrl = (config.baseUrl || "http://localhost:11434")
      .replace(/\/+$/, "");

    super({
      baseUrl,
      apiKey: config.apiKey,
      timeout: config.timeout,
    });

    this.model = config.model || "llama2";
    this.temperature = config.temperature ?? 0.7;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const model = options?.model || this.model;
    const response = await this.request<{
      response: string;
    }>("/api/generate", {
      method: "POST",
      body: {
        model,
        prompt,
        stream: false,
        temperature: options?.temperature ?? this.temperature,
      },
    });

    return response.response;
  }

  async chat(messages: Message[], options?: { temperature?: number; maxTokens?: number }): Promise<Message> {
    const response = await this.request<{
      message: { role: string; content: string };
    }>("/api/chat", {
      method: "POST",
      body: {
        model: this.model,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        stream: false,
        temperature: options?.temperature ?? this.temperature,
      },
    });

    return response.message;
  }

  async *stream(prompt: string, options?: CompletionOptions): AsyncIterable<string> {
    const model = options?.model || this.model;
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        temperature: options?.temperature ?? this.temperature,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              yield data.response;
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *streamChat(messages: Message[]): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              yield data.message.content;
            }
          } catch {
            // Skip unparseable lines
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
    // Ollama doesn't natively support tool use, so we use prompt engineering
    const toolsDescription = tools
      .map(
        (tool) =>
          `- ${tool.name}: ${tool.description}${tool.parameters ? ` (parameters: ${JSON.stringify(tool.parameters)})` : ""}`,
      )
      .join("\n");

    const enhancedPrompt = `${prompt}\n\nAvailable tools:\n${toolsDescription}\n\nRespond with tool calls in format: TOOL: name, ARGS: {...}`;

    const response = await this.complete(enhancedPrompt, options);

    // Parse tool calls from response
    const toolCalls: ToolCall[] = [];
    const toolPattern = /TOOL:\s*(\w+),\s*ARGS:\s*({.*?})/g;
    let match;
    while ((match = toolPattern.exec(response)) !== null) {
      try {
        toolCalls.push({
          id: `${match[1]}_${Date.now()}`,
          name: match[1],
          arguments: JSON.parse(match[2]),
        });
      } catch {
        // Skip unparseable tool calls
      }
    }

    return {
      message: { role: "assistant", content: response },
      toolCalls,
    };
  }

  async checkModel(model?: string): Promise<boolean> {
    try {
      const testModel = model || this.model;
      const response = await this.request<{
        models: Array<{ name: string }>;
      }>("/api/tags", {
        method: "GET",
      });

      return response.models?.some((m) => m.name === testModel) ?? false;
    } catch {
      return false;
    }
  }
}
