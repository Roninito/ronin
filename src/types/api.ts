/**
 * AI completion options
 */
export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/**
 * Chat message
 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Chat options
 */
export interface ChatOptions extends CompletionOptions {
  messages: Message[];
}

/**
 * Tool/Function definition for Ollama function calling
 */
export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, {
        type: string;
        description?: string;
      }>;
      required?: string[];
    };
  };
}

/**
 * Tool call result from Ollama
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool calling options
 */
export interface ToolCallOptions extends CompletionOptions {
  tools: Tool[];
}

/**
 * Memory entry
 */
export interface Memory {
  id: string;
  key?: string;
  value: unknown;
  text?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * HTTP request options
 */
export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Database transaction interface
 */
export interface Transaction {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/**
 * Main API interface provided to agents
 */
export interface AgentAPI {
  /**
   * AI operations via Ollama
   */
  ai: {
    complete(prompt: string, options?: CompletionOptions): Promise<string>;
    stream(prompt: string, options?: CompletionOptions): AsyncIterable<string>;
    chat(messages: Message[], options?: Omit<ChatOptions, "messages">): Promise<Message>;
    callTools(
      prompt: string,
      tools: Tool[],
      options?: CompletionOptions
    ): Promise<{ message: Message; toolCalls: ToolCall[] }>;
  };

  /**
   * Memory/Context operations
   */
  memory: {
    store(key: string, value: unknown): Promise<void>;
    retrieve(key: string): Promise<unknown>;
    search(query: string, limit?: number): Promise<Memory[]>;
    addContext(text: string, metadata?: Record<string, unknown>): Promise<string>;
    getRecent(limit?: number): Promise<Memory[]>;
    getByMetadata(metadata: Record<string, unknown>): Promise<Memory[]>;
  };

  /**
   * File operations
   */
  files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    watch(pattern: string, callback: (path: string, event: string) => void): void;
    list(dir: string, pattern?: string): Promise<string[]>;
  };

  /**
   * Database operations
   */
  db: {
    query<T>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
    transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  };

  /**
   * HTTP operations
   */
  http: {
    get(url: string, options?: RequestOptions): Promise<Response>;
    post(url: string, data: unknown, options?: RequestOptions): Promise<Response>;
    serve(handler: (req: Request) => Response | Promise<Response>): void;
  };

  /**
   * Event system for inter-agent communication
   */
  events: {
    emit(event: string, data: unknown): void;
    on(event: string, handler: (data: unknown) => void): void;
    off(event: string, handler: (data: unknown) => void): void;
  };

  /**
   * Plugin system
   */
  plugins: {
    call(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>;
  };
}

