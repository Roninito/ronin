/**
 * AI Provider Abstraction Layer
 *
 * Unified interface so agents can call api.ai.complete() regardless of
 * whether the backend is local Ollama, OpenAI-compatible, or Gemini.
 */

import type {
  CompletionOptions,
  Message,
  ChatOptions,
  Tool,
  ToolCall,
} from "../types/api.js";
import type { AIConfig, AIProviderType, GeminiConfig, GrokConfig } from "../config/types.js";

// ─── Provider Interface ────────────────────────────────────────────────

export interface AIProvider {
  readonly name: string;
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
  chat(messages: Message[], options?: Omit<ChatOptions, "messages">): Promise<Message>;
  stream(prompt: string, options?: CompletionOptions): AsyncIterable<string>;
  streamChat(messages: Message[], options?: Omit<ChatOptions, "messages">): AsyncIterable<string>;
  callTools(
    prompt: string,
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<{ message: Message; toolCalls: ToolCall[] }>;
  checkModel(model?: string): Promise<boolean>;
}

// ─── Shared Helpers ────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Ollama Provider ───────────────────────────────────────────────────

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private defaultModel: string;
  private defaultTimeoutMs: number;
  private defaultTemperature: number;

  constructor(baseUrl: string, defaultModel: string, timeoutMs: number, temperature: number) {
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
    this.defaultTimeoutMs = timeoutMs;
    this.defaultTemperature = temperature;
  }

  private t(o?: CompletionOptions) { return o?.timeoutMs ?? this.defaultTimeoutMs; }
  private temp(o?: CompletionOptions) { return o?.temperature ?? this.defaultTemperature; }

  async checkModel(model?: string): Promise<boolean> {
    const m = model || this.defaultModel;
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json();
      return (data.models || []).some(
        (x: { name: string }) => x.name === m || x.name.startsWith(`${m}:`),
      );
    } catch { return false; }
  }

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const model = options.model || this.defaultModel;
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, prompt, stream: false,
          options: { temperature: this.temp(options), num_predict: options.maxTokens },
        }),
      },
      this.t(options),
    );
    this.assertOk(res, model);
    const data = await res.json();
    return data.response || "";
  }

  async chat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): Promise<Message> {
    const model = options.model || this.defaultModel;
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: false,
          options: { temperature: this.temp(options), num_predict: options.maxTokens },
        }),
      },
      this.t(options),
    );
    this.assertOk(res, model);
    const data = await res.json();
    return { role: "assistant", content: data.message?.content || "" };
  }

  async *stream(prompt: string, options: CompletionOptions = {}): AsyncIterable<string> {
    const model = options.model || this.defaultModel;
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, prompt, stream: true,
          options: { temperature: this.temp(options), num_predict: options.maxTokens },
        }),
      },
      this.t(options),
    );
    this.assertOk(res, model);
    yield* this.readStream(res, this.t(options), "response");
  }

  async *streamChat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): AsyncIterable<string> {
    const model = options.model || this.defaultModel;
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: true,
          options: {
            temperature: this.temp(options),
            num_predict: options.maxTokens,
            thinking: options.thinking ?? true,
          },
        }),
      },
      this.t(options),
    );
    this.assertOk(res, model);
    const includeThinking = options.thinking !== false;
    yield* this.readStream(res, this.t(options), "chat", includeThinking);
  }

  async callTools(
    prompt: string,
    tools: Tool[],
    options: CompletionOptions = {},
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const model = options.model || this.defaultModel;

    // Try native function calling
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            tools,
            stream: false,
            options: { temperature: this.temp(options), num_predict: options.maxTokens },
          }),
        },
        this.t(options),
      );
      this.assertOk(res, model);
      const data = await res.json();

      const toolCalls: ToolCall[] = [];
      if (data.message?.tool_calls) {
        for (const tc of data.message.tool_calls) {
          try {
            const args = typeof tc.function?.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {};
            toolCalls.push({ name: tc.function?.name || "", arguments: args });
          } catch { /* skip bad args */ }
        }
      }
      if (toolCalls.length > 0 || data.message?.tool_calls) {
        return {
          message: { role: "assistant", content: data.message?.content || "" },
          toolCalls,
        };
      }
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("not found") || msg.includes("Failed to fetch")) throw err;
      console.warn("Function calling not supported, falling back to JSON mode:", err);
    }

    return this.callToolsJSONMode(prompt, tools, options);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private assertOk(res: Response, model: string): void {
    if (res.ok) return;
    if (res.status === 404) {
      throw new Error(
        `Model "${model}" not found. Please pull it first:\n   ollama pull ${model}\n\nOr use a different model with --ollama-model <model-name>`,
      );
    }
    throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
  }

  private async *readStream(
    res: Response,
    chunkTimeoutMs: number,
    mode: "response" | "chat",
    includeThinking = true,
  ): AsyncIterable<string> {
    if (!res.body) throw new Error("No response body for streaming");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const readWithTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
      Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Stream read timed out")), chunkTimeoutMs),
        ),
      ]);

    try {
      while (true) {
        const { done, value } = await readWithTimeout();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (mode === "response" && json.response) yield json.response;
            else if (mode === "chat") {
              if (json.message?.content) yield json.message.content;
              else if (includeThinking && json.message?.thinking) yield json.message.thinking;
            }
          } catch { /* skip bad json */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async callToolsJSONMode(
    prompt: string,
    tools: Tool[],
    options: CompletionOptions = {},
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const model = options.model || this.defaultModel;
    const toolDescriptions = tools
      .map(t => `- ${t.function.name}: ${t.function.description} (parameters: ${JSON.stringify(t.function.parameters)})`)
      .join("\n");

    const enhancedPrompt = `${prompt}\n\nAvailable tools:\n${toolDescriptions}\n\nRespond with a JSON object in this format:\n{\n  "message": "your response text",\n  "toolCalls": [\n    {\n      "name": "tool_name",\n      "arguments": { "args": [...] }\n    }\n  ]\n}`;

    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: enhancedPrompt,
          stream: false,
          format: "json",
          options: { temperature: this.temp(options), num_predict: options.maxTokens },
        }),
      },
      this.t(options),
    );
    this.assertOk(res, model);
    const data = await res.json();
    const responseText = data.response || "";

    try {
      let jsonText = responseText.trim();
      if (jsonText.startsWith("```json")) jsonText = jsonText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
      else if (jsonText.startsWith("```")) jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
      const jsonStart = jsonText.indexOf("{");
      const jsonEnd = jsonText.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) jsonText = jsonText.substring(jsonStart, jsonEnd + 1);

      const parsed = JSON.parse(jsonText);
      const toolCalls: ToolCall[] = (parsed.toolCalls || []).map(
        (tc: { name: string; arguments: unknown }) => ({ name: tc.name, arguments: tc.arguments || {} }),
      );
      return { message: { role: "assistant", content: parsed.message || responseText }, toolCalls };
    } catch {
      return { message: { role: "assistant", content: "" }, toolCalls: [] };
    }
  }
}

