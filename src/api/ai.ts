import type {
  CompletionOptions,
  Message,
  ChatOptions,
  Tool,
  ToolCall,
  ToolCallOptions,
} from "../types/api.js";

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:0.6b";

export class AIAPI {
  private baseUrl: string;
  private defaultModel: string;

  constructor(baseUrl: string = DEFAULT_OLLAMA_URL, defaultModel: string = DEFAULT_MODEL) {
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
  }

  /**
   * Complete a prompt using Ollama
   */
  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const model = options.model || this.defaultModel;
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response || "";
  }

  /**
   * Stream completions from Ollama
   */
  async *stream(prompt: string, options: CompletionOptions = {}): AsyncIterable<string> {
    const model = options.model || this.defaultModel;
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
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
            if (data.done) break;
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Chat with messages using Ollama
   */
  async chat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): Promise<Message> {
    const model = options.model || this.defaultModel;
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      role: "assistant",
      content: data.message?.content || "",
    };
  }

  /**
   * Stream chat responses from Ollama
   */
  async *streamChat(
    messages: Message[],
    options: Omit<ChatOptions, "messages"> = {}
  ): AsyncIterable<string> {
    const model = options.model || this.defaultModel;
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line);
              if (json.message?.content) {
                yield json.message.content;
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Call tools/functions using Ollama's function calling API
   * This enables AI agents to use plugins as tools
   * Falls back to JSON mode if function calling is not supported
   */
  async callTools(
    prompt: string,
    tools: Tool[],
    options: CompletionOptions = {}
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const model = options.model || this.defaultModel;

    // Try native function calling first
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          tools: tools,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();

      // Extract tool calls from response
      const toolCalls: ToolCall[] = [];
      if (data.message?.tool_calls) {
        for (const toolCall of data.message.tool_calls) {
          try {
            const args =
              typeof toolCall.function?.arguments === "string"
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function?.arguments || {};

            toolCalls.push({
              name: toolCall.function?.name || "",
              arguments: args,
            });
          } catch (error) {
            console.warn("Failed to parse tool call arguments:", error);
          }
        }
      }

      // If we got tool calls, return them
      if (toolCalls.length > 0 || data.message?.tool_calls) {
        return {
          message: {
            role: "assistant",
            content: data.message?.content || "",
          },
          toolCalls,
        };
      }
    } catch (error) {
      console.warn("Function calling not supported, falling back to JSON mode:", error);
    }

    // Fallback to JSON mode with prompt engineering
    return this.callToolsJSONMode(prompt, tools, options);
  }

  /**
   * Fallback: Use JSON mode to request tool calls
   */
  private async callToolsJSONMode(
    prompt: string,
    tools: Tool[],
    options: CompletionOptions = {}
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const model = options.model || this.defaultModel;

    // Build tool descriptions for the prompt
    const toolDescriptions = tools
      .map(
        (tool) =>
          `- ${tool.function.name}: ${tool.function.description} (parameters: ${JSON.stringify(tool.function.parameters)})`
      )
      .join("\n");

    const enhancedPrompt = `${prompt}

Available tools:
${toolDescriptions}

Respond with a JSON object in this format:
{
  "message": "your response text",
  "toolCalls": [
    {
      "name": "tool_name",
      "arguments": { "args": [...] }
    }
  ]
}`;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: enhancedPrompt,
        stream: false,
        format: "json",
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.response || "";

    // Parse JSON response
    try {
      const parsed = JSON.parse(responseText);
      const toolCalls: ToolCall[] = (parsed.toolCalls || []).map(
        (tc: { name: string; arguments: unknown }) => ({
          name: tc.name,
          arguments: tc.arguments || {},
        })
      );

      return {
        message: {
          role: "assistant",
          content: parsed.message || responseText,
        },
        toolCalls,
      };
    } catch (error) {
      // If JSON parsing fails, return the raw response
      console.warn("Failed to parse JSON response, returning raw text:", error);
      return {
        message: {
          role: "assistant",
          content: responseText,
        },
        toolCalls: [],
      };
    }
  }
}

