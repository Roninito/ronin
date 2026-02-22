import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { toolChat } from "../src/tools/ToolChat.js";
import { getRoninContext, buildSystemPrompt } from "../src/utils/prompt.js";

/**
 * Tool Orchestrator Agent
 * 
 * Demonstrates the complete Hybrid Intelligence system.
 * This agent acts as a smart router that:
 * 1. Understands user intent
 * 2. Decides which tools to use
 * 3. Orchestrates local and cloud tools
 * 4. Assembles final responses
 * 
 * This is the "Local Orchestrator" from the architecture document.
 */
export default class ToolOrchestratorAgent extends BaseAgent {
  private conversationHistory: Map<string, Array<any>> = new Map();
  private maxHistoryPerConversation = 20;

  constructor(api: AgentAPI) {
    super(api);
    console.log("[tool-orchestrator] Tool Orchestrator Agent initialized");
    console.log("[tool-orchestrator] Available tools:", this.api.tools.list().map(t => t.name).join(", "));
  }

  /**
   * Main execution - handles incoming requests
   */
  async execute(): Promise<void> {
    console.log("[tool-orchestrator] Agent is running and ready");
    console.log("[tool-orchestrator] Use the /api/tool-orchestrator endpoint or send events");
  }

  /**
   * Handle user query with tool orchestration
   */
  async handleQuery(
    query: string,
    conversationId: string = "default"
  ): Promise<{
    response: string;
    toolsUsed: string[];
    cost: number;
    duration: number;
  }> {
    const startTime = Date.now();
    
    console.log(`[tool-orchestrator] Handling query: "${query.substring(0, 50)}..."`);

    // Get or create conversation history
    let history = this.conversationHistory.get(conversationId) || [];
    
    // Add user message
    history.push({ role: "user", content: query });
    
    // Trim history if too long
    if (history.length > this.maxHistoryPerConversation) {
      history = history.slice(-this.maxHistoryPerConversation);
    }

    // Determine which tools to use based on query intent
    const toolStrategy = this.determineToolStrategy(query);
    console.log(`[tool-orchestrator] Strategy: ${toolStrategy.strategy}, Tools: ${toolStrategy.tools.join(", ")}`);

    const context = await getRoninContext(this.api);
    const strategySection = this.buildStrategySection(toolStrategy);
    const systemPrompt = buildSystemPrompt(context, {
      includeRouteList: false,
      ontologyHint: context.hasOntology,
      sections: [strategySection],
    });

    // Execute tool-enabled chat
    const result = await toolChat(
      this.api,
      history,
      {
        model: this.api.config.getAI().ollamaModel,
        temperature: 0.7,
        maxTokens: 2000,
        maxToolIterations: toolStrategy.maxIterations,
        systemPrompt,
        enableTools: true,
        toolFilter: toolStrategy.tools,
      }
    );

    // Update history
    history.push({ role: "assistant", content: result.response });
    this.conversationHistory.set(conversationId, history);

    const duration = Date.now() - startTime;
    
    console.log(`[tool-orchestrator] Completed in ${duration}ms, cost: $${result.cost.toFixed(4)}`);

    return {
      response: result.response,
      toolsUsed: result.toolCalls.map(tc => tc.name),
      cost: result.cost,
      duration,
    };
  }

