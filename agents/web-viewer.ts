import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

interface WebViewRequest {
  url: string;
  format?: "html" | "text" | "json";
  maxLength?: number;
}

interface WebViewResult {
  success: boolean;
  url: string;
  content: string;
  title?: string;
  error?: string;
  truncated?: boolean;
}

/**
 * Web Viewer Agent
 * 
 * Specialized agent for fetching and viewing web content.
 * Includes safety guards and rate limiting.
 * 
 * Capabilities:
 * - Fetch any URL (websites, APIs, Ronin routes)
 * - Return content in multiple formats (HTML, text, JSON)
 * - Automatic truncation for large pages
 * - Rate limiting to prevent abuse
 * 
 * Safety Features:
 * - Only fetches URLs (no POST/PUT/DELETE by default)
 * - Respects robots.txt (future)
 * - Rate limiting: max 10 requests per minute
 * - Content size limits
 */
export default class WebViewerAgent extends BaseAgent {
  static webhook = "/api/web-viewer";
  
  private requestLog: Map<string, number[]> = new Map(); // domain -> timestamps
  private maxRequestsPerMinute = 10;
  private maxContentLength = 100000; // 100KB max

  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
    console.log("🌐 Web Viewer agent ready");
  }

  /**
   * Register HTTP routes for web viewing
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/api/web-viewer", this.handleWebViewRequest.bind(this));
  }

  /**
   * Handle web view API requests
   */
  private async handleWebViewRequest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json() as WebViewRequest;
      const result = await this.fetchUrl(body);
      return Response.json(result);
    } catch (error) {
      console.error("[web-viewer] Error:", error);
      return Response.json({
        success: false,
        url: "",
        content: "",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Fetch a URL and return formatted content
   */
  async fetchUrl(params: WebViewRequest): Promise<WebViewResult> {
    const { url, format = "text", maxLength = 5000 } = params;

    console.log(`[web-viewer] Fetching: ${url}`);

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
        title = titleMatch ? titleMatch[1].trim() : undefined;
      } else {
        // Text format - extract readable text
        const html = await response.text();
        content = this.extractText(html);
        
        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        title = titleMatch ? titleMatch[1].trim() : undefined;
      }

      // Check content size
      const truncated = content.length > maxLength;
      const finalContent = content.substring(0, maxLength) + (truncated ? "\n\n[Content truncated...]" : "");

      console.log(`[web-viewer] Fetched ${content.length} chars from ${url}`);

      return {
        success: true,
        url,
        content: finalContent,
        title,
        truncated,
      };
    } catch (error) {
      console.error(`[web-viewer] Failed to fetch ${url}:`, error);
      return {
        success: false,
        url,
        content: "",
        error: error instanceof Error ? error.message : "Fetch failed",
      };
    }
  }

  /**
   * Check rate limits for a domain
   */
  private checkRateLimit(domain: string): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    let timestamps = this.requestLog.get(domain) || [];
    
    // Remove old timestamps
    timestamps = timestamps.filter(ts => ts > oneMinuteAgo);
    
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
   * Extract readable text from HTML
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
    text = text
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim();
    
    return text;
  }

  async execute(): Promise<void> {
    // This agent is API-driven
  }
}
