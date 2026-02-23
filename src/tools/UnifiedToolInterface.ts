/**
 * UnifiedToolInterface
 * 
 * Single abstraction for tools that works with SAR, LangChain, Ontology, and any other system.
 * Eliminates tool duplication and provides consistent error handling, typing, and metadata.
 */

import type { AgentAPI } from "../types/index.js";

/**
 * Tool parameter schema (JSON Schema compatible)
 */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[] | number[];
  default?: unknown;
  properties?: Record<string, ToolParameter>;
  items?: ToolParameter;
}

/**
 * Tool metadata for discovery and documentation
 */
export interface ToolMetadata {
  name: string;
  description: string;
  category?: string; // e.g., "file", "shell", "git", "database"
  version?: string;
  author?: string;
  tags?: string[]; // e.g., ["readonly", "network", "slow"]
  examples?: string[]; // Example usage strings
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  api: AgentAPI;
  userId?: string;
  sessionId?: string;
  timeout?: number; // milliseconds
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  errorCode?: string;
  duration?: number; // milliseconds
  retried?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Unified Tool Interface - the single definition used by SAR, LangChain, Ontology, etc.
 */
export interface UnifiedTool {
  /**
   * Tool metadata
   */
  metadata: ToolMetadata;

  /**
   * Input parameters schema
   */
  parameters: ToolParameter[];

  /**
   * Output type description
   */
  outputType: string; // e.g., "string", "number", "object", "array"

  /**
   * Execute the tool
   * 
   * @param input Input parameters
   * @param context Execution context
   * @returns Tool execution result
   */
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;

  /**
   * Validate input (optional, called before execute)
   * 
   * @param input Input to validate
   * @returns Validation result
   */
  validate?(input: Record<string, unknown>): { valid: boolean; error?: string };

  /**
   * Check if tool is available (optional, for permission/capability checks)
   * 
   * @param context Execution context
   * @returns Whether tool is available
   */
  isAvailable?(context: ToolExecutionContext): boolean | Promise<boolean>;

  /**
   * Get tool usage examples (optional)
   */
  examples?: Array<{
    description: string;
    input: Record<string, unknown>;
    expectedOutput: string;
  }>;
}

/**
 * Tool registry for lookup and discovery
 */
export class UnifiedToolRegistry {
  private tools: Map<string, UnifiedTool> = new Map();

  /**
   * Register a tool
   */
  register(tool: UnifiedTool): void {
    this.tools.set(tool.metadata.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): UnifiedTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAll(): UnifiedTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Find tools by category
   */
  getByCategory(category: string): UnifiedTool[] {
    return this.getAll().filter((tool) => tool.metadata.category === category);
  }

  /**
   * Find tools by tags
   */
  getByTags(tags: string[]): UnifiedTool[] {
    return this.getAll().filter((tool) =>
      tags.some((tag) => tool.metadata.tags?.includes(tag))
    );
  }

  /**
   * Get tool names
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}

/**
 * Helper to create a unified tool with defaults
 */
export function createUnifiedTool(
  metadata: ToolMetadata,
  parameters: ToolParameter[],
  outputType: string,
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult>,
  options?: {
    validate?: (input: Record<string, unknown>) => { valid: boolean; error?: string };
    isAvailable?: (context: ToolExecutionContext) => boolean | Promise<boolean>;
    examples?: UnifiedTool["examples"];
  }
): UnifiedTool {
  return {
    metadata,
    parameters,
    outputType,
    execute,
    validate: options?.validate,
    isAvailable: options?.isAvailable,
    examples: options?.examples,
  };
}

/**
 * Adapter to convert existing ToolDefinition to UnifiedTool
 * 
 * This bridges legacy ToolDefinition format with UnifiedTool
 */
export function adaptLegacyTool(
  legacyTool: any, // ToolDefinition from src/tools/types.ts
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult>
): UnifiedTool {
  return {
    metadata: {
      name: legacyTool.name,
      description: legacyTool.description,
      category: legacyTool.category,
      version: "1.0.0",
    },
    parameters: legacyTool.parameters || [],
    outputType: legacyTool.outputType || "string",
    execute,
  };
}

/**
 * Singleton registry (global instance)
 */
let globalRegistry: UnifiedToolRegistry | null = null;

/**
 * Get global tool registry
 */
export function getToolRegistry(): UnifiedToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new UnifiedToolRegistry();
  }
  return globalRegistry;
}

/**
 * Initialize tool registry
 */
export function initializeToolRegistry(): UnifiedToolRegistry {
  globalRegistry = new UnifiedToolRegistry();
  return globalRegistry;
}
