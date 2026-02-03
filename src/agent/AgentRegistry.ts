import type { AgentMetadata } from "../types/agent.js";
import type { FilesAPI } from "../api/files.js";
import type { HTTPAPI } from "../api/http.js";
import type { EventsAPI } from "../api/events.js";
import { CronScheduler } from "./CronScheduler.js";
import { join } from "path";

export interface RegistryOptions {
  files: FilesAPI;
  http: HTTPAPI;
  events?: EventsAPI;
}

/**
 * Manages agent registration, scheduling, and event handling
 */
export class AgentRegistry {
  private agents: Map<string, AgentMetadata> = new Map();
  private cronJobs: Map<string, () => void> = new Map(); // Track scheduled agents and cleanup functions
  private fileWatchers: Map<string, string[]> = new Map(); // agent name -> patterns
  private webhookRoutes: Map<string, string> = new Map(); // path -> agent name
  private webhookServer: ReturnType<typeof Bun.serve> | null = null;
  private files: FilesAPI;
  private http: HTTPAPI;
  private events?: EventsAPI;
  private scheduler: CronScheduler;

  constructor(options: RegistryOptions) {
    this.files = options.files;
    this.http = options.http;
    this.events = options.events;
    this.scheduler = new CronScheduler();
  }

  /**
   * Register an agent
   */
  register(agent: AgentMetadata): void {
    this.agents.set(agent.name, agent);

    // Register schedule if present
    if (agent.schedule) {
      this.registerSchedule(agent.name, agent.schedule);
    }

    // Register file watchers if present
    if (agent.watch && agent.watch.length > 0) {
      this.registerFileWatchers(agent.name, agent.watch);
    }

    // Register webhook if present
    if (agent.webhook) {
      this.registerWebhook(agent.name, agent.webhook);
    }
  }

  /**
   * Register all agents
   */
  registerAll(agents: AgentMetadata[]): void {
    for (const agent of agents) {
      this.register(agent);
    }
  }

  /**
   * Register a cron schedule for an agent
   */
  private registerSchedule(agentName: string, schedule: string): void {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    // Create a cron job using our scheduler
    const cleanup = this.scheduler.schedule(schedule, () => {
      this.executeAgent(agentName).catch(error => {
        console.error(`Error executing scheduled agent ${agentName}:`, error);
      });
    });

    this.cronJobs.set(agentName, cleanup);
    console.log(`Registered schedule for ${agentName}: ${schedule}`);
  }

  /**
   * Register file watchers for an agent
   */
  private registerFileWatchers(agentName: string, patterns: string[]): void {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    for (const pattern of patterns) {
      this.files.watch(pattern, async (path: string, event: string) => {
        if (agent.instance.onFileChange) {
          try {
            await agent.instance.onFileChange(
              path,
              event as "create" | "update" | "delete"
            );
          } catch (error) {
            console.error(`Error in file change handler for ${agentName}:`, error);
          }
        }
      });
    }

    this.fileWatchers.set(agentName, patterns);
    console.log(`Registered file watchers for ${agentName}: ${patterns.join(", ")}`);
  }

  /**
   * Start the webhook server (public method to ensure it's always available)
   */
  startWebhookServerIfNeeded(): void {
    if (!this.webhookServer) {
      this.startWebhookServer();
    }
  }

  /**
   * Register a webhook route for an agent
   */
  private registerWebhook(agentName: string, path: string): void {
    this.webhookRoutes.set(path, agentName);
    console.log(`Registered webhook for ${agentName}: ${path}`);

    // Start webhook server if not already started
    this.startWebhookServerIfNeeded();
  }

