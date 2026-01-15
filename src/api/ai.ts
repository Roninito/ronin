import type {
  CompletionOptions,
  Message,
  ChatOptions,
  Tool,
  ToolCall,
  ToolCallOptions,
} from "../types/api.js";

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";
const DEFAULT_OLLAMA_TIMEOUT_MS = (() => {
  const raw =
    process.env.OLLAMA_TIMEOUT_MS ||
    process.env.RONIN_AI_TIMEOUT_MS ||
    process.env.RONIN_OLLAMA_TIMEOUT_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  // Default: 90 seconds (based on testing - complex prompts need more time)
  return Number.isFinite(parsed) ? parsed : 90_000;
})();

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getTimeoutMs(options?: CompletionOptions): number {
  return options?.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
}

export class AIAPI {
  private baseUrl: string;
  private defaultModel: string;

  constructor(baseUrl: string = DEFAULT_OLLAMA_URL, defaultModel: string = DEFAULT_MODEL) {
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
  }

  /**
   * Check if a model exists in Ollama
   */
  async checkModel(model?: string): Promise<boolean> {
    const modelToCheck = model || this.defaultModel;
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const models = data.models || [];
      return models.some((m: { name: string }) => m.name === modelToCheck || m.name.startsWith(`${modelToCheck}:`));
    } catch {
      return false;
    }
  }

  /**
   * Complete a prompt using Ollama
   */
  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const model = options.model || this.defaultModel;
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/generate`,
      {
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
      },
      getTimeoutMs(options)
    );

    if (!response.ok) {
      if (response.status === 404) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Model "${model}" not found. Please pull it first:\n   ollama pull ${model}\n\nOr use a different model with --ollama-model <model-name>`);
      }
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
    }

    const data = await response.json();
    const responseText = data.response || "";
    
    // Log empty responses for debugging (but don't spam)
    if (!responseText) {
      console.warn(`[AI] Empty response from Ollama for model "${model}".`);
      if (data.thinking) {
        console.warn(`[AI] Thinking present but no response. Thinking preview:`, data.thinking.substring(0, 100));
      }
      if (data.done_reason) {
        console.warn(`[AI] Done reason: ${data.done_reason}`);
      }
    }
    
    return responseText;
  }

  /**
   * Stream completions from Ollama
   */
  async *stream(prompt: string, options: CompletionOptions = {}): AsyncIterable<string> {
    const model = options.model || this.defaultModel;
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/generate`,
      {
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
      },
      getTimeoutMs(options)
    );

    if (!response.ok) {
      if (response.status === 404) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Model "${model}" not found. Please pull it first:\n   ollama pull ${model}\n\nOr use a different model with --ollama-model <model-name>`);
      }
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
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
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
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
      },
      getTimeoutMs(options)
    );

    if (!response.ok) {
      if (response.status === 404) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Model "${model}" not found. Please pull it first:\n   ollama pull ${model}\n\nOr use a different model with --ollama-model <model-name>`);
      }
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
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
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
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
      },
      getTimeoutMs(options)
    );

    if (!response.ok) {
      if (response.status === 404) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Model "${model}" not found. Please pull it first:\n   ollama pull ${model}\n\nOr use a different model with --ollama-model <model-name>`);
      }
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
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
      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
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
        },
        getTimeoutMs(options)
      );

      if (!response.ok) {
        // If model not found (404), provide helpful error message
        if (response.status === 404) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`Model "${model}" not found. Please pull it first:\n   ollama pull ${model}\n\nOr use a different model with --ollama-model <model-name>`);
        }
        // If Ollama is not available (connection error), re-throw immediately
        if (response.status === 0) {
          throw new Error(`Ollama API error: ${response.statusText}`);
        }
        const errorText = await response.text().catch(() => "");
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
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
      // If it's a connection/404 error (Ollama not available), re-throw it
      const errorMessage = (error as Error).message || String(error);
      if (errorMessage.includes("Ollama API error") && (errorMessage.includes("Not Found") || errorMessage.includes("Failed to fetch"))) {
        throw error;
      }
      // Otherwise, fall back to JSON mode for other errors (like function calling not supported)
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

    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/generate`,
      {
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
      },
      getTimeoutMs(options)
    );

    if (!response.ok) {
      if (response.status === 404) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Model "${model}" not found. Please pull it first:\n   ollama pull ${model}\n\nOr use a different model with --ollama-model <model-name>`);
      }
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
    }

    const data = await response.json();
    const responseText = data.response || "";

    // Parse JSON response - try to extract JSON from the response if it's embedded in text
    try {
      // Try to find JSON object in the response (in case model added extra text)
      let jsonText = responseText.trim();
      
      // Remove markdown code blocks if present
      if (jsonText.startsWith("```json")) {
        jsonText = jsonText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
      } else if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
      }
      
      // Try to find JSON object boundaries
      const jsonStart = jsonText.indexOf("{");
      const jsonEnd = jsonText.lastIndexOf("}");
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
      }
      
      const parsed = JSON.parse(jsonText);
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
      // If JSON parsing fails, return empty tool calls and empty message
      // This signals to the caller that tool calling didn't work and they should use regular chat
      // The raw response text is likely incomplete JSON and not useful
      return {
        message: {
          role: "assistant",
          content: "",
        },
        toolCalls: [],
      };
    }
  }
}

