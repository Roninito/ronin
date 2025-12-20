import type { Plugin } from "../src/plugins/base.js";

/**
 * Grok AI Plugin - Remote streaming AI calls using Grok API
 * 
 * Requires GROK_API_KEY environment variable
 * API endpoint: https://api.x.ai/v1
 */

interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GrokChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * Stream chat completion from Grok
 */
async function* streamGrokChat(
  messages: GrokMessage[],
  options: GrokChatOptions = {}
): AsyncIterable<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error("GROK_API_KEY environment variable is required");
  }

  const model = options.model || "grok-beta";
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grok API error: ${response.statusText} - ${error}`);
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
        if (line.trim() && line.startsWith("data: ")) {
          const data = line.slice(6); // Remove "data: " prefix
          if (data === "[DONE]") {
            return;
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
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
 * Chat completion from Grok (non-streaming)
 */
async function grokChat(
  messages: GrokMessage[],
  options: GrokChatOptions = {}
): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error("GROK_API_KEY environment variable is required");
  }

  const model = options.model || "grok-beta";
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grok API error: ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

const grokPlugin: Plugin = {
  name: "grok",
  description: "Remote AI calls using Grok API with streaming support. Requires GROK_API_KEY environment variable.",
  methods: {
    chat: Object.assign(
      async (
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        options?: { model?: string; temperature?: number; max_tokens?: number }
      ): Promise<string> => {
        return await grokChat(messages, options);
      },
      {
        description: "Chat completion using Grok API (non-streaming)",
        parameters: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              description: "Array of message objects with role and content",
            },
            options: {
              type: "object",
              description: "Optional settings: model, temperature, max_tokens",
            },
          },
          required: ["messages"],
        },
      }
    ),
    streamChat: Object.assign(
      function (
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        options?: { model?: string; temperature?: number; max_tokens?: number }
      ): AsyncIterable<string> {
        return streamGrokChat(messages, options);
      },
      {
        description: "Stream chat completion using Grok API",
        parameters: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              description: "Array of message objects with role and content",
            },
            options: {
              type: "object",
              description: "Optional settings: model, temperature, max_tokens",
            },
          },
          required: ["messages"],
        },
      }
    ),
  },
};

export default grokPlugin;

