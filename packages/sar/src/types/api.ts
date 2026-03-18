/**
 * Minimal AgentAPI interface required by @ronin/sar.
 * The host application's full AgentAPI must structurally satisfy this interface.
 */

/** Completion options passed to ai.callTools */
export interface SARCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  timeoutMs?: number;
  thinking?: boolean;
  retries?: number;
  useLocalProvider?: boolean;
}

/** Chat message as used by the AI provider */
export interface SARMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A single tool call returned by the AI */
export interface SARToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Minimal API surface required by the SAR chain. */
export interface SARAgentAPI {
  ai: {
    callTools(
      prompt: string,
      tools: SARTool[],
      options?: SARCompletionOptions
    ): Promise<{ message: SARMessage; toolCalls: SARToolCall[] }>;
  };
  memory: {
    store(key: string, value: unknown): Promise<void>;
    retrieve(key: string): Promise<unknown>;
  };
  tools: {
    register(tool: import("./tools.js").SARToolDefinition): void;
    execute(
      name: string,
      args: Record<string, any>,
      context?: Partial<import("./tools.js").SARToolContext>
    ): Promise<import("./tools.js").SARToolResult>;
    getSchemas(): import("./tools.js").OpenAIFunctionSchema[];
  };
}

/** Tool definition as expected by ai.callTools */
export interface SARTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
}
