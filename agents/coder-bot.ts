import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { join } from "path";
import { homedir } from "os";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";

interface PlanApprovedPayload {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
  approvedAt?: number;
  approvedBy?: string;
}

interface CLIConfig {
  defaultCLI: string;
  defaultAppsDirectory: string;
  apps: Record<string, string>;
  cliOptions: Record<string, { timeout?: number; model?: string }>;
}

interface CLIResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Coder Bot Agent
 * 
 * Enhanced reactor with tag-driven CLI execution
 * - Parses tags: #build, #auto, #qwen, #cursor, #app-name
 * - Sequential execution queue
 * - Progress events (PlanInProgress)
 * - Saves output to ~/.ronin/cli/builds/
 * 
 * NEVER touches Kanban - only emits events
 */
export default class CoderBotAgent extends BaseAgent {
  private executionQueue: string[] = [];
  private isExecuting = false;
  private cliPlugins: Record<string, string> = {
    qwen: "qwen-cli",
    cursor: "cursor-cli",
    opencode: "opencode-cli",
    gemini: "gemini-cli",
  };
  private cliStatus: Record<string, boolean> = {};

  constructor(api: AgentAPI) {
    super(api);
    this.registerEventHandlers();
    this.checkCLIInstallations();
    console.log("🤖 Coder Bot ready. Listening for PlanApproved events...");
  }

  /**
   * Check CLI installations at startup
   */
  private async checkCLIInstallations(): Promise<void> {
    console.log("[coder-bot] Checking CLI installations...");

    for (const [cli, pluginName] of Object.entries(this.cliPlugins)) {
      if (this.api.plugins.has(pluginName)) {
        try {
          const installed = await this.api.plugins.call(pluginName, "checkInstallation");
          this.cliStatus[cli] = installed;
          
          if (installed) {
            console.log(`[coder-bot] ✅ ${cli} installed`);
          } else {
            const instructions = await this.api.plugins.call(pluginName, "getInstallInstructions");
            console.log(`[coder-bot] ⚠️  ${cli} not installed`);
            console.log(instructions.split("\n").map((line: string) => `    ${line}`).join("\n"));
          }
        } catch (error) {
          console.error(`[coder-bot] ❌ Error checking ${cli}:`, error);
          this.cliStatus[cli] = false;
        }
      } else {
        console.log(`[coder-bot] ⚠️  ${cli} plugin not loaded`);
        this.cliStatus[cli] = false;
      }
    }
  }

  /**
   * Register event handlers
   */
  private registerEventHandlers(): void {
    this.api.events.on("PlanApproved", (data: unknown) => {
      const payload = data as PlanApprovedPayload;
      this.handlePlanApproved(payload);
    });

    console.log("[coder-bot] Event handlers registered");
  }

  /**
   * Handle PlanApproved: Queue and execute
   */
  private async handlePlanApproved(payload: PlanApprovedPayload): Promise<void> {
    console.log(`[coder-bot] Received PlanApproved: ${payload.id}`);

    // Check for #build tag
    const hasBuildTag = payload.tags?.includes("build");
    if (!hasBuildTag) {
      console.log(`[coder-bot] No #build tag, skipping execution for ${payload.id}`);
      return;
    }

    // Add to queue
    this.executionQueue.push(payload.id);
    console.log(`[coder-bot] Added ${payload.id} to queue. Queue length: ${this.executionQueue.length}`);

    // Process queue
    await this.processQueue(payload);
  }

  /**
   * Process execution queue sequentially
   */
  private async processQueue(payload: PlanApprovedPayload): Promise<void> {
    if (this.isExecuting) {
      console.log(`[coder-bot] Queue busy, waiting...`);
      return;
    }

    this.isExecuting = true;

    try {
      await this.executePlan(payload);
    } finally {
      this.isExecuting = false;
      
      // Process next if any
      if (this.executionQueue.length > 0) {
        const nextId = this.executionQueue[0];
        console.log(`[coder-bot] Processing next: ${nextId}`);
        // Note: In a real implementation, we'd need to retrieve the full payload
        // For now, this is a simplified version
      }
    }
  }

