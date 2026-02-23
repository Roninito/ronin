import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import type { ChainContext } from "../src/chain/types.js";
import {
  createChainLoggingMiddleware,
  createOntologyResolveMiddleware,
  createOntologyInjectMiddleware,
  createSmartTrimMiddleware,
  createTokenGuardMiddleware,
  createAiToolMiddleware,
} from "../src/middleware/index.js";

const SOURCE = "tool-calling";

/**
 * Tool Calling Agent - SAR Chain Implementation
 *
 * Demonstrates how to use SAR (Search-Answer-Refine) chains for intelligent tool calling.
 * The AI decides which tools to use based on the request, rather than hardcoding tool calls.
 *
 * What this agent does:
 * 1. Builds middleware stack for SAR chain execution
 * 2. Defines system prompt telling AI which tools are available
 * 3. Lets AI decide which tools to call for each request
 * 4. Executes tool calls returned by the AI
 * 5. Stores results in memory for future reference
 * 6. Demonstrates multi-step operations with context preservation
 */
export default class ToolCallingAgent extends BaseAgent {
  static schedule = "0 * * * *";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    console.log("🤖 Tool Calling Agent executing with SAR chains...");

    try {
      // Example 1: Check git status using SAR chain
      await this.runSARChain(
        "Check the git status and tell me if there are any uncommitted changes",
        "git-status-check"
      );

      // Example 2: Multi-step operation - get directory and list files
      await this.runSARChain(
        "Get the current working directory and list all files in it, then tell me what you found",
        "directory-listing"
      );

      console.log("✅ Tool Calling Agent completed");
    } catch (error) {
      console.error("❌ Error in tool calling agent:", error);
    }
  }

  /**
   * Execute a request using SAR chain
   */
  private async runSARChain(
    userRequest: string,
    operationId: string
  ): Promise<void> {
    console.log(`\n📋 Starting SAR chain: ${operationId}`);
    console.log(`   Request: "${userRequest}"`);

    const systemPrompt = `You are the Tool Calling Assistant. You have access to various tools and should intelligently decide which ones to use based on user requests.

**Available Tools:**
- local.shell.safe - Run safe shell commands (git, ls, cat, etc.)
- local.file.read - Read file contents
- local.file.list - List directory contents
- local.http.request - Make HTTP requests
- local.memory.search - Search stored context
- skills.run - Execute available agent skills

**Instructions:**
1. Understand the user's request
2. Decide which tools are needed to fulfill it
3. Call the tools with appropriate parameters
4. Return a clear summary of what you found

Keep responses concise and focused on the actual results.`;

    // Build middleware stack (same pattern as messenger agent)
    this.use(createChainLoggingMiddleware(SOURCE));
    this.use(createOntologyResolveMiddleware({ api: this.api }));
    this.use(createOntologyInjectMiddleware());
    this.use(createSmartTrimMiddleware({ recentCount: 16 }));
    this.use(createTokenGuardMiddleware());
    this.use(
      createAiToolMiddleware(this.api, {
        logLabel: SOURCE,
      })
    );

    const ctx: ChainContext = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userRequest },
      ],
      ontology: {
        domain: "tool-calling",
        relevantSkills: [],
      },
      budget: {
        max: 8192,
        current: 0,
        reservedForResponse: 512,
      },
      conversationId: `tool-calling-${operationId}-${Date.now()}`,
      metadata: { maxToolIterations: 4 },
    };

    try {
      const chain = this.createChain(SOURCE);
      chain.withContext(ctx);
      await chain.run();

      // Extract and store result
      const lastMessage = ctx.messages[ctx.messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        console.log("📝 SAR Chain Result:", lastMessage.content);

        // Store result in memory
        await this.api.memory.store(
          `tool_call_result_${operationId}`,
          {
            timestamp: Date.now(),
            request: userRequest,
            result: lastMessage.content,
          }
        );
      }
    } catch (error) {
      console.error(`❌ SAR chain failed for ${operationId}:`, error);
    }
  }
}
