import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { AgentLoader } from "../src/agent/index.js";
import type { AgentMetadata } from "../src/types/agent.js";
import {
  parseCron,
  buildCronExpression,
  validateCronExpression,
  cronToHumanReadable,
  getCommonSchedules,
  explainCronField,
  type CronParts,
} from "../src/utils/cron.js";
import { resolve, basename } from "path";
import {
  roninTheme,
  getAdobeCleanFontFaceCSS,
  getThemeCSS,
  getHeaderBarCSS,
  getHeaderHomeIconHTML,
} from "../src/utils/theme.js";

/**
 * Schedule Manager Agent
 * Provides Web UI and API for managing cron schedules for all agents
 */
const SSE_CLIENTS_KEY = "_scheduleSSEClients" as const;

function getScheduleSSEClients(api: AgentAPI): Set<(data: string) => void> {
  const a = api as Record<string, unknown>;
  if (!a[SSE_CLIENTS_KEY]) a[SSE_CLIENTS_KEY] = new Set<(data: string) => void>();
  return a[SSE_CLIENTS_KEY] as Set<(data: string) => void>;
}

export default class ScheduleManagerAgent extends BaseAgent {
  private loader: AgentLoader;

  constructor(api: AgentAPI) {
    super(api);
    const agentDir = process.env.RONIN_AGENT_DIR || "./agents";
    const externalAgentDir = process.env.RONIN_EXTERNAL_AGENT_DIR || null;
    this.loader = new AgentLoader(agentDir, externalAgentDir);
    this.registerRoutes();
    this.registerTool();
    this.api.events.on("schedule_updated", () => this.broadcastScheduleUpdated({}));
    this.api.events.on("agent_reloaded", () => this.broadcastScheduleUpdated({}));
    console.log("✅ Schedule Manager agent ready. UI available at /schedule");
  }

  /** Notify connected SSE clients so the schedule UI can refresh (uses shared set so it survives hot reload). */
  private broadcastScheduleUpdated(_data: unknown): void {
    const payload = "data: schedule_updated\n\n";
    const clients = getScheduleSSEClients(this.api);
    for (const send of clients) {
      try {
        send(payload);
      } catch {
        clients.delete(send);
      }
    }
  }

