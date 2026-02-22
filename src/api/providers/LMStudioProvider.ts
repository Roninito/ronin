/**
 * LMStudioProvider — Local and cloud LM Studio support
 * Supports both local (http://localhost:1234) and cloud deployments
 */

import { BaseProvider, type AIProvider } from "./BaseProvider.js";
import type { CompletionOptions, Message, Tool, ToolCall } from "../../types/api.js";

export interface LMStudioConfig {
  baseUrl?: string; // defaults to http://localhost:1234
  cloudUrl?: string; // for cloud deployments
  model?: string;
  timeout?: number;
}

export class LMStudioProvider extends BaseProvider implements AIProvider {
  readonly name = "lmstudio";
  private model: string;

  constructor(config: LMStudioConfig) {
    const baseUrl = config.baseUrl || config.cloudUrl || "http://localhost:1234";
    super({
      baseUrl,
      timeout: config.timeout,
    });
    this.model = config.model || "local-model";
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const model = options?.model || this.model;
    const response = await this.request<{
      choices: Array<{ text: string }>;
    }>("/v1/completions", {
      method: "POST",
      body: {
        model,
        prompt,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature || 0.7,
        top_p: options?.topP,
        stop: options?.stopSequences,
      },
    });

    return response.choices[0]?.text || "";
  }

  async chat(messages: Message[], options?: { temperature?: number; maxTokens?: number }): Promise<Message> {
    const response = await this.request<{
      choices: Array<{ message: { role: string; content: string } }>;
    }>("/v1/chat/completions", {
      method: "POST",
      body: {
        model: this.model,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature || 0.7,
      },
    });

    const choice = response.choices[0];
    return {
      role: choice?.message.role || "assistant",
      content: choice?.message.content || "",
    };
  }

  async *stream(prompt: string, options?: CompletionOptions): AsyncIterable<string> {
    const model = options?.model || this.model;
    const response = await fetch(`${this.baseUrl}/v1/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature || 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.statusText}`);
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
              if (data.choices?.[0]?.text) {
                yield data.choices[0].text;
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
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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
        max_tokens: 2048,
        temperature: 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.statusText}`);
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
              if (data.choices?.[0]?.delta?.content) {
                yield data.choices[0].delta.content;
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
    // LM Studio doesn't natively support tool use, so we use prompt engineering
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
      const response = await fetch(`${this.baseUrl}/v1/models`);
      if (!response.ok) return false;
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return data.data?.some((m) => m.id === testModel) ?? false;
    } catch {
      return false;
    }
  }
}