// ─── OpenAI-Compatible Provider ────────────────────────────────────────
// Works with OpenAI, Together AI, Groq, Fireworks, OpenRouter, etc.

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private defaultTimeoutMs: number;
  private defaultTemperature: number;

  constructor(
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    timeoutMs: number,
    temperature: number,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultModel = defaultModel;
    this.defaultTimeoutMs = timeoutMs;
    this.defaultTemperature = temperature;
  }

  private t(o?: CompletionOptions) { return o?.timeoutMs ?? this.defaultTimeoutMs; }
  private temp(o?: CompletionOptions) { return o?.temperature ?? this.defaultTemperature; }
  private headers() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
    };
  }

  async checkModel(model?: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/models`,
        { method: "GET", headers: this.headers() },
        10_000,
      );
      if (!res.ok) return false;
      const data = await res.json();
      const m = model || this.defaultModel;
      return (data.data || []).some((x: { id: string }) => x.id === m);
    } catch { return false; }
  }

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const result = await this.chat(
      [{ role: "user", content: prompt }],
      options,
    );
    return result.content;
  }

  async chat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): Promise<Message> {
    const model = options.model || this.defaultModel;
    const res = await fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          temperature: this.temp(options),
          max_tokens: options.maxTokens,
        }),
      },
      this.t(options),
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ""}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    return { role: "assistant", content };
  }

  async *stream(prompt: string, options: CompletionOptions = {}): AsyncIterable<string> {
    yield* this.streamChat([{ role: "user", content: prompt }], options);
  }

  async *streamChat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): AsyncIterable<string> {
    const model = options.model || this.defaultModel;
    const res = await fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          temperature: this.temp(options),
          max_tokens: options.maxTokens,
          stream: true,
        }),
      },
      this.t(options),
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ""}`);
    }
    if (!res.body) throw new Error("No response body for streaming");

    const reader = res.body.getReader();
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
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") return;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch { /* skip bad json */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async callTools(
    prompt: string,
    tools: Tool[],
    options: CompletionOptions = {},
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const model = options.model || this.defaultModel;

    const openaiTools = tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));

    const res = await fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          tools: openaiTools,
          temperature: this.temp(options),
          max_tokens: options.maxTokens,
        }),
      },
      this.t(options),
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ""}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content || "";
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls || []).map(
      (tc: { function: { name: string; arguments: string } }) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
      }),
    );
    return { message: { role: "assistant", content }, toolCalls };
  }
}

