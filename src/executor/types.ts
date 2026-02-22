/**
 * Executor types for SAR capability boundary.
 */

export interface ToolFilter {
  /** When set, only return tools whose names are in this list. */
  only?: string[];
}

/**
 * Minimal context needed to execute a tool (build ToolContext for api.tools).
 * ChainContext extends this so Executor can accept ChainContext.
 */
export interface ExecutorContext {
  conversationId?: string;
  metadata?: Record<string, unknown>;
}
