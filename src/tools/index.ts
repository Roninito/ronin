/**
 * Ronin Hybrid Intelligence - Tool System
 * 
 * Export all tool system components for easy importing
 */

// Core components
export { ToolRouter } from "./ToolRouter.js";
export { WorkflowEngine } from "./WorkflowEngine.js";
export { initializeTools, getToolsAPI } from "../api/tools.js";

// Adapters
export { CloudAdapter, type CloudAdapterConfig } from "./adapters/CloudAdapter.js";
export { OpenAIAdapter } from "./adapters/OpenAIAdapter.js";
export { AnthropicAdapter } from "./adapters/AnthropicAdapter.js";
export { GeminiAdapter } from "./adapters/GeminiAdapter.js";
export { OllamaCloudAdapter } from "./adapters/OllamaCloudAdapter.js";

// Local tools
export { registerLocalTools } from "./providers/LocalTools.js";

// Types
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
  ToolHandler,
  ToolPolicy,
  ToolPolicyRule,
  ValidationResult,
  WorkflowDefinition,
  WorkflowStep,
  JSONSchema,
  OpenAIFunctionSchema,
  CloudFeature,
  CloudResult,
  ExecutionOptions,
  ToolCalledEvent,
  ToolCompletedEvent,
  ToolPolicyViolationEvent,
  AgentLifecycleEvent,
  AgentTaskStartedEvent,
  AgentTaskProgressEvent,
  AgentTaskCompletedEvent,
  AgentTaskFailedEvent,
  AgentMetricEvent,
  AICompletionEvent,
  AIStreamEvent,
  AIToolCallEvent,
} from "./types.js";

// Version
export const TOOL_SYSTEM_VERSION = "1.1.0";
