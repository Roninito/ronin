import type { Plugin } from "../src/plugins/base.js";
import { getConfigService } from "../src/config/ConfigService.js";

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
 * Get Gemini configuration from centralized ConfigService
 */
async function getGeminiConfig(options: GeminiChatOptions = {}) {
  let apiKey: string | undefined;
  let model: string | undefined;
  let apiVersion: string | undefined;
  let debug = false;
  
  // First try centralized ConfigService
  try {
    const configService = getConfigService();
    const configGemini = configService.getGemini();
    apiKey = configGemini.apiKey || undefined;
    model = options.model || configGemini.model || undefined;
    apiVersion = configGemini.apiVersion;
    debug = configGemini.debug;
  } catch {
    // ConfigService not initialized
  }
  
  // Fallback to environment variables
  if (!apiKey) {
    apiKey = process.env.GEMINI_API_KEY;
  }
  if (!model) {
    model = process.env.GEMINI_MODEL;
  }
  if (!apiVersion) {
    apiVersion = process.env.GEMINI_API_VERSION;
  }
  if (!debug) {
    debug = !!process.env.DEBUG_GEMINI;
  }
  
  // Try legacy config file
  if (!apiKey || !model) {
    try {
      const { loadConfig } = await import("../src/cli/commands/config.js");
      const config = await loadConfig();
      if (!apiKey) apiKey = config.geminiApiKey;
      if (!model) model = config.geminiModel;
    } catch {
      // Config file not available
    }
  }
  
  // Default values
  model = model || "gemini-1.5-flash";
  apiVersion = apiVersion || "v1beta";
  
  return { apiKey, model, apiVersion, debug };
}

/**
 * Stream chat completion from Gemini
 */
async function* streamGeminiChat(
  messages: GeminiMessage[],
  options: GeminiChatOptions = {}
): AsyncIterable<string> {
  const { apiKey, model, apiVersion, debug } = await getGeminiConfig(options);
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required. Set it via config (gemini.apiKey), environment variable (GEMINI_API_KEY), or: ronin config --gemini-api-key <key>");
  }
  
  // Extract system instruction if present
  const systemInstruction = messages.find(m => m.role === "system")?.content;

  // Convert messages to Gemini format
  let contents = messages
    .filter(m => m.role !== "system")
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
  if (debug) {
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

  // Stream the response
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Parse the chunk
      const chunk = new TextDecoder().decode(value);
      const lines = chunk.split("\n").filter(line => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          // Extract text from the response
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            yield text;
          }
        } catch {
          // Ignore parse errors for incomplete chunks
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
  const { apiKey, model, apiVersion, debug } = await getGeminiConfig(options);
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required. Set it via config (gemini.apiKey), environment variable (GEMINI_API_KEY), or: ronin config --gemini-api-key <key>");
  }
  
  // Extract system instruction if present
  const systemInstruction = messages.find(m => m.role === "system")?.content;

  // Convert messages to Gemini format
  let contents = messages
    .filter(m => m.role !== "system")
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
  if (debug) {
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

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/**
 * Gemini plugin definition
 */
const geminiPlugin: Plugin = {
  name: "gemini",
  description: "Google Gemini AI for streaming and non-streaming chat completions",
  methods: {
    /**
     * Stream chat completion
     */
    streamChat: async (messages: GeminiMessage[], options?: GeminiChatOptions) => {
      return streamGeminiChat(messages, options);
    },

    /**
     * Non-streaming chat completion
     */
    chat: async (messages: GeminiMessage[], options?: GeminiChatOptions) => {
      return geminiChat(messages, options);
    },
  },
};

export default geminiPlugin;
