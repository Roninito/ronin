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
    // `tools` is always OpenAIFunctionSchema-shaped ({type, function:{name,
    // description, parameters}}), not the flat {name, description, parameters}
    // this used to assume — reading tool.function.* fixes the "undefined:
    // undefined" tool listing that resulted.
    const model = options?.model || this.model;

    // LM Studio's /v1/chat/completions is OpenAI-compatible and accepts a
    // native `tools` array for tool-calling-capable models. Also embed a
    // plain-text tool listing as a fallback for models that ignore it,
    // matching the "TOOL: name, ARGS: {...}" format the shared system
    // prompt documents.
    const toolsDescription = tools
      .map((tool) => {
        const fn = tool.function;
        return `- ${fn?.name}: ${fn?.description}${fn?.parameters ? ` (parameters: ${JSON.stringify(fn.parameters)})` : ""}`;
      })
      .join("\n");
    const enhancedPrompt = `${prompt}\n\nAvailable tools:\n${toolsDescription}\n\nIf your model doesn't support native tool calls, respond with tool calls in format: TOOL: name, ARGS: {...}`;

    const response = await this.request<{
      choices: Array<{ message: { role: string; content: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> } }>;
    }>("/v1/chat/completions", {
      method: "POST",
      body: {
        model,
        messages: [{ role: "user", content: enhancedPrompt }],
        tools,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP,
        stop: options?.stopSequences,
      },
    });

    const choiceMessage = response.choices[0]?.message;
    const content = choiceMessage?.content ?? "";
    const toolCalls: ToolCall[] = [];

    for (const call of choiceMessage?.tool_calls ?? []) {
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
      const response = await fetch(`${this.baseUrl}/v1/models`);
      if (!response.ok) return false;
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return data.data?.some((m) => m.id === testModel) ?? false;
    } catch {
      return false;
    }
  }
}
