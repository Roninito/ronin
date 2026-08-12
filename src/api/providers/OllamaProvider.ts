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
    // `tools` is always OpenAIFunctionSchema-shaped ({type, function:{name,
    // description, parameters}}) at every real call site (chatty.ts, etc.) —
    // never the flat {name, description, parameters} this used to assume,
    // which meant every tool rendered as "undefined: undefined" and the
    // model was never told what tools actually existed. Reading
    // tool.function.* fixes that regardless of which calling path is used
    // below.
    const model = options?.model || this.model;

    // Ollama's /api/chat accepts an OpenAI-compatible `tools` array directly
    // for tool-calling-capable models — no prompt engineering required.
    // Also embed a plain-text tool listing in the prompt as a fallback for
    // models that don't honor the native `tools` field, matching the
    // "TOOL: name, ARGS: {...}" format the shared system prompt documents.
    const toolsDescription = tools
      .map((tool) => {
        const fn = tool.function;
        return `- ${fn?.name}: ${fn?.description}${fn?.parameters ? ` (parameters: ${JSON.stringify(fn.parameters)})` : ""}`;
      })
      .join("\n");
    const enhancedPrompt = `${prompt}\n\nAvailable tools:\n${toolsDescription}\n\nIf your model doesn't support native tool calls, respond with tool calls in format: TOOL: name, ARGS: {...}`;

    const response = await this.request<{
      message: { role: string; content: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
    }>("/api/chat", {
      method: "POST",
      body: {
        model,
        messages: [{ role: "user", content: enhancedPrompt }],
        tools,
        stream: false,
        temperature: options?.temperature ?? this.temperature,
      },
    });

    const content = response.message?.content ?? "";
    const toolCalls: ToolCall[] = [];

    for (const call of response.message?.tool_calls ?? []) {
      const rawArgs = call.function?.arguments;
      let parsedArgs: Record<string, unknown>;
      if (typeof rawArgs === "string") {
        try {
          parsedArgs = JSON.parse(rawArgs);
        } catch {
          continue;
        }
      } else {
        parsedArgs = (rawArgs as Record<string, unknown>) ?? {};
      }
      toolCalls.push({
        id: `${call.function.name}_${Date.now()}`,
        name: call.function.name,
        arguments: parsedArgs,
      });
    }

    // Fallback: some models ignore the native `tools` field and only follow
    // the text instruction. Only used when native tool_calls came back empty.
    if (toolCalls.length === 0) {
      const toolPattern = /TOOL:\s*([\w.]+),\s*ARGS:\s*({.*?})/g;
      let match;
      while ((match = toolPattern.exec(content)) !== null) {
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
    }

    return {
      message: { role: "assistant", content },
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
