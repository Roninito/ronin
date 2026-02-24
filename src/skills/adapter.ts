/**
 * Skill Adapter — Phase 7
 *
 * Bridges Task Engine to SAR Chain execution
 * Delegates "run" phase actions to SAR for skill execution
 *
 * Converts:
 *   TaskContext → ChainContext
 *   Skill invocation → SAR Chain execution
 *   Results → Task variables
 */

import type { AgentAPI } from "../types/index.js";
import type { Chain } from "../chain/index.js";
import { useMiddlewareStack } from "../chains/templates.js";
import type { ChainContext } from "../chain/types.js";
import type { TaskContext } from "./types.js";

/**
 * Skill Adapter — delegates task execution to SAR Chain
 */
export class SkillAdapter {
  constructor(private api: AgentAPI) {}

  /**
   * Execute a skill via SAR Chain
   * Creates minimal ChainContext, runs executor, captures result
   */
  async executeSkill(
    skillName: string,
    input: Record<string, unknown>,
    taskContext: TaskContext
  ): Promise<unknown> {
    // Validate skill exists
    const tools = this.api.tools?.getSchemas() || [];
    const skillTool = tools.find(
      (t) => t.type === "function" && t.function?.name === skillName
    );

    if (!skillTool) {
      throw new Error(`Skill '${skillName}' not registered`);
    }

    // Create minimal ChainContext
    const chainContext: ChainContext = {
      conversationId: taskContext.taskId,
      messages: [
        {
          role: "user",
          content: `Execute skill '${skillName}' with input: ${JSON.stringify(input)}`,
        },
      ],
      metadata: {
        taskId: taskContext.taskId,
        phase: taskContext.currentPhase,
        variables: taskContext.variables,
      },
    };

    // Use standardSAR template for execution
    const chain = useMiddlewareStack("standardSAR", this.api, chainContext);

    // Execute skill via chain
    const result = await chain.run([
      {
        role: "assistant",
        content: `Executing ${skillName}...`,
      },
    ]);

    // Tool call if skill execution needs explicit invocation
    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const toolCall of result.toolCalls) {
        if (toolCall.name === skillName) {
          return await this.api.tools?.execute?.(
            skillName,
            toolCall.arguments as Record<string, unknown>,
            {
              conversationId: taskContext.taskId,
              metadata: chainContext.metadata,
            }
          );
        }
      }
    }

    // Otherwise return chain result as skill output
    return result;
  }

  /**
   * Validate skill exists before execution
   */
  validateSkillExists(skillName: string): boolean {
    const tools = this.api.tools?.getSchemas() || [];
    return tools.some(
      (t) => t.type === "function" && t.function?.name === skillName
    );
  }

  /**
   * Get skill metadata (parameters, description)
   */
  getSkillMetadata(
    skillName: string
  ): { name: string; description: string; parameters: unknown } | null {
    const tools = this.api.tools?.getSchemas() || [];
    const skillTool = tools.find(
      (t) => t.type === "function" && t.function?.name === skillName
    );

    if (!skillTool || skillTool.type !== "function" || !skillTool.function) {
      return null;
    }

    return {
      name: skillTool.function.name,
      description: skillTool.function.description || "",
      parameters: skillTool.function.parameters,
    };
  }

  /**
   * Execute skill with timeout protection
   */
  async executeSkillWithTimeout(
    skillName: string,
    input: Record<string, unknown>,
    taskContext: TaskContext,
    timeoutMs: number = 30000
  ): Promise<unknown> {
    return Promise.race([
      this.executeSkill(skillName, input, taskContext),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Skill '${skillName}' timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }
}