  /**
   * Register tool for AI to write schedules to agents
   */
  private registerTool(): void {
    this.api.tools.register({
      name: "schedule.writeSchedule",
      description: "Write or update a cron schedule for an agent. Updates the agent's static schedule property in its file and triggers hot reload.",
      parameters: {
        type: "object",
        properties: {
          agentName: {
            type: "string",
            description: "The name of the agent to update (e.g., 'tool-analytics', 'rss-to-telegram')",
          },
          schedule: {
            type: "string",
            description: "Cron expression in format: minute hour day month weekday (e.g., '0 */6 * * *' for every 6 hours)",
          },
        },
        required: ["agentName", "schedule"],
      },
      provider: "schedule-manager",
      handler: async (args: { agentName: string; schedule: string }, context) => {
        try {
          // Validate schedule
          const validation = validateCronExpression(args.schedule);
          if (!validation.valid) {
            return {
              success: false,
              data: null,
              metadata: {
                toolName: "schedule.writeSchedule",
                provider: "schedule-manager",
                duration: 0,
                cached: false,
                timestamp: Date.now(),
                callId: `call-${Date.now()}`,
              },
              error: `Invalid cron expression: ${validation.error}`,
            };
          }

          // Get agent metadata (use registry when available so we find the same agents shown in the UI)
          const agent = await this.resolveAgentMetadata(args.agentName);
          if (!agent) {
            return {
              success: false,
              data: null,
              metadata: {
                toolName: "schedule.writeSchedule",
                provider: "schedule-manager",
                duration: 0,
                cached: false,
                timestamp: Date.now(),
                callId: `call-${Date.now()}`,
              },
              error: `Agent ${args.agentName} not found`,
            };
          }

          // Update agent file
          const result = await this.updateAgentSchedule(args.agentName, args.schedule, agent);

          if (!result.success) {
            return {
              success: false,
              data: null,
              metadata: {
                toolName: "schedule.writeSchedule",
                provider: "schedule-manager",
                duration: 0,
                cached: false,
                timestamp: Date.now(),
                callId: `call-${Date.now()}`,
              },
              error: result.error,
            };
          }

          // Wait for file system sync
          await new Promise((resolve) => setTimeout(resolve, 200));

          const human = cronToHumanReadable(args.schedule);

          return {
            success: true,
            data: {
              agentName: args.agentName,
              schedule: args.schedule,
              description: human.summary,
              nextRuns: human.nextRuns.slice(0, 5),
              message: `Schedule updated for ${args.agentName}. Hot reload triggered.`,
            },
            metadata: {
              toolName: "schedule.writeSchedule",
              provider: "schedule-manager",
              duration: 200,
              cached: false,
              timestamp: Date.now(),
              callId: `call-${Date.now()}`,
            },
          };
        } catch (error) {
          return {
            success: false,
            data: null,
            metadata: {
              toolName: "schedule.writeSchedule",
              provider: "schedule-manager",
              duration: 0,
              cached: false,
              timestamp: Date.now(),
              callId: `call-${Date.now()}`,
            },
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    });
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    // Main UI route
    this.api.http.registerRoute("/schedule", async (req: Request) => {
      if (req.method === "GET") {
        return this.renderScheduleUI();
      }
      return new Response("Method not allowed", { status: 405 });
    });

    // API: Get all agents with schedules
    this.api.http.registerRoute("/api/schedule/agents", async (req: Request) => {
      if (req.method === "GET") {
        return this.handleGetAgents();
      }
      return new Response("Method not allowed", { status: 405 });
    });

    // API: Validate cron expression
    this.api.http.registerRoute("/api/schedule/validate", async (req: Request) => {
      if (req.method === "POST") {
        return this.handleValidateSchedule(req);
      }
      return new Response("Method not allowed", { status: 405 });
    });

    // API: Get preview for cron expression
    this.api.http.registerRoute("/api/schedule/preview", async (req: Request) => {
      if (req.method === "POST") {
        return this.handlePreviewSchedule(req);
      }
      return new Response("Method not allowed", { status: 405 });
    });

    // API: Apply schedule to agent file
    this.api.http.registerRoute("/api/schedule/apply", async (req: Request) => {
      if (req.method === "POST") {
        return this.handleApplySchedule(req);
      }
      return new Response("Method not allowed", { status: 405 });
    });

    // API: AI prompt to change schedule
    this.api.http.registerRoute("/api/schedule/ai-prompt", async (req: Request) => {
      if (req.method === "POST") {
        return this.handleAIPrompt(req);
      }
      return new Response("Method not allowed", { status: 405 });
    });

    // API: Get all tools with descriptions
    this.api.http.registerRoute("/api/schedule/tools", async (req: Request) => {
      if (req.method === "GET") {
        return this.handleGetTools();
      }
      return new Response("Method not allowed", { status: 405 });
    });

    // SSE: notify clients when a schedule is updated (shared client set survives hot reload)
    this.api.http.registerRoute("/api/schedule/events", (req: Request) => {
      if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      const clients = getScheduleSSEClients(this.api);
      const stream = new ReadableStream({
        start: (controller) => {
          const send = (data: string) => {
            try {
              controller.enqueue(new TextEncoder().encode(data));
            } catch {
              clients.delete(send);
            }
          };
          clients.add(send);
          req.signal?.addEventListener("abort", () => {
            clients.delete(send);
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    });

    console.log("[schedule-manager] Routes registered: /schedule, /api/schedule/*");
  }

  /**
   * Get all agents with their schedules (from registry when available so hot-reload changes are visible).
   */
  private async handleGetAgents(): Promise<Response> {
    try {
      const agents =
        typeof this.api.getAgents === "function"
          ? this.api.getAgents()
          : await this.loader.loadAllAgents(this.api);
      const agentsWithSchedules = agents
        .filter((agent) => agent.schedule)
        .map((agent) => {
          try {
            const validation = validateCronExpression(agent.schedule!);
            if (!validation.valid) {
              return {
                name: agent.name,
                filePath: agent.filePath,
                schedule: agent.schedule,
                description: `⚠️ Invalid schedule: ${validation.error}`,
                nextRuns: [],
                error: validation.error,
              };
            }
            const human = cronToHumanReadable(agent.schedule!);
            return {
              name: agent.name,
              filePath: agent.filePath,
              schedule: agent.schedule,
              description: human.summary,
              nextRuns: human.nextRuns.slice(0, 5),
            };
          } catch (err) {
            return {
              name: agent.name,
              filePath: agent.filePath,
              schedule: agent.schedule,
              description: `⚠️ Error parsing schedule: ${err instanceof Error ? err.message : String(err)}`,
              nextRuns: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }
        });

      return Response.json({ agents: agentsWithSchedules });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  /**
   * Validate a cron expression
   */
  private async handleValidateSchedule(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { expression } = body;

      if (!expression || typeof expression !== "string") {
        return Response.json({ error: "Expression is required" }, { status: 400 });
      }

      const validation = validateCronExpression(expression);
      return Response.json(validation);
    } catch (error) {
      return Response.json(
        { valid: false, error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  /**
   * Get preview for a cron expression
   */
  private async handlePreviewSchedule(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { expression } = body;

      if (!expression || typeof expression !== "string") {
        return Response.json({ error: "Expression is required" }, { status: 400 });
      }

      const validation = validateCronExpression(expression);
      if (!validation.valid) {
        return Response.json(validation);
      }

      const human = cronToHumanReadable(expression);
      return Response.json({
        valid: true,
        expression,
        description: human.summary,
        nextRuns: human.nextRuns.slice(0, 5),
        parts: human.parts,
      });
    } catch (error) {
      return Response.json(
        { valid: false, error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  /**
   * Apply schedule to agent file
   */
  private async handleApplySchedule(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { agentName, schedule } = body;

      if (!agentName || !schedule) {
        return Response.json(
          { success: false, error: "agentName and schedule are required" },
          { status: 400 }
        );
      }

      // Validate schedule
      const validation = validateCronExpression(schedule);
      if (!validation.valid) {
        return Response.json(
          { success: false, error: validation.error },
          { status: 400 }
        );
      }

      // Get agent metadata (use registry when available so we find the same agents shown in the UI)
      const agent = await this.resolveAgentMetadata(agentName);
      if (!agent) {
        return Response.json(
          { success: false, error: `Agent ${agentName} not found` },
          { status: 404 }
        );
      }

      // Update agent file
      const result = await this.updateAgentSchedule(agentName, schedule, agent);

      if (!result.success) {
        return Response.json(
          { success: false, error: result.error },
          { status: 500 }
        );
      }

      // Wait a bit for file system to sync
      await new Promise((resolve) => setTimeout(resolve, 200));

      return Response.json({
        success: true,
        message: `Schedule updated for ${agentName}. Hot reload triggered.`,
        reloaded: true,
      });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  }

  /**
   * Resolve agent metadata by name (registry when available, else loader).
   * Matches exact name first, then by file basename so e.g. "gvec" finds an agent from gvec.ts even if registry name is the class name.
   */
  private async resolveAgentMetadata(agentName: string): Promise<AgentMetadata | null> {
    const byName = (a: { name: string; filePath?: string }) => a.name === agentName;
    const byFileBasename = (a: { name: string; filePath?: string }) => {
      if (!a.filePath) return false;
      const base = basename(a.filePath, ".ts").replace(/\.js$/, "");
      return base.toLowerCase() === agentName.toLowerCase();
    };

    if (typeof this.api.getAgents === "function") {
      const agents = this.api.getAgents();
      return agents.find(byName) ?? agents.find(byFileBasename) ?? null;
    }
    const agents = await this.loader.loadAllAgents(this.api);
    return agents.find(byName) ?? agents.find(byFileBasename) ?? null;
  }

  /**
   * Update agent schedule in file
   */
  private async updateAgentSchedule(
    agentName: string,
    schedule: string,
    agentMetadata: AgentMetadata
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const filePath = resolve(process.cwd(), agentMetadata.filePath);
      const content = await this.api.files.read(filePath);

      // Pattern to match: static schedule = "...";
      const scheduleRegex = /(static\s+schedule\s*=\s*)(["'])([^"']+)\2\s*;?/;
      const commentedScheduleRegex = /(\/\/\s*static\s+schedule\s*=\s*)(["'])([^"']+)\2\s*;?/;

      let newContent: string;

      // Check if schedule exists (commented or not)
      if (scheduleRegex.test(content)) {
        // Replace existing schedule
        newContent = content.replace(scheduleRegex, `static schedule = "${schedule}";`);
      } else if (commentedScheduleRegex.test(content)) {
        // Uncomment and update
        newContent = content.replace(
          commentedScheduleRegex,
          `static schedule = "${schedule}";`
        );
      } else {
        // Find class declaration and insert after it
        const classRegex = /(export\s+default\s+class\s+\w+\s+extends\s+\w+\s*\{)/;
        if (classRegex.test(content)) {
          newContent = content.replace(
            classRegex,
            `$1\n  static schedule = "${schedule}";`
          );
        } else {
          return {
            success: false,
            error: "Could not find class declaration in agent file",
          };
        }
      }

      // Write file back
      await this.api.files.write(filePath, newContent);

      // Trigger hot reload for this file only (so we don't rely on fs watch)
      this.api.events.emit("agent_file_updated", { filePath }, "schedule-manager");

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle AI prompt to change schedule
   */
  private async handleAIPrompt(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { agentName, prompt } = body;

      if (!agentName || !prompt) {
        return Response.json(
          { success: false, error: "agentName and prompt are required" },
          { status: 400 }
        );
      }

      // Get agent metadata (use registry when available so external agents like gvec are found)
      const agent = await this.resolveAgentMetadata(agentName);
      if (!agent) {
        return Response.json(
          { success: false, error: `Agent ${agentName} not found` },
          { status: 404 }
        );
      }

      // Build context for AI
      const currentSchedule = agent.schedule || "none";
      const currentScheduleDesc = agent.schedule
        ? cronToHumanReadable(agent.schedule).summary
        : "No schedule set";

      const systemPrompt = `You are a cron schedule assistant. Your task is to convert natural language requests into valid cron expressions.

Current schedule for ${agentName}: ${currentSchedule} (${currentScheduleDesc})

User request: ${prompt}

You must:
1. Understand what schedule the user wants
2. Generate a valid cron expression
3. Use the schedule.writeSchedule tool to apply it

Cron format: minute hour day month weekday
- minute: 0-59 or * or */N
- hour: 0-23 or * or */N
- day: 1-31 or * or */N
- month: 1-12 or * or */N
- weekday: 0-6 (0=Sunday) or * or */N

Examples:
- "every 6 hours" → "0 */6 * * *"
- "daily at 9am" → "0 9 * * *"
- "every 15 minutes" → "*/15 * * * *"
- "weekdays at 9am" → "0 9 * * 1-5"
- "monthly on the 1st at midnight" → "0 0 1 * *"

Respond with a JSON object containing:
- schedule: the cron expression
- explanation: why you chose this schedule
- description: human-readable description`;

      // Call AI with tool
      const tools = this.api.tools.getSchemas();
      const scheduleTool = tools.find((t) => t.function.name === "schedule.writeSchedule");

      if (!scheduleTool) {
        return Response.json(
          { success: false, error: "Schedule tool not available" },
          { status: 500 }
        );
      }

      const response = await this.api.ai.chat(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Change the schedule for ${agentName} to: ${prompt}`,
          },
        ],
        {
          model: "smart",
          tools: [scheduleTool],
          temperature: 0.3,
        }
      );

      // Extract tool calls from response
      const toolCalls = (response as any).tool_calls || [];
      let result: any = {
        success: false,
        message: response.content || "No response from AI",
        toolCalls: [],
      };

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (toolCall.function.name === "schedule.writeSchedule") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            const toolResult = await this.api.tools.execute(
              "schedule.writeSchedule",
              args,
              {
                conversationId: `schedule-ai-${Date.now()}`,
                originalQuery: prompt,
              }
            );

            result.toolCalls.push({
              name: toolCall.function.name,
              arguments: args,
              result: toolResult,
            });

            if (toolResult.success) {
              result.success = true;
              result.message = `✅ Schedule updated: ${toolResult.data.description}`;
              result.schedule = toolResult.data.schedule;
              result.nextRuns = toolResult.data.nextRuns;
            } else {
              result.success = false;
              result.message = `❌ Failed: ${toolResult.error}`;
            }
          }
        }
      } else {
        // AI didn't call tool — try to extract a schedule from the response.
        // 1) Try parsing the response as JSON (the prompt asks for a JSON object with a "schedule" key)
        let extractedSchedule: string | null = null;

        try {
          const parsed = JSON.parse(response.content);
          if (parsed && typeof parsed.schedule === "string") {
            extractedSchedule = parsed.schedule.trim();
          }
        } catch {
          // Not valid JSON, fall through to regex
        }

        // 2) Regex fallback: match exactly 5 space-separated cron fields
        //    Each field is one or more of: digits, *, /, commas, hyphens
        if (!extractedSchedule) {
          const cronMatch = response.content.match(
            /([\d\*\/,\-]+\s+[\d\*\/,\-]+\s+[\d\*\/,\-]+\s+[\d\*\/,\-]+\s+[\d\*\/,\-]+)/
          );
          if (cronMatch) {
            extractedSchedule = cronMatch[1].trim();
          }
        }

        if (extractedSchedule) {
          const validation = validateCronExpression(extractedSchedule);
          if (validation.valid) {
            const toolResult = await this.api.tools.execute(
              "schedule.writeSchedule",
              { agentName, schedule: extractedSchedule },
              {
                conversationId: `schedule-ai-${Date.now()}`,
                originalQuery: prompt,
              }
            );

            if (toolResult.success) {
              result.success = true;
              result.message = `✅ Schedule updated: ${toolResult.data.description}`;
              result.schedule = toolResult.data.schedule;
              result.nextRuns = toolResult.data.nextRuns;
            } else {
              result.success = false;
              result.message = `❌ Failed: ${toolResult.error}`;
            }
          } else {
            result.message = `AI suggested invalid schedule: ${extractedSchedule}. ${validation.error}`;
          }
        }
      }

      return Response.json(result);
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  }

  /**
   * Get all tools with descriptions
   */
  private handleGetTools(): Response {
    try {
      const tools = this.api.tools.list();
      const toolsWithDescriptions = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        provider: tool.provider,
        riskLevel: tool.riskLevel,
        parameters: tool.parameters,
      }));

      return Response.json({ tools: toolsWithDescriptions });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  /**
   * Build the inline script for the schedule UI (separate method to avoid template literal
   * nesting issues that could cause server-side ReferenceError for identifiers in the script).
   */
  private buildScheduleScript(
    agentsWithSchedules: string[],
    allAgents: { name: string; hasSchedule: boolean }[],
    templates: Array<{ name: string; cron: string; description: string }>,
    themeColorSecondary: string
  ): string {
    const agentsStr = JSON.stringify(agentsWithSchedules);
    const allAgentsStr = JSON.stringify(allAgents);
    const templatesStr = JSON.stringify(templates);
    return `
    const agents = ${agentsStr};
    const allAgents = ${allAgentsStr};
    const templates = ${templatesStr};
    const THEME_COLOR = ${JSON.stringify(themeColorSecondary)};

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tabName).classList.add('active');
        if (tabName === 'overview') loadAgents();
        else if (tabName === 'templates') loadTemplates();
        else if (tabName === 'tools') loadTools();
      });
    });

    document.querySelectorAll('.mode-button').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        document.querySelectorAll('.mode-button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('visual-builder').style.display = mode === 'visual' ? 'block' : 'none';
        document.getElementById('table-builder').style.display = mode === 'visual' ? 'none' : 'block';
        updatePreview();
      });
    });

    async function loadAgents() {
      try {
        const res = await fetch('/api/schedule/agents');
        const data = await res.json();
        const listEl = document.getElementById('agent-list');
        if (data.agents && data.agents.length > 0) {
          listEl.innerHTML = data.agents.map(agent => '<div class="agent-card"><h3>' + agent.name + '</h3><div class="schedule">' + agent.schedule + '</div><div class="description">' + agent.description + '</div>' + (agent.error ? '<div class="schedule-error">⚠️ ' + agent.error + '</div>' : '') + (agent.nextRuns && agent.nextRuns.length > 0 ? '<div class="next-runs"><strong>Next runs:</strong><ul>' + agent.nextRuns.map(run => '<li>' + run + '</li>').join('') + '</ul></div>' : '') + '<div class="ai-prompt-section"><strong style="font-size: 0.8125rem; color: ' + THEME_COLOR + ';">🤖 AI Schedule Change:</strong><div class="ai-prompt-input"><input type="text" id="ai-prompt-' + agent.name + '" placeholder="e.g. change to every 15 minutes" /><button class="ai-prompt-button" onclick="aiPromptSchedule(\\'' + agent.name + '\\')">Apply</button></div><div id="ai-result-' + agent.name + '" class="ai-result" style="display:none;"></div></div></div>').join('');
        } else listEl.innerHTML = '<p>No agents with schedules found.</p>';
      } catch (e) { listEl.innerHTML = '<p class="error-message">Error loading agents</p>'; }
    }

    async function loadTools() {
      try {
        const res = await fetch('/api/schedule/tools');
        const data = await res.json();
        const listEl = document.getElementById('tools-list');
        if (data.tools && data.tools.length > 0) listEl.innerHTML = data.tools.map(tool => '<div class="tool-card"><h4>' + tool.name + '</h4><div class="tool-name">' + tool.name + '</div><div class="tool-description">' + tool.description + '</div><div class="tool-meta">Provider: ' + tool.provider + ' | Risk: ' + tool.riskLevel + '</div></div>').join('');
        else listEl.innerHTML = '<p>No tools found.</p>';
      } catch (e) { listEl.innerHTML = '<p class="error-message">Error loading tools</p>'; }
    }

    async function aiPromptSchedule(agentName) {
      const promptInput = document.getElementById('ai-prompt-' + agentName);
      const resultEl = document.getElementById('ai-result-' + agentName);
      const prompt = promptInput.value.trim();
      if (!prompt) { resultEl.style.display = 'block'; resultEl.className = 'ai-result error'; resultEl.textContent = 'Please enter a prompt'; return; }
      resultEl.style.display = 'block'; resultEl.className = 'ai-result'; resultEl.textContent = 'Processing...';
      try {
        const res = await fetch('/api/schedule/ai-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentName, prompt }) });
        const data = await res.json();
        if (data.success) { resultEl.className = 'ai-result success'; resultEl.innerHTML = '<strong>✅ Success!</strong><br>' + data.message + '<br>' + (data.schedule ? 'Schedule: ' + data.schedule + '<br>' : '') + (data.nextRuns && data.nextRuns.length ? 'Next runs: ' + data.nextRuns.join(', ') : ''); promptInput.value = ''; loadAgents(); setTimeout(loadAgents, 600); }
        else { resultEl.className = 'ai-result error'; resultEl.innerHTML = '<strong>❌ Failed</strong><br>' + (data.message || data.error || 'Unknown error'); }
      } catch (e) { resultEl.className = 'ai-result error'; resultEl.textContent = 'Error: ' + (e.message || 'Unknown error'); }
    }

    function loadTemplates() {
      document.getElementById('template-grid').innerHTML = templates.map(t => '<div class="template-card" onclick="selectTemplate(\\'' + t.cron + '\\')"><h4>' + t.name + '</h4><div class="cron">' + t.cron + '</div><div class="desc">' + t.description + '</div></div>').join('');
    }
    function selectTemplate(cron) {
      const parts = cron.split(' ');
      document.getElementById('table-minute').value = parts[0];
      document.getElementById('table-hour').value = parts[1];
      document.getElementById('table-day').value = parts[2];
      document.getElementById('table-month').value = parts[3];
      document.getElementById('table-weekday').value = parts[4];
      document.querySelector('[data-mode="table"]').click();
      updatePreview();
      document.querySelector('[data-tab="builder"]').click();
    }

    async function updatePreview() {
      const expression = getCurrentExpression();
      if (!expression) { document.getElementById('validation-error').style.display = 'block'; document.getElementById('validation-error').textContent = 'Invalid expression'; return; }
      try {
        const res = await fetch('/api/schedule/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expression }) });
        const data = await res.json();
        if (data.valid) {
          document.getElementById('cron-expression').textContent = data.expression;
          document.getElementById('description').textContent = data.description;
          document.getElementById('code-snippet').textContent = 'static schedule = "' + data.expression + '";';
          document.getElementById('next-runs').innerHTML = data.nextRuns.map(run => '<li>' + run + '</li>').join('');
          document.getElementById('validation-error').style.display = 'none';
        } else { document.getElementById('validation-error').style.display = 'block'; document.getElementById('validation-error').textContent = data.error || 'Invalid expression'; }
      } catch (e) { document.getElementById('validation-error').style.display = 'block'; document.getElementById('validation-error').textContent = 'Error validating expression'; }
    }

    function getCurrentExpression() {
      try {
        var visualMode = document.getElementById('visual-builder').style.display !== 'none';
        var intervalVal = 1, minuteVal = 0;
        var el = document.getElementById('interval-value');
        if (el) intervalVal = parseInt(el.value, 10) || 1;
        el = document.getElementById('minute-value');
        if (el) minuteVal = parseInt(el.value, 10) || 0;
        if (visualMode) {
          var freqType = document.getElementById('frequency-type').value;
          var timeInput = document.getElementById('specific-time').value || '09:00';
          if (freqType === 'minutes') return '*/' + String(intervalVal) + ' * * * *';
          if (freqType === 'hours') return String(minuteVal) + ' */' + String(intervalVal) + ' * * *';
          if (freqType === 'days') return String(minuteVal) + ' 0 */' + String(intervalVal) + ' * * *';
          if (freqType === 'specific') { var p = timeInput.split(':'); return String(parseInt(p[1],10)||0) + ' ' + String(parseInt(p[0],10)||9) + ' * * *'; }
          if (freqType === 'weekdays') return String(minuteVal) + ' 9 * * 1-5';
        } else {
          var minute = (document.getElementById('table-minute') && document.getElementById('table-minute').value) || '*';
          var hour = (document.getElementById('table-hour') && document.getElementById('table-hour').value) || '*';
          var day = (document.getElementById('table-day') && document.getElementById('table-day').value) || '*';
          var month = (document.getElementById('table-month') && document.getElementById('table-month').value) || '*';
          var weekday = (document.getElementById('table-weekday') && document.getElementById('table-weekday').value) || '*';
          return minute + ' ' + hour + ' ' + day + ' ' + month + ' ' + weekday;
        }
      } catch (e) { return null; }
      return null;
    }

    function copyExpression() { var t = document.getElementById('cron-expression').textContent; navigator.clipboard.writeText(t); var b = event.target; var o = b.textContent; b.textContent = 'Copied!'; setTimeout(function(){ b.textContent = o; }, 2000); }
    function copyCode() { var t = document.getElementById('code-snippet').textContent; navigator.clipboard.writeText(t); var b = event.target; var o = b.textContent; b.textContent = 'Copied!'; setTimeout(function(){ b.textContent = o; }, 2000); }

    async function applySchedule() {
      var agentName = document.getElementById('agent-selector').value;
      var expression = getCurrentExpression();
      var messageEl = document.getElementById('apply-message');
      var buttonEl = document.getElementById('apply-button');
      if (!agentName) { messageEl.innerHTML = '<div class="error-message">Please select an agent</div>'; return; }
      if (!expression) { messageEl.innerHTML = '<div class="error-message">Invalid schedule expression</div>'; return; }
      buttonEl.disabled = true; buttonEl.textContent = 'Applying...'; messageEl.innerHTML = '';
      try {
        var res = await fetch('/api/schedule/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentName, schedule: expression }) });
        var data = await res.json();
        if (data.success) { messageEl.innerHTML = '<div class="success-message">' + data.message + '</div>'; loadAgents(); setTimeout(loadAgents, 600); }
        else messageEl.innerHTML = '<div class="error-message">' + (data.error || 'Failed to apply schedule') + '</div>';
      } catch (e) { messageEl.innerHTML = '<div class="error-message">Error applying schedule</div>'; }
      buttonEl.disabled = false; buttonEl.textContent = '✅ Apply Changes & Reload';
    }

    document.getElementById('frequency-type').addEventListener('change', function() {
      var freqType = document.getElementById('frequency-type').value;
      document.getElementById('interval-group').style.display = freqType === 'specific' ? 'none' : 'block';
      document.getElementById('time-group').style.display = freqType === 'specific' ? 'block' : 'none';
      document.getElementById('minute-group').style.display = freqType === 'minutes' ? 'none' : 'block';
      updatePreview();
    });
    document.getElementById('interval-value').addEventListener('input', updatePreview);
    document.getElementById('minute-value').addEventListener('input', updatePreview);
    document.getElementById('specific-time').addEventListener('change', updatePreview);
    document.getElementById('table-minute').addEventListener('input', updatePreview);
    document.getElementById('table-hour').addEventListener('input', updatePreview);
    document.getElementById('table-day').addEventListener('input', updatePreview);
    document.getElementById('table-month').addEventListener('input', updatePreview);
    document.getElementById('table-weekday').addEventListener('input', updatePreview);

    try {
      var scheduleEvents = new EventSource('/api/schedule/events');
      scheduleEvents.onmessage = function() { loadAgents(); };
    } catch (e) {}

    loadAgents(); loadTemplates(); loadTools(); updatePreview();
    `;
  }

  /**
   * Render the schedule management UI (uses registry when available so hot-reload changes are visible).
   */
  private async renderScheduleUI(): Promise<Response> {
    const agents =
      typeof this.api.getAgents === "function"
        ? this.api.getAgents()
        : await this.loader.loadAllAgents(this.api);
    const agentsWithSchedules = agents.filter((a) => a.schedule).map((a) => a.name);
    const allAgents = agents.map((a) => ({ name: a.name, hasSchedule: !!a.schedule }));

    const scriptContent = this.buildScheduleScript(
      agentsWithSchedules,
      allAgents,
      getCommonSchedules(),
      roninTheme.colors.textSecondary
    );

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Schedule Manager - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(roninTheme)}
    ${getHeaderBarCSS(roninTheme)}
    
    body {
      padding: 0;
      margin: 0;
    }

    .page-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.lg};
    }

    .tabs {
      display: flex;
      gap: ${roninTheme.spacing.sm};
      border-bottom: 1px solid ${roninTheme.colors.border};
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .tab {
      padding: ${roninTheme.spacing.md} ${roninTheme.spacing.lg};
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: ${roninTheme.colors.textSecondary};
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.2s;
    }

    .tab:hover {
      color: ${roninTheme.colors.textPrimary};
    }

    .tab.active {
      color: ${roninTheme.colors.link};
      border-bottom-color: ${roninTheme.colors.link};
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .agent-list {
      display: grid;
      gap: ${roninTheme.spacing.md};
    }

    .agent-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.lg};
      transition: all 0.3s;
    }

    .agent-card:hover {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.backgroundTertiary};
    }

    .agent-card h3 {
      margin: 0 0 ${roninTheme.spacing.sm} 0;
      color: ${roninTheme.colors.link};
    }

    .agent-card .schedule {
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.875rem;
      color: ${roninTheme.colors.textSecondary};
      margin: ${roninTheme.spacing.sm} 0;
    }

    .agent-card .description {
      color: ${roninTheme.colors.textSecondary};
      margin: ${roninTheme.spacing.sm} 0;
    }

    .agent-card .next-runs {
      margin-top: ${roninTheme.spacing.md};
      font-size: 0.8125rem;
      color: ${roninTheme.colors.textTertiary};
    }

    .agent-card .next-runs ul {
      margin: ${roninTheme.spacing.xs} 0 0 0;
      padding-left: ${roninTheme.spacing.lg};
    }

    .builder-mode-selector {
      display: flex;
      gap: ${roninTheme.spacing.sm};
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .mode-button {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
      cursor: pointer;
      border-radius: ${roninTheme.borderRadius.md};
      transition: all 0.2s;
    }

    .mode-button:hover {
      background: ${roninTheme.colors.backgroundTertiary};
      border-color: ${roninTheme.colors.borderHover};
    }

    .mode-button.active {
      background: ${roninTheme.colors.backgroundTertiary};
      border-color: ${roninTheme.colors.link};
      color: ${roninTheme.colors.link};
    }

    .builder-section {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .builder-section h3 {
      margin: 0 0 ${roninTheme.spacing.md} 0;
      color: ${roninTheme.colors.textPrimary};
      font-size: 1rem;
    }

    .form-group {
      margin-bottom: ${roninTheme.spacing.md};
    }

    .form-group label {
      display: block;
      margin-bottom: ${roninTheme.spacing.xs};
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.8125rem;
    }

    .form-group select,
    .form-group input {
      width: 100%;
    }

    .table-editor {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: ${roninTheme.spacing.md};
      margin-bottom: ${roninTheme.spacing.md};
    }

    .table-field {
      display: flex;
      flex-direction: column;
    }

    .table-field label {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
      margin-bottom: ${roninTheme.spacing.xs};
    }

    .table-field input {
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.875rem;
    }

    .preview-section {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .preview-section h3 {
      margin: 0 0 ${roninTheme.spacing.md} 0;
      color: ${roninTheme.colors.textPrimary};
      font-size: 1rem;
    }

    .cron-expression {
      font-family: ${roninTheme.fonts.mono};
      font-size: 1rem;
      background: ${roninTheme.colors.background};
      padding: ${roninTheme.spacing.md};
      border-radius: ${roninTheme.borderRadius.sm};
      margin: ${roninTheme.spacing.sm} 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .copy-button {
      padding: ${roninTheme.spacing.xs} ${roninTheme.spacing.sm};
      font-size: 0.75rem;
      background: ${roninTheme.colors.backgroundTertiary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
      cursor: pointer;
      border-radius: ${roninTheme.borderRadius.sm};
      transition: all 0.2s;
    }

    .copy-button:hover {
      background: ${roninTheme.colors.backgroundSecondary};
      border-color: ${roninTheme.colors.borderHover};
      color: ${roninTheme.colors.textPrimary};
    }

    .description-text {
      color: ${roninTheme.colors.textSecondary};
      margin: ${roninTheme.spacing.sm} 0;
    }

    .next-runs-list {
      list-style: none;
      padding: 0;
      margin: ${roninTheme.spacing.sm} 0 0 0;
    }

    .next-runs-list li {
      padding: ${roninTheme.spacing.xs} 0;
      color: ${roninTheme.colors.textTertiary};
      font-size: 0.8125rem;
    }

    .code-snippet {
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.8125rem;
      background: ${roninTheme.colors.background};
      padding: ${roninTheme.spacing.md};
      border-radius: ${roninTheme.borderRadius.sm};
      margin: ${roninTheme.spacing.sm} 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: ${roninTheme.colors.textSecondary};
    }

    .apply-section {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .apply-section h3 {
      margin: 0 0 ${roninTheme.spacing.md} 0;
      color: ${roninTheme.colors.textPrimary};
      font-size: 1rem;
    }

    .apply-button {
      padding: ${roninTheme.spacing.md} ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.link};
      border: none;
      color: ${roninTheme.colors.background};
      font-weight: 500;
      cursor: pointer;
      border-radius: ${roninTheme.borderRadius.md};
      transition: all 0.2s;
      margin-top: ${roninTheme.spacing.md};
    }

    .apply-button:hover:not(:disabled) {
      background: ${roninTheme.colors.linkHover};
    }

    .apply-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error-message {
      color: ${roninTheme.colors.error};
      font-size: 0.8125rem;
      margin-top: ${roninTheme.spacing.sm};
    }

    .success-message {
      color: ${roninTheme.colors.success};
      font-size: 0.8125rem;
      margin-top: ${roninTheme.spacing.sm};
    }

    .template-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: ${roninTheme.spacing.md};
    }

    .template-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
      cursor: pointer;
      transition: all 0.2s;
    }

    .template-card:hover {
      border-color: ${roninTheme.colors.link};
      background: ${roninTheme.colors.backgroundTertiary};
    }

    .template-card h4 {
      margin: 0 0 ${roninTheme.spacing.xs} 0;
      color: ${roninTheme.colors.link};
      font-size: 0.875rem;
    }

    .template-card .cron {
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
      margin: ${roninTheme.spacing.xs} 0;
    }

    .template-card .desc {
      font-size: 0.8125rem;
      color: ${roninTheme.colors.textTertiary};
    }

    .ai-prompt-section {
      margin-top: ${roninTheme.spacing.md};
      padding-top: ${roninTheme.spacing.md};
      border-top: 1px solid ${roninTheme.colors.border};
    }

    .ai-prompt-input {
      display: flex;
      gap: ${roninTheme.spacing.sm};
      margin-top: ${roninTheme.spacing.sm};
    }

    .ai-prompt-input input {
      flex: 1;
    }

    .ai-prompt-button {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.link};
      border: none;
      color: ${roninTheme.colors.background};
      cursor: pointer;
      border-radius: ${roninTheme.borderRadius.md};
      font-size: 0.8125rem;
    }

    .ai-prompt-button:hover:not(:disabled) {
      background: ${roninTheme.colors.linkHover};
    }

    .ai-prompt-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .ai-result {
      margin-top: ${roninTheme.spacing.sm};
      padding: ${roninTheme.spacing.sm};
      border-radius: ${roninTheme.borderRadius.sm};
      font-size: 0.8125rem;
    }

    .ai-result.success {
      background: rgba(40, 167, 69, 0.1);
      color: ${roninTheme.colors.success};
      border: 1px solid ${roninTheme.colors.success};
    }

    .ai-result.error {
      background: rgba(220, 53, 69, 0.1);
      color: ${roninTheme.colors.error};
      border: 1px solid ${roninTheme.colors.error};
    }

    .tools-list {
      display: grid;
      gap: ${roninTheme.spacing.md};
    }

    .tool-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
    }

    .tool-card h4 {
      margin: 0 0 ${roninTheme.spacing.xs} 0;
      color: ${roninTheme.colors.link};
      font-size: 0.875rem;
    }

    .tool-card .tool-name {
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
      margin-bottom: ${roninTheme.spacing.xs};
    }

    .tool-card .tool-description {
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.8125rem;
      margin-bottom: ${roninTheme.spacing.xs};
    }

    .tool-card .tool-meta {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
    }

    .schedule-error {
      color: ${roninTheme.colors.error};
      font-size: 0.8125rem;
      margin-top: ${roninTheme.spacing.xs};
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>🕐 Schedule Manager</h1>
    <div class="header-meta">
      <span>Manage cron schedules</span>
    </div>
  </div>

  <div class="page-content">
    <div class="tabs">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="builder">Builder</button>
      <button class="tab" data-tab="templates">Templates</button>
      <button class="tab" data-tab="tools">Tools</button>
    </div>

    <!-- Overview Tab -->
    <div class="tab-content active" id="overview">
      <div class="agent-list" id="agent-list">
        <p>Loading agents...</p>
      </div>
    </div>

    <!-- Builder Tab -->
    <div class="tab-content" id="builder">
      <div class="builder-mode-selector">
        <button class="mode-button active" data-mode="visual">🎨 Visual Builder</button>
        <button class="mode-button" data-mode="table">📋 Table Editor</button>
      </div>

      <!-- Visual Builder -->
      <div class="builder-section" id="visual-builder">
        <h3>Visual Builder</h3>
        <div class="form-group">
          <label>Frequency</label>
          <select id="frequency-type">
            <option value="minutes">Every N minutes</option>
            <option value="hours">Every N hours</option>
            <option value="days">Every N days</option>
            <option value="specific">At specific time</option>
            <option value="weekdays">Weekdays only</option>
          </select>
        </div>
        <div class="form-group" id="interval-group">
          <label>Interval</label>
          <input type="number" id="interval-value" min="1" value="6" />
        </div>
        <div class="form-group" id="time-group" style="display: none;">
          <label>Time (HH:MM)</label>
          <input type="time" id="specific-time" value="09:00" />
        </div>
        <div class="form-group" id="minute-group">
          <label>At minute</label>
          <input type="number" id="minute-value" min="0" max="59" value="0" />
        </div>
      </div>

      <!-- Table Editor -->
      <div class="builder-section" id="table-builder" style="display: none;">
        <h3>Table Editor</h3>
        <div class="table-editor">
          <div class="table-field">
            <label>Minute (0-59)</label>
            <input type="text" id="table-minute" value="0" />
          </div>
          <div class="table-field">
            <label>Hour (0-23)</label>
            <input type="text" id="table-hour" value="*" />
          </div>
          <div class="table-field">
            <label>Day (1-31)</label>
            <input type="text" id="table-day" value="*" />
          </div>
          <div class="table-field">
            <label>Month (1-12)</label>
            <input type="text" id="table-month" value="*" />
          </div>
          <div class="table-field">
            <label>Weekday (0-6)</label>
            <input type="text" id="table-weekday" value="*" />
          </div>
        </div>
        <p style="font-size: 0.75rem; color: ${roninTheme.colors.textTertiary}; margin-top: ${roninTheme.spacing.md};">
          💡 Tips: Use * for "every", */N for "every N units", or a number for specific value. Weekday: 0=Sun, 1=Mon, ..., 6=Sat
        </p>
      </div>

      <!-- Preview Section -->
      <div class="preview-section">
        <h3>Preview</h3>
        <div class="cron-expression">
          <span id="cron-expression">0 */6 * * *</span>
          <button class="copy-button" onclick="copyExpression()">Copy</button>
        </div>
        <div class="description-text" id="description">At the start of every 6 hours</div>
        <div id="next-runs-container">
          <strong style="font-size: 0.8125rem; color: ${roninTheme.colors.textSecondary};">Next runs:</strong>
          <ul class="next-runs-list" id="next-runs"></ul>
        </div>
        <div id="validation-error" class="error-message" style="display: none;"></div>
      </div>

      <!-- Code Snippet -->
      <div class="preview-section">
        <h3>Code Snippet</h3>
        <div class="code-snippet">
          <code id="code-snippet">static schedule = "0 */6 * * *";</code>
          <button class="copy-button" onclick="copyCode()">Copy Code</button>
        </div>
      </div>

      <!-- Apply Section -->
      <div class="apply-section">
        <h3>Apply Changes</h3>
        <div class="form-group">
          <label>Select Agent</label>
          <select id="agent-selector">
            <option value="">-- Select an agent --</option>
            ${allAgents.map((a) => `<option value="${a.name}">${a.name}${a.hasSchedule ? " (has schedule)" : ""}</option>`).join("")}
          </select>
        </div>
        <button class="apply-button" id="apply-button" onclick="applySchedule()">✅ Apply Changes & Reload</button>
        <div id="apply-message"></div>
      </div>
    </div>

    <!-- Templates Tab -->
    <div class="tab-content" id="templates">
      <div class="template-grid" id="template-grid"></div>
    </div>

    <!-- Tools Tab -->
    <div class="tab-content" id="tools">
      <div class="tools-list" id="tools-list">
        <p>Loading tools...</p>
      </div>
    </div>
  </div>

  <script>${scriptContent}
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  }
}
