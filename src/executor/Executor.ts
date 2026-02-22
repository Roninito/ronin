/**
 * Executor — SAR capability boundary.
 * Thin wrapper around api.tools: filter-aware describeTools and context-aware execute.
 */

import type { AgentAPI } from "../types/index.js";
import type {
  ToolDefinition,
  ToolResult,
  OpenAIFunctionSchema,
} from "../tools/types.js";
import type { ToolFilter, ExecutorContext } from "./types.js";

export class Executor {
  constructor(private api: AgentAPI) {}

  register(tool: ToolDefinition): void {
    this.api.tools.register(tool);
  }

  /**
   * Execute a tool by name; builds ToolContext from ExecutorContext and delegates to api.tools.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ExecutorContext
  ): Promise<ToolResult> {
    const fullContext = {
      conversationId: ctx.conversationId ?? "default",
      timestamp: Date.now(),
      metadata: ctx.metadata,
    };
    return this.api.tools.execute(name, input as Record<string, any>, fullContext);
  }

  /**
   * Return OpenAI-style tool schemas. When filter.only is set, restrict to those tool names.
   */
  describeTools(filter?: ToolFilter): OpenAIFunctionSchema[] {
    const schemas = this.api.tools.getSchemas();
    if (!filter?.only?.length) return schemas;
    const onlySet = new Set(filter.only);
    return schemas.filter(
      (s) => s.type === "function" && s.function && onlySet.has(s.function.name)
    );
  }
}
