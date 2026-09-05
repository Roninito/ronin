/**
 * Tool System Types
 * 
 * Core type definitions for the Ronin Hybrid Intelligence Architecture
 */

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  /** Element schema for `type: "array"` parameters. */
  items?: JSONSchema;
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
  // Optional: tools registered through the generic @ronin/sar Executor (whose
  // SARToolDefinition doesn't carry these) come through without them. Consumers
  // already treat both as safely absent (ToolRouter.ts's `if (tool.cacheable)`,
  // and risk-level display falls back to "unknown").
  riskLevel?: 'low' | 'medium' | 'high';
  cacheable?: boolean;
  ttl?: number;
  
  // For agent-based tools
  agentId?: string;
}

// A handler only needs to return `success`/`data`/`error` plus whatever metadata it
// actually has (often none) — ToolRouter.execute() always fills in toolName/provider/
// duration/cached/timestamp/callId itself afterward (see ToolRouter.ts), so requiring
// a handler to pre-populate those would be describing the router's job, not the
// handler's. This also keeps ToolHandler structurally compatible with the generic
// @ronin/sar Executor's SARToolResult, whose `metadata` is optional and narrower.
export type ToolHandler = (
  args: any,
  context: ToolContext
) => Promise<Omit<ToolResult, "metadata"> & { metadata?: Partial<ToolResultMetadata> }>;

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
  // Index signature: keeps this structurally assignable to @ronin/sar's generic
  // SARToolResult['metadata'] (also an index-signature bag), and lets handlers stash
  // arbitrary extra fields alongside the guaranteed ones below.
  [key: string]: unknown;
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

// Analytics event types (opt-in protocol for agent telemetry)

export interface DutyLifecycleEvent {
  agent: string;
  status: "started" | "stopped" | "error";
  timestamp: number;
  meta?: Record<string, unknown>;
}

export interface DutyTaskStartedEvent {
  agent: string;
  taskId: string;
  taskName: string;
  timestamp: number;
}

export interface DutyTaskProgressEvent {
  agent: string;
  taskId: string;
  progress: number;
  message?: string;
  timestamp: number;
}

export interface DutyTaskCompletedEvent {
  agent: string;
  taskId: string;
  duration: number;
  result?: string;
  timestamp: number;
}

export interface DutyTaskFailedEvent {
  agent: string;
  taskId: string;
  duration: number;
  error: string;
  timestamp: number;
}

export interface DutyMetricEvent {
  agent: string;
  metric: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
  timestamp: number;
}

// AI layer analytics event types

export interface AICompletionEvent {
  type: "complete" | "chat";
  model: string;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface AIStreamEvent {
  type: "stream" | "streamChat";
  model: string;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface AIToolCallEvent {
  model: string;
  duration: number;
  success: boolean;
  toolCount: number;
  error?: string;
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
  /** Override the adapter's configured default model for this call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  system?: string;
  tools?: OpenAIFunctionSchema[];
}