// ─── Gemini Provider ───────────────────────────────────────────────────

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private apiKey: string;
  private defaultModel: string;
  private apiVersion: string;
  private defaultTimeoutMs: number;
  private defaultTemperature: number;

  constructor(config: GeminiConfig, timeoutMs: number, temperature: number) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.model;
    this.apiVersion = config.apiVersion || "v1beta";
    this.defaultTimeoutMs = timeoutMs;
    this.defaultTemperature = temperature;
  }

  private t(o?: CompletionOptions) { return o?.timeoutMs ?? this.defaultTimeoutMs; }
  private temp(o?: CompletionOptions) { return o?.temperature ?? this.defaultTemperature; }
  private url(model: string, method: string) {
    return `https://generativelanguage.googleapis.com/${this.apiVersion}/models/${model}:${method}?key=${this.apiKey}`;
  }

  async checkModel(_model?: string): Promise<boolean> {
    return !!this.apiKey;
  }

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const result = await this.chat([{ role: "user", content: prompt }], options);
    return result.content;
  }

  async chat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): Promise<Message> {
    const model = options.model || this.defaultModel;
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const res = await fetchWithTimeout(
      this.url(model, "generateContent"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: this.temp(options),
            maxOutputTokens: options.maxTokens,
          },
        }),
      },
      this.t(options),
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error: ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ""}`);
    }
    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { role: "assistant", content };
  }

  async *stream(prompt: string, options: CompletionOptions = {}): AsyncIterable<string> {
    yield* this.streamChat([{ role: "user", content: prompt }], options);
  }

  async *streamChat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): AsyncIterable<string> {
    const model = options.model || this.defaultModel;
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const res = await fetchWithTimeout(
      this.url(model, "streamGenerateContent") + "&alt=sse",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: this.temp(options),
            maxOutputTokens: options.maxTokens,
          },
        }),
      },
      this.t(options),
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error: ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ""}`);
    }
    if (!res.body) throw new Error("No response body for streaming");

    const reader = res.body.getReader();
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
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(trimmed.slice(6));
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield text;
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async callTools(
    prompt: string,
    tools: Tool[],
    options: CompletionOptions = {},
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const model = options.model || this.defaultModel;

    const geminiTools = [{
      functionDeclarations: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }];

    const res = await fetchWithTimeout(
      this.url(model, "generateContent"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: geminiTools,
          generationConfig: {
            temperature: this.temp(options),
            maxOutputTokens: options.maxTokens,
          },
        }),
      },
      this.t(options),
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error: ${res.status} ${res.statusText}${errText ? ` - ${errText}` : ""}`);
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const content = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");
    const toolCalls: ToolCall[] = parts
      .filter((p: any) => p.functionCall)
      .map((p: any) => ({ name: p.functionCall.name, arguments: p.functionCall.args || {} }));

    return { message: { role: "assistant", content }, toolCalls };
  }
}

// ─── Grok Provider (OpenAI-compatible via xAI API) ─────────────────────

export function createGrokProvider(
  grokConfig: GrokConfig,
  timeoutMs: number,
  temperature: number,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(
    grokConfig.apiKey,
    "https://api.x.ai/v1",
    "grok-3",
    timeoutMs,
    temperature,
  );
}

// ─── Factory ───────────────────────────────────────────────────────────

export function createProvider(
  providerType: AIProviderType,
  aiConfig: AIConfig,
  geminiConfig?: GeminiConfig,
  grokConfig?: GrokConfig,
): AIProvider {
  const timeout = aiConfig.ollamaTimeoutMs;
  const temp = aiConfig.temperature;

  switch (providerType) {
    case "ollama":
      return new OllamaProvider(aiConfig.ollamaUrl, aiConfig.ollamaModel, timeout, temp);
    case "openai":
      return new OpenAICompatibleProvider(
        aiConfig.openai.apiKey, aiConfig.openai.baseUrl, aiConfig.openai.model, timeout, temp,
      );
    case "gemini":
      if (!geminiConfig?.apiKey) throw new Error("Gemini API key not configured. Set gemini.apiKey in config or GEMINI_API_KEY env var.");
      return new GeminiProvider(geminiConfig, timeout, temp);
    case "grok":
      if (!grokConfig?.apiKey) throw new Error("Grok API key not configured. Set grok.apiKey in config or GROK_API_KEY env var.");
      return createGrokProvider(grokConfig, timeout, temp);
    default:
      throw new Error(`Unknown AI provider: ${providerType}`);
  }
}
