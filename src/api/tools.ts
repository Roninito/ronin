/**
 * Tools API
 * 
 * Exposes the tool system to agents via api.tools.*
 */

import type { AgentAPI } from "../types/index.js";
import { ToolRouter } from "./ToolRouter.js";
import { WorkflowEngine } from "./WorkflowEngine.js";
import { registerLocalTools } from "./providers/LocalTools.js";
import type { 
  ToolDefinition, 
  ToolCall, 
  ToolContext, 
  ToolResult,
  ToolPolicy,
  WorkflowDefinition,
  OpenAIFunctionSchema,
} from "./types.js";

// Singleton instances
let toolRouter: ToolRouter | null = null;
let workflowEngine: WorkflowEngine | null = null;

/**
 * Initialize the tools system
 */
export function initializeTools(api: AgentAPI): void {
  if (toolRouter) {
    console.log("[ToolsAPI] Already initialized");
    return;
  }

  console.log("[ToolsAPI] Initializing tool system...");

  // Create router
  toolRouter = new ToolRouter(api);

  // Create workflow engine
  workflowEngine = new WorkflowEngine(toolRouter);

  // Register local tools
  registerLocalTools(api, (tool) => toolRouter!.register(tool));

  console.log("[ToolsAPI] Tool system initialized");
}

/**
 * Get the tools API surface
 */
export function getToolsAPI(api: AgentAPI) {
  if (!toolRouter) {
    initializeTools(api);
  }

  return {
    /**
     * Register a tool
     */
    register(tool: ToolDefinition): void {
      toolRouter!.register(tool);
    },

    /**
     * Unregister a tool
     */
    unregister(toolName: string): void {
      toolRouter!.unregister(toolName);
    },

    /**
     * Execute a tool
     */
    async execute(name: string, args: Record<string, any>, context?: Partial<ToolContext>): Promise<ToolResult> {
      const call: ToolCall = {
        name,
        arguments: args,
        id: `call-${Date.now()}`,
        timestamp: Date.now(),
        conversationId: context?.conversationId || 'default',
      };

      const fullContext: ToolContext = {
        conversationId: context?.conversationId || 'default',
        userId: context?.userId,
        originalQuery: context?.originalQuery,
        timestamp: Date.now(),
        metadata: context?.metadata,
      };

      return toolRouter!.execute(call, fullContext);
    },

    /**
     * List all available tools
     */
    list(): ToolDefinition[] {
      return toolRouter!.listTools();
    },

    /**
     * Get tool schemas for Ollama
     */
    getSchemas(): OpenAIFunctionSchema[] {
      return toolRouter!.getToolSchemas();
    },

    /**
     * Check if a tool exists
     */
    has(name: string): boolean {
      return toolRouter!.hasTool(name);
    },

    /**
     * Register a workflow
     */
    registerWorkflow(workflow: WorkflowDefinition): void {
      workflowEngine!.registerWorkflow(workflow);
    },

    /**
     * Execute a workflow
     */
    async executeWorkflow(name: string, args: Record<string, any>, context?: Partial<ToolContext>): Promise<any> {
      const fullContext: ToolContext = {
        conversationId: context?.conversationId || 'default',
        userId: context?.userId,
        originalQuery: context?.originalQuery,
        timestamp: Date.now(),
        metadata: context?.metadata,
      };

      return workflowEngine!.executeWorkflow(name, args, fullContext);
    },

    /**
     * Get workflow definition
     */
    getWorkflow(name: string): WorkflowDefinition | undefined {
      return workflowEngine!.getWorkflow(name);
    },

    /**
     * List all workflows
     */
    listWorkflows(): WorkflowDefinition[] {
      return workflowEngine!.listWorkflows();
    },

    /**
     * Set tool policy
     */
    setPolicy(policy: ToolPolicy): void {
      toolRouter!.setPolicy(policy);
    },

    /**
     * Get current policy
     */
    getPolicy(): ToolPolicy {
      return toolRouter!.getPolicy();
    },

    /**
     * Get cost statistics
     */
    getCostStats(): { daily: number; monthly: number } {
      return toolRouter!.getCostStats();
    },
  };
}

// Export types
export type { ToolDefinition, ToolCall, ToolResult, ToolContext, WorkflowDefinition } from "./types.js";
export { ToolRouter } from "./ToolRouter.js";
export { WorkflowEngine } from "./WorkflowEngine.js";
export { CloudAdapter } from "./adapters/CloudAdapter.js";
export { OpenAIAdapter } from "./adapters/OpenAIAdapter.js";
