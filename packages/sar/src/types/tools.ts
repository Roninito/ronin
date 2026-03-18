/**
 * Tool-related types for @ronin/sar.
 */

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
}

export interface SARToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  provider: string;
  handler: (args: any, context: SARToolContext) => Promise<SARToolResult>;
}

export interface SARToolContext {
  conversationId: string;
  userId?: string;
  originalQuery?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SARToolResult {
  success: boolean;
  data: any;
  error?: string;
  metadata?: {
    toolName: string;
    provider: string;
    duration: number;
    [key: string]: unknown;
  };
}

export interface OpenAIFunctionSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}