  /**
   * Execute a plan
   */
  private async executePlan(payload: PlanApprovedPayload): Promise<void> {
    const planId = payload.id;

    // Emit starting progress
    this.api.events.emit("PlanInProgress", {
      id: planId,
      status: "starting",
      message: "Initializing CLI execution...",
      timestamp: Date.now(),
    }, "coder-bot");

    try {
      // Load config
      const config = await this.loadConfig();

      // Determine CLI from tags or config
      const cliTag = payload.tags?.find((tag) => this.cliPlugins[tag]);
      const pluginName = cliTag
        ? this.cliPlugins[cliTag]
        : `${config.defaultCLI || "qwen"}-cli`;

      // Check CLI is available
      if (!this.api.plugins.has(pluginName)) {
        throw new Error(`CLI plugin not found: ${pluginName}`);
      }

      const cli = cliTag || config.defaultCLI || "qwen";
      if (!this.cliStatus[cli]) {
        const instructions = await this.api.plugins.call(pluginName, "getInstallInstructions");
        throw new Error(`${cli} CLI not installed.\n${instructions}`);
      }

      // Determine workspace from #app-* tag
      const appTag = payload.tags?.find((tag) => tag.startsWith("app-"));
      const workspace = await this.resolveWorkspace(appTag, config);

      // Emit executing progress
      this.api.events.emit("PlanInProgress", {
        id: planId,
        status: "executing",
        message: `Running ${cli} CLI...`,
        cli,
        workspace,
        timestamp: Date.now(),
      }, "coder-bot");

      // Execute CLI
      const cliOptions = config.cliOptions?.[cli] || {};
      const result = (await this.api.plugins.call(
        pluginName,
        "execute",
        payload.description || "",
        {
          workspace,
          ...cliOptions,
        }
      )) as CLIResult;

      // Save output to file
      const outputPath = await this.saveOutput(planId, result);

      if (result.success) {
        // Emit completed
        this.api.events.emit("PlanCompleted", {
          id: planId,
          result: result.output,
          outputPath,
          executedBy: cli,
          workspace,
          completedAt: Date.now(),
        }, "coder-bot");

        console.log(`[coder-bot] ✅ PlanCompleted: ${planId}`);
      } else {
        throw new Error(result.error || "CLI execution failed");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Save error output
      await this.saveOutput(planId, {
        success: false,
        output: "",
        error: errorMessage,
      });

      // Emit failed
      this.api.events.emit("PlanFailed", {
        id: planId,
        error: errorMessage,
        failedAt: Date.now(),
        failedBy: "coder-bot",
      }, "coder-bot");

      console.error(`[coder-bot] ❌ PlanFailed: ${planId}`, errorMessage);
    }
  }

  /**
   * Load configuration from ~/.ronin/config.json
   */
  private async loadConfig(): Promise<CLIConfig> {
    // Use centralized config service
    const config = this.api.config.getAll();
    
    return {
      defaultCLI: config.defaultCLI,
      defaultAppsDirectory: config.defaultAppsDirectory,
      apps: config.apps,
      cliOptions: config.cliOptions,
    };
  }

  /**
   * Resolve workspace from app tag or default
   */
  private async resolveWorkspace(
    appTag: string | undefined,
    config: CLIConfig
  ): Promise<string> {
    if (!appTag) {
      return process.cwd();
    }

    const appName = appTag.replace("app-", "");

    // 1. Check config.apps
    if (config.apps?.[appName]) {
      return config.apps[appName];
    }

    // 2. Check defaultAppsDirectory
    const appsDir = config.defaultAppsDirectory || join(homedir(), ".ronin", "apps");
    const appPath = join(appsDir, appName);

    if (existsSync(appPath)) {
      return appPath;
    }

    // 3. Create if doesn't exist
    await mkdir(appPath, { recursive: true });
    console.log(`[coder-bot] Created app workspace: ${appPath}`);
    return appPath;
  }

  /**
   * Save CLI output to file
   */
  private async saveOutput(
    planId: string,
    result: CLIResult
  ): Promise<string> {
    const buildsDir = join(homedir(), ".ronin", "cli", "builds", planId);
    await mkdir(buildsDir, { recursive: true });

    // Save output
    const outputPath = join(buildsDir, "output.log");
    await writeFile(outputPath, result.output || "", "utf-8");

    // Save result metadata
    const resultPath = join(buildsDir, "result.json");
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          planId,
          success: result.success,
          timestamp: Date.now(),
          outputPath,
          error: result.error,
        },
        null,
        2
      ),
      "utf-8"
    );

    return outputPath;
  }

  async execute(): Promise<void> {
    // This agent is event-driven
    console.log("[coder-bot] Running...");
  }
}
