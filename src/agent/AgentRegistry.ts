import type { AgentMetadata } from "../types/agent.js";
import type { FilesAPI } from "../api/files.js";
import type { HTTPAPI } from "../api/http.js";
import { CronScheduler } from "./CronScheduler.js";

export interface RegistryOptions {
  files: FilesAPI;
  http: HTTPAPI;
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
  private scheduler: CronScheduler;

  constructor(options: RegistryOptions) {
    this.files = options.files;
    this.http = options.http;
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
   * Register a webhook route for an agent
   */
  private registerWebhook(agentName: string, path: string): void {
    this.webhookRoutes.set(path, agentName);
    console.log(`Registered webhook for ${agentName}: ${path}`);

    // Start webhook server if not already started
    if (!this.webhookServer) {
      this.startWebhookServer();
    }
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
        const agentName = this.webhookRoutes.get(url.pathname);

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