  /**
   * Determine the best tool strategy for a query
   */
  private determineToolStrategy(query: string): {
    strategy: string;
    tools: string[];
    maxIterations: number;
  } {
    const lowerQuery = query.toLowerCase();

    // Research queries
    if (lowerQuery.match(/research|find|search|look up|information about|latest|news/)) {
      return {
        strategy: "research",
        tools: ["cloud.research", "local.memory.search", "local.http.request"],
        maxIterations: 3,
      };
    }

    // Code analysis
    if (lowerQuery.match(/code|analyze|review|bug|debug|function|class/)) {
      return {
        strategy: "code-analysis",
        tools: ["local.file.read", "local.shell.safe", "local.reasoning", "cloud.reasoning"],
        maxIterations: 5,
      };
    }

    // File operations
    if (lowerQuery.match(/file|read|write|list|directory|folder/)) {
      return {
        strategy: "file-ops",
        tools: ["local.file.read", "local.file.list", "local.file.write"],
        maxIterations: 2,
      };
    }

    // Memory/recall
    if (lowerQuery.match(/remember|recall|previous|past|before|earlier/)) {
      return {
        strategy: "memory",
        tools: ["local.memory.search"],
        maxIterations: 2,
      };
    }

    // Content creation
    if (lowerQuery.match(/create|generate|write|draft|compose/)) {
      return {
        strategy: "creation",
        tools: ["cloud.research", "local.reasoning", "cloud.image.generate", "cloud.reasoning"],
        maxIterations: 4,
      };
    }

    // Data analysis
    if (lowerQuery.match(/analyze|data|chart|graph|statistics|numbers/)) {
      return {
        strategy: "data-analysis",
        tools: ["local.http.request", "local.reasoning", "cloud.reasoning", "cloud.image.generate"],
        maxIterations: 4,
      };
    }

    // Default: general reasoning
    return {
      strategy: "general",
      tools: ["local.reasoning", "local.memory.search"],
      maxIterations: 2,
    };
  }

  /**
   * Build strategy-specific section for system prompt (appended to shared Ronin context).
   */
  private buildStrategySection(strategy: { strategy: string; tools: string[] }): string {
    const base = `Available tools for this request:
${strategy.tools.map(t => `- ${t}`).join("\n")}

Guidelines:
1. Use tools when they help answer the user's request
2. Be concise but thorough
3. If a tool fails, try an alternative or explain the limitation
4. Always cite sources when using research tools
5. For code tasks, show specific examples`;

    switch (strategy.strategy) {
      case "research":
        return base + `

Research Guidelines:
- Search for up-to-date information
- Synthesize findings from multiple sources
- Provide citations and links when available
- Summarize key points clearly`;

      case "code-analysis":
        return base + `

Code Analysis Guidelines:
- Read relevant files before analyzing
- Check for common bugs and security issues
- Suggest specific improvements with examples
- Consider performance implications`;

      case "creation":
        return base + `

Content Creation Guidelines:
- Research the topic thoroughly first
- Create structured, well-organized content
- Use appropriate formatting
- Include visuals when helpful`;

      default:
        return base;
    }
  }

  /**
   * Execute a specific workflow
   */
  async runWorkflow(
    workflowName: string,
    args: Record<string, any>,
    conversationId: string = "default"
  ): Promise<any> {
    console.log(`[tool-orchestrator] Running workflow: ${workflowName}`);
    
    const startTime = Date.now();
    
    const result = await this.api.tools.executeWorkflow(
      workflowName,
      args,
      { conversationId }
    );

    const duration = Date.now() - startTime;
    
    console.log(`[tool-orchestrator] Workflow completed in ${duration}ms`);
    
    return {
      ...result,
      duration,
    };
  }

  /**
   * Get tool usage statistics
   */
  async getStats(): Promise<{
    conversations: number;
    totalCost: number;
    availableTools: number;
  }> {
    const costStats = this.api.tools.getCostStats();
    
    return {
      conversations: this.conversationHistory.size,
      totalCost: costStats.daily + costStats.monthly,
      availableTools: this.api.tools.list().length,
    };
  }

  /**
   * Clear conversation history
   */
  clearHistory(conversationId?: string): void {
    if (conversationId) {
      this.conversationHistory.delete(conversationId);
      console.log(`[tool-orchestrator] Cleared history for: ${conversationId}`);
    } else {
      this.conversationHistory.clear();
      console.log("[tool-orchestrator] Cleared all conversation history");
    }
  }

  /**
   * Webhook endpoint for external queries
   */
  static webhook = "/api/tool-orchestrator";

  async onWebhook(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json();
      const { query, conversationId, workflow } = body;

      if (!query && !workflow) {
        return Response.json({ error: "Query or workflow required" }, { status: 400 });
      }

      let result;
      if (workflow) {
        result = await this.runWorkflow(workflow, body.args || {}, conversationId);
      } else {
        result = await this.handleQuery(query, conversationId);
      }

      return Response.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("[tool-orchestrator] Webhook error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  }
}
