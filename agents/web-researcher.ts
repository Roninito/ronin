import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../src/tools/types.js";

/**
 * Web Researcher Agent - Tool Provider Example
 * 
 * Demonstrates how agents can register themselves as tool providers
 * in the Hybrid Intelligence Architecture.
 * 
 * This agent provides web research capabilities that can be called
 * by the local orchestrator or other agents via the tool system.
 */
export default class WebResearcherAgent extends BaseAgent {
  private researchCache: Map<string, any> = new Map();

  constructor(api: AgentAPI) {
    super(api);
    console.log("[web-researcher] Web Researcher Agent initialized");
  }

  /**
   * Register this agent as a tool provider when mounted
   */
  async onMount(): Promise<void> {
    console.log("[web-researcher] Registering as tool provider...");

    // Register the research tool
    const researchTool: ToolDefinition = {
      name: "agent.WebResearcher.research",
      description: "Search and summarize web content on a given topic",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The research query or topic",
          },
          depth: {
            type: "number",
            default: 2,
            description: "Research depth (1-3, higher = more thorough)",
          },
          sources: {
            type: "array",
            items: { type: "string" },
            default: ["web"],
            description: "Sources to search (web, news, academic)",
          },
        },
        required: ["query"],
      },
      provider: "agent.WebResearcher",
      handler: this.handleResearchRequest.bind(this),
      cost: {
        estimate: (args: any) => (args.depth || 2) * 0.005, // Estimated API costs
      },
      riskLevel: "low",
      cacheable: true,
      ttl: 3600, // Cache for 1 hour
      agentId: this.constructor.name,
    };

    // Register via the tools API
    this.api.tools.register(researchTool);

    // Register a second tool for summarization
    const summarizeTool: ToolDefinition = {
      name: "agent.WebResearcher.summarize",
      description: "Summarize a long text or document",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Content to summarize",
          },
          maxLength: {
            type: "number",
            default: 500,
            description: "Maximum summary length in words",
          },
          style: {
            type: "string",
            enum: ["concise", "detailed", "bullet-points"],
            default: "concise",
            description: "Summary style",
          },
        },
        required: ["content"],
      },
      provider: "agent.WebResearcher",
      handler: this.handleSummarizeRequest.bind(this),
      cost: {
        estimate: () => 0.002,
      },
      riskLevel: "low",
      cacheable: true,
      ttl: 1800,
      agentId: this.constructor.name,
    };

    this.api.tools.register(summarizeTool);

    console.log("[web-researcher] Tools registered successfully");
  }

  /**
   * Handle research tool calls
   */
  private async handleResearchRequest(
    args: { query: string; depth?: number; sources?: string[] },
    context: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const cacheKey = `research:${args.query}:${args.depth || 2}`;

    // Check cache
    if (this.researchCache.has(cacheKey)) {
      console.log("[web-researcher] Cache hit for:", args.query);
      return {
        success: true,
        data: this.researchCache.get(cacheKey),
        metadata: {
          toolName: "agent.WebResearcher.research",
          provider: "agent.WebResearcher",
          duration: Date.now() - startTime,
          cached: true,
          timestamp: Date.now(),
          callId: context.conversationId,
        },
      };
    }

    try {
      console.log(`[web-researcher] Researching: ${args.query} (depth: ${args.depth || 2})`);

      // Simulate web research (replace with actual implementation)
      const results = await this.performResearch(args);

      // Cache results
      this.researchCache.set(cacheKey, results);

      return {
        success: true,
        data: results,
        metadata: {
          toolName: "agent.WebResearcher.research",
          provider: "agent.WebResearcher",
          duration: Date.now() - startTime,
          cached: false,
          timestamp: Date.now(),
          callId: context.conversationId,
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Research failed",
        metadata: {
          toolName: "agent.WebResearcher.research",
          provider: "agent.WebResearcher",
          duration: Date.now() - startTime,
          cached: false,
          timestamp: Date.now(),
          callId: context.conversationId,
        },
      };
    }
  }

  /**
   * Perform actual research (placeholder implementation)
   */
  private async performResearch(args: {
    query: string;
    depth?: number;
    sources?: string[];
  }): Promise<any> {
    // This is where you'd implement actual web scraping,
    // API calls to search engines, etc.

    // For now, simulate a response
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      query: args.query,
      summary: `Research findings for "${args.query}" (depth: ${args.depth || 2})`,
      sources: [
        { title: "Example Source 1", url: "https://example.com/1" },
        { title: "Example Source 2", url: "https://example.com/2" },
      ],
      keyPoints: [
        "Key finding 1 related to the query",
        "Key finding 2 with additional context",
        "Key finding 3 providing deeper insights",
      ],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle summarize tool calls
   */
  private async handleSummarizeRequest(
    args: { content: string; maxLength?: number; style?: string },
    context: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      console.log(`[web-researcher] Summarizing content (${args.content.length} chars)`);

      // Use local LLM for summarization
      const prompt = `Summarize the following text in ${args.style || "concise"} style, maximum ${args.maxLength || 500} words:\n\n${args.content}`;

      const response = await this.api.ai.complete(prompt, {
        maxTokens: 1000,
        temperature: 0.3,
      });

      return {
        success: true,
        data: {
          summary: response.content,
          originalLength: args.content.length,
          summaryLength: response.content.length,
          style: args.style || "concise",
        },
        metadata: {
          toolName: "agent.WebResearcher.summarize",
          provider: "agent.WebResearcher",
          duration: Date.now() - startTime,
          cached: false,
          timestamp: Date.now(),
          callId: context.conversationId,
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Summarization failed",
        metadata: {
          toolName: "agent.WebResearcher.summarize",
          provider: "agent.WebResearcher",
          duration: Date.now() - startTime,
          cached: false,
          timestamp: Date.now(),
          callId: context.conversationId,
        },
      };
    }
  }

  /**
   * Example of how an agent can use tools
   */
  async execute(): Promise<void> {
    // Demonstrate calling other tools from within an agent
    console.log("[web-researcher] Demonstrating tool usage...");

    try {
      // Example: Call the local memory search tool
      const memoryResult = await this.api.tools.execute(
        "local.memory.search",
        { query: "web research", limit: 3 },
        { conversationId: "demo" }
      );

      if (memoryResult.success) {
        console.log("[web-researcher] Found memories:", memoryResult.data);
      }

      // Example: Execute a workflow
      const workflowResult = await this.api.tools.executeWorkflow(
        "research-and-visualize",
        { topic: "AI agents" },
        { conversationId: "demo" }
      );

      console.log("[web-researcher] Workflow completed:", workflowResult.success);
    } catch (error) {
      console.error("[web-researcher] Tool usage demo failed:", error);
    }
  }

  /**
   * Cleanup when agent is unmounted
   */
  async onUnmount(): Promise<void> {
    console.log("[web-researcher] Unmounting, unregistering tools...");

    // Unregister tools
    this.api.tools.unregister("agent.WebResearcher.research");
    this.api.tools.unregister("agent.WebResearcher.summarize");

    // Clear cache
    this.researchCache.clear();

    console.log("[web-researcher] Tools unregistered");
  }
}