  /**
   * Start the webhook server
   */
  private startWebhookServer(): void {
    const port = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
    
    this.webhookServer = Bun.serve({
      port,
      fetch: async (req) => {
        const url = new URL(req.url);
        const path = url.pathname;

        // Root route - Show all available routes
        if (path === "/") {
          return new Response(this.getRootHTML(port), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Status endpoint - API (JSON)
        if (path === "/api/status") {
          const status = this.getStatus();
          return Response.json({
            running: true,
            port,
            ...status,
            uptime: process.uptime(),
            pid: process.pid,
          }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Routes endpoint - API (JSON)
        if (path === "/api/routes") {
          const routes = this.getRoutesList(port);
          return Response.json({
            running: true,
            port,
            routes,
          }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Status endpoint - Web UI (HTML)
        if (path === "/status") {
          const status = this.getStatus();
          const statusData = {
            running: true,
            port,
            ...status,
            uptime: process.uptime(),
            pid: process.pid,
          };
          return new Response(this.getStatusHTML(statusData), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Health check endpoint
        if (path === "/health" || path === "/api/health") {
          return Response.json({ status: "ok", running: true }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Serve font files
        if (path.startsWith("/fonts/")) {
          try {
            const fontPath = join(process.cwd(), "public", path);
            const file = Bun.file(fontPath);
            if (await file.exists()) {
              const ext = path.split(".").pop()?.toLowerCase();
              const contentType = ext === "otf" ? "font/otf" : ext === "ttf" ? "font/ttf" : ext === "woff" ? "font/woff" : ext === "woff2" ? "font/woff2" : "application/octet-stream";
              return new Response(file, {
                headers: {
                  "Content-Type": contentType,
                  "Cache-Control": "public, max-age=31536000, immutable",
                },
              });
            }
          } catch {
            // Fall through to 404
          }
        }

        // Event emission endpoint
        if (path === "/api/events/emit" && req.method === "POST") {
          if (!this.events) {
            return Response.json({ error: "Events API not available" }, { status: 500 });
          }
          try {
            const body = await req.json();
            const { event, data } = body;
            if (!event) {
              return Response.json({ error: "Event name required" }, { status: 400 });
            }
            this.events.emit(event, data || {});
            return Response.json({ success: true, event, data });
          } catch (error) {
            return Response.json({ error: "Invalid JSON" }, { status: 400 });
          }
        }

        // Check HTTP API registered routes (agents can register routes via this.api.http.registerRoute)
        // Check exact match first
        const httpRouteHandler = this.http.getRouteHandler(path);
        if (httpRouteHandler) {
          return httpRouteHandler(req);
        }

        // Check for routes with trailing slash
        if (path.endsWith("/") && path.length > 1) {
          const pathWithoutSlash = path.slice(0, -1);
          const httpRouteHandlerNoSlash = this.http.getRouteHandler(pathWithoutSlash);
          if (httpRouteHandlerNoSlash) {
            return httpRouteHandlerNoSlash(req);
          }
        } else if (!path.endsWith("/")) {
          const pathWithSlash = path + "/";
          const httpRouteHandlerWithSlash = this.http.getRouteHandler(pathWithSlash);
          if (httpRouteHandlerWithSlash) {
            return httpRouteHandlerWithSlash(req);
          }
        }

        // Check for prefix matches (e.g., /fishy/api/fish/123 should match /fishy/api/fish/)
        // Only match if the registered path ends with / and the request path starts with it
        // This allows routes like /fishy/api/fish/ to handle /fishy/api/fish/123
        for (const [registeredPath, handler] of this.http.getAllRoutes()) {
          if (registeredPath.endsWith("/") && path.startsWith(registeredPath) && registeredPath !== "/") {
            return handler(req);
          }
        }

        // Agent webhook routes
        const agentName = this.webhookRoutes.get(path);
        if (!agentName) {
          return new Response("Not Found", { status: 404 });
        }

        const agent = this.agents.get(agentName);
        if (!agent) {
          return new Response("Agent not found", { status: 404 });
        }

        try {
          let payload: unknown = null;
          if (req.method === "POST" || req.method === "PUT") {
            const contentType = req.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
              payload = await req.json();
            } else {
              payload = await req.text();
            }
          }

          if (agent.instance.onWebhook) {
            await agent.instance.onWebhook(payload);
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error(`Error handling webhook for ${agentName}:`, error);
          return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    });

    console.log(`Webhook server started on port ${port}`);
    console.log(`   Status endpoint: http://localhost:${port}/api/status`);
  }

  /**
   * Execute an agent manually
   */
  async executeAgent(agentName: string): Promise<void> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    await agent.instance.execute();
  }

  /**
   * Get all registered agents
   */
  getAgents(): AgentMetadata[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by name
   */
  getAgent(name: string): AgentMetadata | undefined {
    return this.agents.get(name);
  }

  /**
   * Get agent status information
   */
  getStatus(): {
    totalAgents: number;
    scheduledAgents: number;
    watchedAgents: number;
    webhookAgents: number;
    agents: Array<{
      name: string;
      schedule?: string;
      watch?: string[];
      webhook?: string;
    }>;
  } {
    const agents = this.getAgents();
    return {
      totalAgents: agents.length,
      scheduledAgents: agents.filter(a => a.schedule).length,
      watchedAgents: agents.filter(a => a.watch && a.watch.length > 0).length,
      webhookAgents: agents.filter(a => a.webhook).length,
      agents: agents.map(a => ({
        name: a.name,
        schedule: a.schedule,
        watch: a.watch,
        webhook: a.webhook,
      })),
    };
  }

  /**
   * Get all known routes (system + registered HTTP + webhook routes)
   */
  private getRoutesList(port: number): Array<{
    path: string;
    url: string;
    type: "system" | "http" | "webhook";
    description?: string;
  }> {
    const routes: Array<{
      path: string;
      url: string;
      type: "system" | "http" | "webhook";
      description?: string;
    }> = [];

    const addRoute = (path: string, type: "system" | "http" | "webhook", description?: string) => {
      routes.push({
        path,
        url: `http://localhost:${port}${path}`,
        type,
        description,
      });
    };

    // System routes
    addRoute("/", "system", "Routes dashboard");
    addRoute("/status", "system", "Status UI");
    addRoute("/api/status", "system", "Status JSON");
    addRoute("/health", "system", "Health check");
    addRoute("/api/health", "system", "Health check JSON");
    addRoute("/api/routes", "system", "List registered routes");

    // HTTP API routes (agent-registered)
    for (const path of this.http.getAllRoutes().keys()) {
      addRoute(path, "http", "Agent-registered HTTP route");
    }

    // Webhook routes
    for (const [path, agentName] of this.webhookRoutes.entries()) {
      addRoute(path, "webhook", `Webhook for ${agentName}`);
    }

    return routes;
  }

  /**
   * Generate root HTML page with all available routes
   */
  private getRootHTML(port: number): string {
    const status = this.getStatus();
    const allRoutes = this.getRoutesList(port);

    // Helper function to get icon for a route
    const getRouteIcon = (path: string, type: string): string => {
      // Route-specific icons
      if (path.includes("/fishy")) return "🐟";
      if (path.includes("/rss")) return "📰";
      if (path.includes("/gvec")) return "🌍";
      
      // Type-based icons
      if (type === "system") return "⚡";
      if (type === "webhook") return "🔗";
      if (path.startsWith("/api/")) return "🔌";
      return "🌐";
    };

    // Helper function to get title for a route
    const getRouteTitle = (path: string, type: string, description?: string): string => {
      if (description && description !== "Agent-registered HTTP route") {
        // Extract title from description if it's descriptive
        if (description.includes("Webhook for")) {
          return description.replace("Webhook for ", "") + " Webhook";
        }
        if (description.includes("Routes dashboard")) return "Routes Dashboard";
        if (description.includes("Status UI")) return "Status Dashboard";
        if (description.includes("Status JSON")) return "Status API";
        if (description.includes("Health check")) return "Health Check";
        if (description.includes("List registered routes")) return "Routes API";
      }
      
      // Generate title from path
      if (path === "/") return "Routes Dashboard";
      if (path === "/status") return "Status Dashboard";
      if (path.startsWith("/api/")) {
        const apiName = path.replace("/api/", "").split("/")[0];
        return apiName.charAt(0).toUpperCase() + apiName.slice(1) + " API";
      }
      if (type === "webhook") {
        const agentName = this.webhookRoutes.get(path);
        return agentName ? `${agentName} Webhook` : "Webhook";
      }
      
      // Convert path to title
      const segments = path.split("/").filter(Boolean);
      return segments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    };

    // Helper function to get category for a route
    const getRouteCategory = (path: string, type: string): string => {
      if (type === "system") {
        if (path.startsWith("/api/")) return "System";
        return "System";
      }
      if (type === "webhook") return "Webhooks";
      if (path.startsWith("/api/")) return "API";
      return "Web UI";
    };

    // Helper function to get description for a route
    const getRouteDescription = (path: string, type: string, description?: string): string => {
      if (description && description !== "Agent-registered HTTP route") {
        return description;
      }
      
      if (type === "system") {
        if (path === "/") return "Routes dashboard";
        if (path === "/status") return "View system status, agents, and runtime information";
        if (path === "/api/status") return "Get system status as JSON";
        if (path === "/api/health" || path === "/health") return "Simple health check endpoint";
        if (path === "/api/routes") return "List all registered routes as JSON";
      }
      
      if (type === "webhook") {
        const agentName = this.webhookRoutes.get(path);
        return agentName ? `Webhook endpoint for ${agentName} agent` : "Webhook endpoint";
      }
      
      if (path.startsWith("/api/")) {
        return "API endpoint";
      }
      
      return "Web interface";
    };

    // Deduplicate routes (prefer routes without trailing slashes)
    const routeMap = new Map<string, typeof allRoutes[0]>();
    for (const route of allRoutes) {
      const normalizedPath = route.path.endsWith("/") && route.path.length > 1
        ? route.path.slice(0, -1)
        : route.path;
      
      // Skip root route from display
      if (normalizedPath === "/") continue;
      
      // Prefer route without trailing slash, or keep existing if already added
      if (!routeMap.has(normalizedPath)) {
        routeMap.set(normalizedPath, route);
      } else {
        const existing = routeMap.get(normalizedPath)!;
        if (!route.path.endsWith("/") && existing.path.endsWith("/")) {
          routeMap.set(normalizedPath, route);
        }
      }
    }

    // Transform routes into template format
    const routes = Array.from(routeMap.values()).map(route => ({
      path: route.path.endsWith("/") && route.path.length > 1 ? route.path.slice(0, -1) : route.path,
      title: getRouteTitle(route.path, route.type, route.description),
      description: getRouteDescription(route.path, route.type, route.description),
      icon: getRouteIcon(route.path, route.type),
      category: getRouteCategory(route.path, route.type)
    }));

    // Group routes by category and sort within each category
    const routesByCategory = routes.reduce((acc, route) => {
      if (!acc[route.category]) {
        acc[route.category] = [];
      }
      acc[route.category].push(route);
      return acc;
    }, {} as Record<string, typeof routes>);

    // Sort routes within each category by path
    for (const category in routesByCategory) {
      routesByCategory[category].sort((a, b) => a.path.localeCompare(b.path));
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin - Available Routes</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      padding: 0;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 4rem 2rem;
    }
    
    .header {
      margin-bottom: 4rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 3rem;
    }
    
    .header h1 {
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: 300;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
      color: #ffffff;
    }
    
    .header p {
      font-size: 1.1rem;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 300;
    }
    
    .stats-bar {
      display: flex;
      gap: 3rem;
      margin-top: 2rem;
      flex-wrap: wrap;
    }
    
    .stat {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    
    .stat-value {
      font-size: 2rem;
      font-weight: 300;
      color: #ffffff;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .stat-label {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 500;
    }
    
    .content {
      padding: 0;
    }
    
    .category {
      margin-bottom: 4rem;
    }
    
    .category-title {
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 1.5rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .category-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .routes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }
    
    .route-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 1.5rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      text-decoration: none;
      color: inherit;
      display: block;
      position: relative;
      overflow: hidden;
    }
    
    .route-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }
    
    .route-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
      transform: translateY(-2px);
      text-decoration: none;
    }
    
    .route-card:hover::before {
      opacity: 1;
    }
    
    .route-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    
    .route-icon {
      font-size: 1.25rem;
      opacity: 0.8;
    }
    
    .route-title {
      font-size: 1.1rem;
      font-weight: 500;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    
    .route-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.5);
      background: rgba(255, 255, 255, 0.05);
      padding: 0.375rem 0.625rem;
      border-radius: 2px;
      display: inline-block;
      margin-bottom: 0.75rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .route-description {
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.875rem;
      line-height: 1.6;
      font-weight: 300;
    }
    
    .empty-category {
      text-align: center;
      padding: 3rem;
      color: rgba(255, 255, 255, 0.3);
      font-style: italic;
    }
    
    .footer {
      text-align: center;
      padding: 3rem 0 0;
      color: rgba(255, 255, 255, 0.3);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 0.75rem;
      font-weight: 300;
      letter-spacing: 0.05em;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 2rem 1.5rem;
      }
      
      .stats-bar {
        gap: 2rem;
      }
      
      .routes-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ Ronin</h1>
      <p>Agent System - Available Routes</p>
      <div class="stats-bar">
        <div class="stat">
          <span class="stat-value">${status.totalAgents}</span>
          <span class="stat-label">Agents</span>
        </div>
        <div class="stat">
          <span class="stat-value">${status.scheduledAgents}</span>
          <span class="stat-label">Scheduled</span>
        </div>
        <div class="stat">
          <span class="stat-value">${status.webhookAgents}</span>
          <span class="stat-label">Webhooks</span>
        </div>
        <div class="stat">
          <span class="stat-value">${port}</span>
          <span class="stat-label">Port</span>
        </div>
      </div>
    </div>
    
    <div class="content">
      ${Object.entries(routesByCategory).map(([category, categoryRoutes]) => `
        <div class="category">
          <h2 class="category-title">
            <span>${category === "Web UI" ? "🌐" : category === "API" ? "🔌" : category === "Webhooks" ? "🔗" : "⚡"}</span>
            ${category}
          </h2>
          ${categoryRoutes.length > 0 ? `
            <div class="routes-grid">
              ${categoryRoutes.map(route => `
                <a href="${route.path}" class="route-card">
                  <div class="route-header">
                    <span class="route-icon">${route.icon}</span>
                    <span class="route-title">${route.title}</span>
                  </div>
                  <div class="route-path">${route.path}</div>
                  <div class="route-description">${route.description}</div>
                </a>
              `).join("")}
            </div>
          ` : `
            <div class="empty-category">No routes available in this category</div>
          `}
        </div>
      `).join("")}
    </div>
    
    <div class="footer">
      <p>Ronin Agent System • Running on port ${port}</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generate HTML status page
   */
  private getStatusHTML(statusData: {
    running: boolean;
    port: number;
    totalAgents: number;
    scheduledAgents: number;
    watchedAgents: number;
    webhookAgents: number;
    uptime: number;
    pid: number;
    agents: Array<{
      name: string;
      schedule?: string;
      watch?: string[];
      webhook?: string;
    }>;
  }): string {
    const formatUptime = (seconds: number): string => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      
      if (days > 0) return `${days}d ${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
      if (minutes > 0) return `${minutes}m ${secs}s`;
      return `${secs}s`;
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Status</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      padding: 0;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 4rem 2rem;
    }
    
    .header {
      margin-bottom: 4rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 3rem;
      text-align: center;
    }
    
    .header h1 {
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: 300;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
      color: #ffffff;
    }
    
    .header p {
      font-size: 1.1rem;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 300;
      margin-bottom: 1rem;
    }
    
    .status-badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 0.5rem 1.25rem;
      border-radius: 20px;
      font-size: 0.875rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.7);
    }
    
    .status-badge.running {
      background: rgba(76, 175, 80, 0.15);
      border-color: rgba(76, 175, 80, 0.3);
      color: #4caf50;
    }
    
    .content {
      padding: 0;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 3rem;
    }
    
    .stat-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 1.5rem;
      text-align: center;
      transition: all 0.3s;
    }
    
    .stat-card:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.15);
    }
    
    .stat-value {
      font-size: 2.5rem;
      font-weight: 300;
      color: #ffffff;
      margin-bottom: 0.5rem;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .stat-label {
      color: rgba(255, 255, 255, 0.4);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 500;
    }
    
    .section {
      margin-bottom: 3rem;
    }
    
    .section-title {
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 1.5rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .agent-list {
      display: grid;
      gap: 1rem;
    }
    
    .agent-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 1.5rem;
      transition: all 0.3s;
    }
    
    .agent-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
      transform: translateY(-2px);
    }
    
    .agent-name {
      font-size: 1.2rem;
      font-weight: 500;
      color: #ffffff;
      margin-bottom: 1rem;
      letter-spacing: -0.01em;
    }
    
    .agent-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    
    .detail-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    
    .detail-label {
      font-weight: 500;
      color: rgba(255, 255, 255, 0.4);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    
    .detail-value {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.875rem;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 2px;
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid;
    }
    
    .badge.schedule {
      background: rgba(25, 118, 210, 0.1);
      border-color: rgba(25, 118, 210, 0.3);
      color: #64b5f6;
    }
    
    .badge.watch {
      background: rgba(123, 31, 162, 0.1);
      border-color: rgba(123, 31, 162, 0.3);
      color: #ba68c8;
    }
    
    .badge.webhook {
      background: rgba(56, 142, 60, 0.1);
      border-color: rgba(56, 142, 60, 0.3);
      color: #81c784;
    }
    
    .no-agents {
      text-align: center;
      padding: 3rem;
      color: rgba(255, 255, 255, 0.3);
      font-style: italic;
    }
    
    .refresh-btn {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
      border-radius: 50%;
      width: 56px;
      height: 56px;
      font-size: 1.5rem;
      cursor: pointer;
      transition: all 0.3s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .refresh-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      transform: scale(1.05) rotate(90deg);
    }
    
    .refresh-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
      margin-bottom: 3rem;
    }
    
    .info-item {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-left: 2px solid rgba(255, 255, 255, 0.2);
      padding: 1.25rem;
      border-radius: 4px;
    }
    
    .info-label {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }
    
    .info-value {
      font-size: 1.1rem;
      color: #ffffff;
      font-weight: 400;
      font-family: 'JetBrains Mono', monospace;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 2rem 1.5rem;
      }
      
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  
  <script>
    const { useState, useEffect } = React;
    
    const statusData = ${JSON.stringify(statusData)};
    
    function App() {
      const [data, setData] = useState(statusData);
      const [loading, setLoading] = useState(false);
      
      const refresh = async () => {
        setLoading(true);
        try {
          const res = await fetch('/api/status');
          const newData = await res.json();
          setData(newData);
        } catch (error) {
          console.error('Failed to refresh:', error);
        } finally {
          setLoading(false);
        }
      };
      
      // Auto-refresh every 5 seconds
      useEffect(() => {
        const interval = setInterval(refresh, 5000);
        return () => clearInterval(interval);
      }, []);
      
      const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (days > 0) return \`\${days}d \${hours}h \${minutes}m\`;
        if (hours > 0) return \`\${hours}h \${minutes}m \${secs}s\`;
        if (minutes > 0) return \`\${minutes}m \${secs}s\`;
        return \`\${secs}s\`;
      };
      
      return React.createElement('div', { className: 'container' },
        React.createElement('div', { className: 'header' },
          React.createElement('h1', null, '⚡ Ronin Status'),
          React.createElement('p', null, 'Agent System Dashboard'),
          React.createElement('div', { 
            className: \`status-badge \${data.running ? 'running' : ''}\`
          }, data.running ? '🟢 Running' : '🔴 Stopped')
        ),
        React.createElement('div', { className: 'content' },
          React.createElement('div', { className: 'info-grid' },
            React.createElement('div', { className: 'info-item' },
              React.createElement('div', { className: 'info-label' }, 'Port'),
              React.createElement('div', { className: 'info-value' }, data.port)
            ),
            React.createElement('div', { className: 'info-item' },
              React.createElement('div', { className: 'info-label' }, 'Process ID'),
              React.createElement('div', { className: 'info-value' }, data.pid)
            ),
            React.createElement('div', { className: 'info-item' },
              React.createElement('div', { className: 'info-label' }, 'Uptime'),
              React.createElement('div', { className: 'info-value' }, formatUptime(data.uptime))
            )
          ),
          React.createElement('div', { className: 'stats-grid' },
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.totalAgents),
              React.createElement('div', { className: 'stat-label' }, 'Total Agents')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.scheduledAgents),
              React.createElement('div', { className: 'stat-label' }, 'Scheduled')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.watchedAgents),
              React.createElement('div', { className: 'stat-label' }, 'File Watchers')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.webhookAgents),
              React.createElement('div', { className: 'stat-label' }, 'Webhooks')
            )
          ),
          React.createElement('div', { className: 'section' },
            React.createElement('h2', { className: 'section-title' }, 'Agents'),
            data.agents.length === 0 
              ? React.createElement('div', { className: 'no-agents' }, 'No agents registered')
              : React.createElement('div', { className: 'agent-list' },
                  data.agents.map(agent => 
                    React.createElement('div', { key: agent.name, className: 'agent-card' },
                      React.createElement('div', { className: 'agent-name' }, agent.name),
                      React.createElement('div', { className: 'agent-details' },
                        agent.schedule && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge schedule' }, 'Schedule'),
                          React.createElement('span', { className: 'detail-value' }, agent.schedule)
                        ),
                        agent.watch && agent.watch.length > 0 && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge watch' }, 'Watching'),
                          React.createElement('span', { className: 'detail-value' }, agent.watch.join(', '))
                        ),
                        agent.webhook && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge webhook' }, 'Webhook'),
                          React.createElement('span', { className: 'detail-value' }, agent.webhook)
                        )
                      )
                    )
                  )
                )
          )
        ),
        React.createElement('button', {
          className: 'refresh-btn',
          onClick: refresh,
          disabled: loading,
          title: 'Refresh Status'
        }, loading ? '⏳' : '🔄')
      );
    }
    
    ReactDOM.render(React.createElement(App), document.getElementById('root'));
  </script>
</body>
</html>`;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clean up cron jobs
    for (const cleanup of this.cronJobs.values()) {
      cleanup();
    }
    this.cronJobs.clear();
    this.scheduler.clearAll();
    
    // Stop file watchers
    for (const [agentName, patterns] of this.fileWatchers) {
      for (const pattern of patterns) {
        this.files.unwatch(pattern);
      }
    }
    this.fileWatchers.clear();

    // Stop webhook server
    if (this.webhookServer) {
      this.webhookServer.stop();
      this.webhookServer = null;
    }
    
    this.agents.clear();
    this.webhookRoutes.clear();
  }
}

