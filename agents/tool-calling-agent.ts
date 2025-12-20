import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

/**
 * Example agent demonstrating tool calling with plugins
 */
export default class ToolCallingAgent extends BaseAgent {
  // Schedule: Run every hour
  static schedule = "0 * * * *";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    console.log("🤖 Tool Calling Agent executing...");

    try {
      // Example 1: Use AI with tool calling to check git status
      const prompt1 =
        "Check the git status and tell me if there are any uncommitted changes";
      const { toolCalls: toolCalls1, message: message1 } =
        await this.api.ai.callTools(prompt1, []);

      console.log("AI Response:", message1.content);

      // Execute tool calls
      for (const toolCall of toolCalls1) {
        const [pluginName, methodName] = toolCall.name.split("_");
        console.log(`🔧 Executing tool: ${toolCall.name}`);

        try {
          const result = await this.api.plugins.call(
            pluginName,
            methodName,
            ...(toolCall.arguments.args || [])
          );
          console.log(`✅ Tool result:`, result);

          // Store result in memory
          await this.api.memory.store(
            `tool_call_${toolCall.name}_${Date.now()}`,
            result
          );
        } catch (error) {
          console.error(`❌ Tool ${toolCall.name} failed:`, error);
        }
      }

      // Example 2: Multi-step tool calling with follow-up
      const prompt2 =
        "Get the current working directory and list the files in it";
      const { toolCalls: toolCalls2 } = await this.api.ai.callTools(
        prompt2,
        []
      );

      const toolResults: Array<{ tool: string; result: unknown }> = [];
      for (const toolCall of toolCalls2) {
        const [pluginName, methodName] = toolCall.name.split("_");
        try {
          const result = await this.api.plugins.call(
            pluginName,
            methodName,
            ...(toolCall.arguments.args || [])
          );
          toolResults.push({ tool: toolCall.name, result });
        } catch (error) {
          console.error(`Tool ${toolCall.name} failed:`, error);
        }
      }

      // Continue conversation with tool results
      if (toolResults.length > 0) {
        const followUp = await this.api.ai.chat([
          {
            role: "user",
            content: prompt2,
          },
          {
            role: "assistant",
            content: `Tool results: ${JSON.stringify(toolResults)}`,
          },
          {
            role: "user",
            content: "Summarize what you found",
          },
        ]);

        console.log("📝 Follow-up response:", followUp.content);
      }

      console.log("✅ Tool Calling Agent completed");
    } catch (error) {
      console.error("❌ Error in tool calling agent:", error);
    }
  }
}

