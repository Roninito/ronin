import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../src/tools/types.js";

interface WebFetchRequest {
  url: string;
  format?: "html" | "text" | "json";
  maxLength?: number;
}

interface WebFetchResult {
  success: boolean;
  url: string;
  content: string;
  title?: string;
  error?: string;
  truncated?: boolean;
}

/**
 * Web Researcher Agent - Tool Provider Example
 *
 * Demonstrates how agents can register themselves as tool providers
 * in the Hybrid Intelligence Architecture.
 *
 * This agent provides web research capabilities that can be called
 * by the local orchestrator or other agents via the tool system.
 * It also absorbs the former web-viewer duty: safe URL fetching with
 * rate limiting, exposed as the agent.WebResearcher.fetch tool and the
 * /api/web-viewer route (kept for compatibility).
 */
export default class WebResearcherAgent extends BaseDuty {
  static webhook = "/api/web-viewer";

  private researchCache: Map<string, any> = new Map();
  private requestLog: Map<string, number[]> = new Map(); // domain -> timestamps
  private maxRequestsPerMinute = 10;

  constructor(api: DutyAPI) {
    super(api);
    this.registerRoutes();
    console.log("[web-researcher] Web Researcher Agent initialized");
  }

  /**
   * Register HTTP routes for web viewing (absorbed from web-viewer).
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/api/web-viewer", this.handleWebViewRequest.bind(this));
  }

  /**
   * Handle web view API requests.
   */
  private async handleWebViewRequest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = (await req.json()) as WebFetchRequest;
      const result = await this.fetchUrl(body);
      return Response.json(result);
    } catch (error) {
      console.error("[web-researcher] Web view error:", error);
      return Response.json({
        success: false,
        url: "",
        content: "",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  override async onWebhook(payload: unknown): Promise<void> {
    const req = payload as {
      url: string;
      method: string;
      headers: Record<string, string>;
      payload: unknown;
    };
    if (req.method !== "POST") {
      return { contentType: "text/plain", body: "Method not allowed", status: 405 } as any;
    }
    try {
      const result = await this.fetchUrl((req.payload ?? {}) as WebFetchRequest);
      return { contentType: "application/json", body: JSON.stringify(result), status: 200 } as any;
    } catch (error) {
      return {
        contentType: "application/json",
        body: JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
        status: 500,
      } as any;
    }
  }

  /**
   * Fetch a URL and return formatted content (rate-limited, truncated).
   * Backs both the /api/web-viewer route and the agent.WebResearcher.fetch tool.
   */
  async fetchUrl(params: WebFetchRequest): Promise<WebFetchResult> {
    const { url, format = "text", maxLength = 5000 } = params;

    console.log(`[web-researcher] Fetching: ${url}`);

    try {
      // Validate URL
      const urlObj = new URL(url);

      // Check rate limits
      if (!this.checkRateLimit(urlObj.hostname)) {
        return {
          success: false,
          url,
          content: "",
          error: "Rate limit exceeded. Max 10 requests per minute per domain.",
        };
      }

      // Fetch the URL
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Ronin-WebViewer/1.0",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          url,
          content: "",
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Get content type
      const contentType = response.headers.get("content-type") || "";

      // Parse based on format
      let content: string;
      let title: string | undefined;

      if (format === "json" || contentType.includes("json")) {
        try {
          const json = await response.json();
          content = JSON.stringify(json, null, 2);
        } catch {
          content = await response.text();
        }
      } else if (format === "html") {
        content = await response.text();
        // Extract title
        const titleMatch = content.match(/<title[^>]*>([^<]*)<\/title>/i);
        title = titleMatch ? titleMatch[1]!.trim() : undefined; // capture group is mandatory in the regex
      } else {
        // Text format - extract readable text
        const html = await response.text();
        content = this.extractText(html);

        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        title = titleMatch ? titleMatch[1]!.trim() : undefined; // capture group is mandatory in the regex
      }

      // Check content size
      const truncated = content.length > maxLength;
      const finalContent = content.substring(0, maxLength) + (truncated ? "\n\n[Content truncated...]" : "");

      console.log(`[web-researcher] Fetched ${content.length} chars from ${url}`);

      return {
        success: true,
        url,
        content: finalContent,
        title,
        truncated,
      };
    } catch (error) {
      console.error(`[web-researcher] Failed to fetch ${url}:`, error);
      return {
        success: false,
        url,
        content: "",
        error: error instanceof Error ? error.message : "Fetch failed",
      };
    }
  }

  /**
   * Check rate limits for a domain.
   */
  private checkRateLimit(domain: string): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    let timestamps = this.requestLog.get(domain) || [];

    // Remove old timestamps
    timestamps = timestamps.filter((ts) => ts > oneMinuteAgo);

    // Check limit
    if (timestamps.length >= this.maxRequestsPerMinute) {
      return false;
    }

    // Add new timestamp
    timestamps.push(now);
    this.requestLog.set(domain, timestamps);

    return true;
  }

  /**
   * Extract readable text from HTML.
   */
  private extractText(html: string): string {
    // Remove scripts and styles
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    // Replace common block elements with newlines
    text = text
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n");

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, "");

    // Decode HTML entities
    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");

    // Clean up whitespace
    text = text.replace(/\n\s*\n\s*\n/g, "\n\n").trim();

    return text;
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

    // Register a third tool for safe URL fetching (absorbed from web-viewer)
    const fetchTool: ToolDefinition = {
      name: "agent.WebResearcher.fetch",
      description: "Fetch a URL and return its content as text, HTML, or JSON (rate-limited, truncated)",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
          format: {
            type: "string",
            enum: ["html", "text", "json"],
            default: "text",
            description: "Response format",
          },
          maxLength: {
            type: "number",
            default: 5000,
            description: "Maximum content length in characters",
          },
        },
        required: ["url"],
      },
      provider: "agent.WebResearcher",
      handler: this.handleFetchRequest.bind(this),
      cost: {
        estimate: () => 0.001,
      },
      riskLevel: "low",
      cacheable: true,
      ttl: 1800,
      agentId: this.constructor.name,
    };

    this.api.tools.register(fetchTool);

    console.log("[web-researcher] Tools registered successfully");
  }

  /**
   * Handle fetch tool calls — delegates to the shared fetchUrl backend.
   */
  private async handleFetchRequest(
    args: { url: string; format?: "html" | "text" | "json"; maxLength?: number },
    context: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const result = await this.fetchUrl(args);
      return {
        success: result.success,
        data: result.success
          ? { url: result.url, title: result.title, content: result.content, truncated: result.truncated }
          : null,
        error: result.error,
        metadata: {
          toolName: "agent.WebResearcher.fetch",
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
        error: error instanceof Error ? error.message : "Fetch failed",
        metadata: {
          toolName: "agent.WebResearcher.fetch",
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
          summary: response,
          originalLength: args.content.length,
          summaryLength: response.length,
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
    this.api.tools.unregister("agent.WebResearcher.fetch");

    // Clear cache
    this.researchCache.clear();

    console.log("[web-researcher] Tools unregistered");
  }
}
