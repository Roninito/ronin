/**
 * Tool System Types
 * 
 * Core type definitions for the Ronin Hybrid Intelligence Architecture
 */

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: (string | number)[];
  default?: any;
  description?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  provider: string;
  handler: ToolHandler;
  
  // Metadata
  cost?: {
    estimate: (args: any) => number;
    actual?: (result: ToolResult) => number | undefined;
  };
  riskLevel: 'low' | 'medium' | 'high';
  cacheable: boolean;
  ttl?: number;
  
  // For agent-based tools
  agentId?: string;
}

export type ToolHandler = (args: any, context: ToolContext) => Promise<ToolResult>;

export interface ToolContext {
  conversationId: string;
  userId?: string;
  originalQuery?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
  id: string;
  timestamp: number;
  conversationId: string;
}

export interface ToolResult {
  success: boolean;
  data: any;
  metadata: ToolResultMetadata;
  error?: string;
}

export interface ToolResultMetadata {
  toolName: string;
  provider: string;
  duration: number;
  cost?: number;
  cached: boolean;
  timestamp: number;
  callId: string;
}

export interface ToolPolicy {
  maxMonthlyCost?: number;
  maxDailyCost?: number;
  maxPerToolCost?: number;
  maxTotalCost?: number;
  tools: Record<string, ToolPolicyRule>;
  escalation?: {
    lowConfidenceThreshold: number;
    fallbackTool: string;
  };
}

export interface ToolPolicyRule {
  requireConfirmation?: boolean | ((cost: number) => boolean);
  maxCallsPerHour?: number;
  maxCallsPerDay?: number;
  allowedContexts?: string[];
  disabled?: boolean;
  maxCost?: number;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  estimatedCost?: number;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  steps: WorkflowStep[];
  variables?: Record<string, any>;
}

export interface WorkflowStep {
  id: string;
  tool: string;
  input: Record<string, any>;
  output?: string;
  condition?: string;
}

// OpenAI-compatible function schema for Ollama
export interface OpenAIFunctionSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

// Event types
export interface ToolCalledEvent {
  toolName: string;
  arguments: any;
  estimatedCost?: number;
  conversationId: string;
  timestamp: number;
}

export interface ToolCompletedEvent {
  toolName: string;
  success: boolean;
  cost?: number;
  duration: number;
  cached: boolean;
  data?: any;
  error?: string;
  conversationId: string;
  timestamp: number;
}

export interface ToolPolicyViolationEvent {
  toolName: string;
  reason: string;
  estimatedCost?: number;
  conversationId: string;
  timestamp: number;
}

// Cloud adapter types
export type CloudFeature = 
  | 'vision' 
  | 'image-generation' 
  | 'tts' 
  | 'stt' 
  | 'function-calling'
  | 'streaming'
  | 'reasoning'
  | 'code-generation';

export interface CloudResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost?: number;
  model: string;
  raw?: any;
}

export interface ExecutionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  system?: string;
  tools?: OpenAIFunctionSchema[];
}
