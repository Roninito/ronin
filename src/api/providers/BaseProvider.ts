/**
 * BaseProvider — Abstract base class for all AI providers
 * Provides common HTTP utilities and error handling
 */

import type {
  CompletionOptions,
  Message,
  ChatOptions,
  Tool,
  ToolCall,
} from "../../types/api.js";

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

// ─── Shared Helpers ────────────────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  } = {},
): Promise<Response> {
  const timeout = options.timeout ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export class APIError extends Error {
  constructor(
    public code: string,
    public statusCode?: number,
    public details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "APIError";
  }
}

/**
 * Base class for AI provider implementations
 * Provides common patterns and error handling
 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly name: string;
  protected baseUrl: string;
  protected apiKey?: string;
  protected timeout: number = 30000;

  constructor(config: { baseUrl?: string; apiKey?: string; timeout?: number }) {
    this.baseUrl = config.baseUrl || "";
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  abstract complete(prompt: string, options?: CompletionOptions): Promise<string>;
  abstract chat(messages: Message[], options?: Omit<ChatOptions, "messages">): Promise<Message>;
  abstract stream(prompt: string, options?: CompletionOptions): AsyncIterable<string>;
  abstract streamChat(messages: Message[], options?: Omit<ChatOptions, "messages">): AsyncIterable<string>;
  abstract callTools(
    prompt: string,
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<{ message: Message; toolCalls: ToolCall[] }>;
  abstract checkModel(model?: string): Promise<boolean>;

  /**
   * Make authenticated HTTP request
   */
  protected async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetchWithTimeout(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      timeout: this.timeout,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(
        `HTTP ${response.status}`,
        response.status,
        { error, url },
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Stream HTTP response
   */
  protected async *streamRequest(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): AsyncIterable<string> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetchWithTimeout(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      timeout: this.timeout,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(
        `HTTP ${response.status}`,
        response.status,
        { error, url },
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new APIError("NO_RESPONSE_BODY");

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
}
