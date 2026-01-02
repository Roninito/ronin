import type { Plugin } from "../src/plugins/base.js";

/**
 * Gemini AI Plugin - Remote streaming AI calls using Google Gemini API
 * 
 * Requires GEMINI_API_KEY environment variable
 * API endpoint: https://generativelanguage.googleapis.com/v1beta
 */

interface GeminiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GeminiChatOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Stream chat completion from Gemini
 */
async function* streamGeminiChat(
  messages: GeminiMessage[],
  options: GeminiChatOptions = {}
): AsyncIterable<string> {
  // Try to get API key from environment or config
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Try loading from config file
    const { loadConfig } = await import("../src/cli/commands/config.js");
    const config = await loadConfig();
    apiKey = config.geminiApiKey;
  }
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required. Set it via environment variable or: ronin config --gemini-api-key <key>");
  }

  const model = options.model || "gemini-pro";
  
  // Convert messages to Gemini format
  // Gemini uses a different message format - combine system and user messages
  const contents = messages
    .filter(m => m.role !== "system") // System messages handled separately
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  // Extract system instruction if present
  const systemInstruction = messages.find(m => m.role === "system")?.content;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxOutputTokens,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.statusText} - ${error}`);
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
          try {
            const json = JSON.parse(data);
            const candidates = json.candidates;
            if (candidates && candidates.length > 0) {
              const content = candidates[0].content;
              if (content && content.parts) {
                for (const part of content.parts) {
                  if (part.text) {
                    yield part.text;
                  }
                }
              }
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
 * Chat completion from Gemini (non-streaming)
 */
async function geminiChat(
  messages: GeminiMessage[],
  options: GeminiChatOptions = {}
): Promise<string> {
  // Try to get API key from environment or config
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Try loading from config file
    const { loadConfig } = await import("../src/cli/commands/config.js");
    const config = await loadConfig();
    apiKey = config.geminiApiKey;
  }
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required. Set it via environment variable or: ronin config --gemini-api-key <key>");
  }

  const model = options.model || "gemini-pro";
  
  // Convert messages to Gemini format
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  // Extract system instruction if present
  const systemInstruction = messages.find(m => m.role === "system")?.content;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxOutputTokens,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  const candidates = data.candidates;
  if (candidates && candidates.length > 0) {
    const content = candidates[0].content;
    if (content && content.parts) {
      return content.parts.map((part: { text?: string }) => part.text || "").join("");
    }
  }
  return "";
}

const geminiPlugin: Plugin = {
  name: "gemini",
  description: "Remote AI calls using Google Gemini API with streaming support. Requires GEMINI_API_KEY environment variable.",
  methods: {
    chat: Object.assign(
      async (
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        options?: { model?: string; temperature?: number; maxOutputTokens?: number }
      ): Promise<string> => {
        return await geminiChat(messages, options);
      },
      {
        description: "Chat completion using Gemini API (non-streaming)",
        parameters: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              description: "Array of message objects with role and content",
            },
            options: {
              type: "object",
              description: "Optional settings: model (gemini-pro, gemini-pro-vision), temperature, maxOutputTokens",
            },
          },
          required: ["messages"],
        },
      }
    ),
    streamChat: Object.assign(
      function (
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        options?: { model?: string; temperature?: number; maxOutputTokens?: number }
      ): AsyncIterable<string> {
        return streamGeminiChat(messages, options);
      },
      {
        description: "Stream chat completion using Gemini API",
        parameters: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              description: "Array of message objects with role and content",
            },
            options: {
              type: "object",
              description: "Optional settings: model (gemini-pro, gemini-pro-vision), temperature, maxOutputTokens",
            },
          },
          required: ["messages"],
        },
      }
    ),
  },
};

export default geminiPlugin;

