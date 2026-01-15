import type { Plugin } from "../src/plugins/base.js";

/**
 * Gemini AI Plugin - Remote streaming AI calls using Google Gemini API
 * 
 * Requires GEMINI_API_KEY environment variable (set via header x-goog-api-key)
 * API endpoint: https://generativelanguage.googleapis.com/v1beta (default) or v1
 * 
 * Available models (v1beta API):
 * - gemini-1.5-pro (default)
 * - gemini-1.5-flash
 * - gemini-3-pro-preview
 * 
 * Set GEMINI_API_VERSION environment variable to use v1 instead of v1beta
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

  // Get model from options, environment variable, config file, or use default
  let model = options.model;
  if (!model) {
    model = process.env.GEMINI_MODEL;
    if (!model) {
      // Try loading from config file
      const { loadConfig } = await import("../src/cli/commands/config.js");
      const config = await loadConfig();
      model = config.geminiModel;
    }
    // Default model - try gemini-1.5-flash first (fast), fallback options: gemini-1.5-pro, gemini-3-pro-preview
    // Note: Model availability depends on your API key and region
    model = model || "gemini-1.5-flash";
  }
  
  // Extract system instruction if present
  const systemInstruction = messages.find(m => m.role === "system")?.content;

  // Use v1beta API by default (matches Google's documentation examples)
  // Can override via GEMINI_API_VERSION environment variable (v1 or v1beta)
  const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";
  
  // Convert messages to Gemini format
  // For v1 API, include system instruction in contents; for v1beta, handle separately
  let contents = messages
    .filter(m => m.role !== "system") // System messages handled separately
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  // For v1 API, prepend system instruction as first user message if present
  if (apiVersion === "v1" && systemInstruction) {
    contents = [
      {
        role: "user",
        parts: [{ text: systemInstruction }],
      },
      ...contents,
    ];
  }

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:streamGenerateContent`;
  
  // Debug: Log the URL being used (without API key)
  if (process.env.DEBUG_GEMINI) {
    console.error(`[DEBUG] Gemini API URL: ${url}`);
    console.error(`[DEBUG] Model: ${model}, API Version: ${apiVersion}`);
  }
  
  // Build request body
  const requestBody: any = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens,
    },
  };
  
  // v1beta supports systemInstruction as separate field
  if (apiVersion === "v1beta" && systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Gemini API error: ${response.status} ${response.statusText}`;
    if (errorText) {
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage += ` - ${errorJson.error.message}`;
          // Include model and API version in error for debugging
          errorMessage += ` (Model: ${model}, API: ${apiVersion})`;
        } else {
          errorMessage += ` - ${errorText}`;
        }
      } catch {
        errorMessage += ` - ${errorText}`;
      }
    } else {
      errorMessage += ` (Model: ${model}, API: ${apiVersion})`;
    }
    throw new Error(errorMessage);
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

  // Get model from options, environment variable, config file, or use default
  let model = options.model;
  if (!model) {
    model = process.env.GEMINI_MODEL;
    if (!model) {
      // Try loading from config file
      const { loadConfig } = await import("../src/cli/commands/config.js");
      const config = await loadConfig();
      model = config.geminiModel;
    }
    // Default model - try gemini-1.5-flash first (fast), fallback options: gemini-1.5-pro, gemini-3-pro-preview
    // Note: Model availability depends on your API key and region
    model = model || "gemini-1.5-flash";
  }
  
  // Extract system instruction if present
  const systemInstruction = messages.find(m => m.role === "system")?.content;

  // Use v1beta API by default (matches Google's documentation examples)
  // Can override via GEMINI_API_VERSION environment variable (v1 or v1beta)
  const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";
  
  // Convert messages to Gemini format
  // For v1 API, include system instruction in contents; for v1beta, handle separately
  let contents = messages
    .filter(m => m.role !== "system") // System messages handled separately
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  // For v1 API, prepend system instruction as first user message if present
  if (apiVersion === "v1" && systemInstruction) {
    contents = [
      {
        role: "user",
        parts: [{ text: systemInstruction }],
      },
      ...contents,
    ];
  }

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent`;
  
  // Debug: Log the URL being used (without API key)
  if (process.env.DEBUG_GEMINI) {
    console.error(`[DEBUG] Gemini API URL: ${url}`);
    console.error(`[DEBUG] Model: ${model}, API Version: ${apiVersion}`);
  }
  
  // Build request body
  const requestBody: any = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens,
    },
  };
  
  // v1beta supports systemInstruction as separate field
  if (apiVersion === "v1beta" && systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Gemini API error: ${response.status} ${response.statusText}`;
    if (errorText) {
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage += ` - ${errorJson.error.message}`;
          // Include model and API version in error for debugging
          errorMessage += ` (Model: ${model}, API: ${apiVersion})`;
        } else {
          errorMessage += ` - ${errorText}`;
        }
      } catch {
        errorMessage += ` - ${errorText}`;
      }
    } else {
      errorMessage += ` (Model: ${model}, API: ${apiVersion})`;
    }
    
    // If it's a 404, suggest trying a different model
    if (response.status === 404) {
      errorMessage += `\n💡 Tip: Try a different model: bun run ronin config --gemini-model gemini-1.5-pro`;
      errorMessage += `\n   Or: bun run ronin config --gemini-model gemini-3-pro-preview`;
    }
    
    throw new Error(errorMessage);
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
              description: "Optional settings: model (gemini-pro, gemini-1.5-pro-latest, gemini-1.5-flash-latest, etc.), temperature, maxOutputTokens",
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
              description: "Optional settings: model (gemini-pro, gemini-1.5-pro-latest, gemini-1.5-flash-latest, etc.), temperature, maxOutputTokens",
            },
          },
          required: ["messages"],
        },
      }
    ),
  },
};

export default geminiPlugin;

