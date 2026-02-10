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
 * Coder Bot Agent - Silent Execution Model
 * 
 * Executes plans without user interaction using sensible defaults.
 * All decisions and results are logged to the task description.
 * 
 * Workflow:
 * 1. Receives PlanApproved with #create or #build tag
 * 2. Enhances prompt with sensible defaults
 * 3. Executes CLI (no blocking, no questions)
 * 4. Appends results to task description
 * 5. Triggers hot reload for agents
 * 6. Reports success/failure
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
  private maxRetries = 1;

  constructor(api: AgentAPI) {
    super(api);
    this.registerEventHandlers();
    this.checkCLIInstallations();
    console.log("🤖 Coder Bot ready. Silent execution mode enabled.");
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
            console.log(`[coder-bot] ⚠️  ${cli} not installed`);
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

    // Check for #create or #build tag
    const hasBuildTag = payload.tags?.includes("build") || payload.tags?.includes("create");
    if (!hasBuildTag) {
      console.log(`[coder-bot] No #create or #build tag, skipping execution for ${payload.id}`);
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
      await this.executePlanWithRetry(payload);
    } finally {
      this.isExecuting = false;
      
      // Process next if any
      if (this.executionQueue.length > 0) {
        const nextId = this.executionQueue[0];
        console.log(`[coder-bot] Processing next: ${nextId}`);
      }
    }
  }

  /**
   * Execute a plan with retry logic
   */
  private async executePlanWithRetry(payload: PlanApprovedPayload, attempt: number = 1): Promise<void> {
    try {
      await this.executePlan(payload, attempt);
    } catch (error) {
      if (attempt <= this.maxRetries) {
        console.log(`[coder-bot] Retrying ${payload.id} (attempt ${attempt + 1})...`);
        await this.appendToTask(payload.id, `
═══════════════════════════════════════════════════
[RETRY ATTEMPT ${attempt + 1}]
Previous error: ${error instanceof Error ? error.message : String(error)}
═══════════════════════════════════════════════════
`);
        await this.executePlanWithRetry(payload, attempt + 1);
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute a plan
   */
  private async executePlan(payload: PlanApprovedPayload, attempt: number = 1): Promise<void> {
    const planId = payload.id;

    // Emit starting progress
    this.api.events.emit("PlanInProgress", {
      id: planId,
      status: "starting",
      message: `Initializing CLI execution (attempt ${attempt})...`,
      timestamp: Date.now(),
    }, "coder-bot");

    // Initialize task log
    await this.appendToTask(planId, `
═══════════════════════════════════════════════════
[EXECUTION ATTEMPT ${attempt}]
Started: ${new Date().toISOString()}
CLI: Determining...
Status: 🔄 Executing
═══════════════════════════════════════════════════
`);

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

      // Enhance prompt with sensible defaults
      const enhancedPrompt = this.enhancePrompt(payload.description || "", payload.tags);

      // Update task with CLI info
      await this.appendToTask(planId, `
CLI: ${cli}
Workspace: ${workspace}
Instruction: ${enhancedPrompt.substring(0, 200)}${enhancedPrompt.length > 200 ? '...' : ''}
`);

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
        enhancedPrompt,
        {
          workspace,
          ...cliOptions,
        }
      )) as CLIResult;

      // Save output to file
      const outputPath = await this.saveOutput(planId, result);

      // Parse results for task log
      const decisions = this.parseDecisions(result.output);
      
      await this.appendToTask(planId, `
═══════════════════════════════════════════════════
CODE GENERATED:
${decisions}

COMPILATION: ${result.success ? '✅ Passed' : '❌ Failed'}
Output saved to: ${outputPath}
═══════════════════════════════════════════════════
`);

      if (result.success) {
        // Try to hot reload if it's an agent
        const reloadResult = await this.attemptHotReload(workspace, result.output);
        
        await this.appendToTask(planId, `
═══════════════════════════════════════════════════
HOT RELOAD: ${reloadResult.success ? '✅ Success' : '❌ Failed'}
${reloadResult.message}
═══════════════════════════════════════════════════
`);

        // Emit completed
        this.api.events.emit("PlanCompleted", {
          id: planId,
          result: result.output,
          outputPath,
          executedBy: cli,
          workspace,
          reloadStatus: reloadResult.success ? 'success' : 'failed',
          completedAt: Date.now(),
        }, "coder-bot");

        // Final task update
        await this.appendToTask(planId, `
═══════════════════════════════════════════════════
[COMPLETED]
Status: ✅ SUCCESS
Agent: ${reloadResult.agentName || 'Unknown'}
Routes: ${reloadResult.routes?.join(', ') || 'None'}
Created: ${new Date().toISOString()}
═══════════════════════════════════════════════════
`);

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

      // Append error to task
      await this.appendToTask(planId, `
═══════════════════════════════════════════════════
[ERROR]
${errorMessage}
═══════════════════════════════════════════════════
`);

      // Emit failed
      this.api.events.emit("PlanFailed", {
        id: planId,
        error: errorMessage,
        failedAt: Date.now(),
        failedBy: "coder-bot",
      }, "coder-bot");

      console.error(`[coder-bot] ❌ PlanFailed: ${planId}`, errorMessage);
      throw error;
    }
  }

  /**
   * Enhance prompt with sensible defaults
   */
  private enhancePrompt(description: string, tags?: string[]): string {
    const isAgent = tags?.some(tag => tag.includes('agent'));
    const isPlugin = tags?.some(tag => tag.includes('plugin'));
    
    let enhanced = description;
    
    // Add context about Ronin
    enhanced += `

Context: This is for the Ronin agent system.
${isAgent ? 'Create a Ronin agent following the BaseAgent pattern.' : ''}
${isPlugin ? 'Create a Ronin plugin following the Plugin pattern.' : ''}

Use sensible defaults for any unspecified parameters:
- Use standard patterns from existing code
- Follow TypeScript best practices
- Include proper error handling
- Add appropriate logging`;

    return enhanced;
  }

  /**
   * Parse decisions from CLI output
   */
  private parseDecisions(output: string): string {
    // Try to extract file creation info
    const lines = output.split('\n');
    const fileLines = lines.filter(line => 
      line.includes('Created') || 
      line.includes('Generated') || 
      line.includes('File:') ||
      line.includes('.ts') ||
      line.includes('.js')
    );
    
    if (fileLines.length > 0) {
      return `Files created:\n${fileLines.slice(0, 5).join('\n')}`;
    }
    
    return `Output:\n${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`;
  }

  /**
   * Attempt to hot reload a newly created agent
   */
  private async attemptHotReload(workspace: string, output: string): Promise<{
    success: boolean;
    message: string;
    agentName?: string;
    routes?: string[];
  }> {
    try {
      // Extract agent filename from output
      const agentMatch = output.match(/(\w+-(?:agent|plugin))\.ts/i) || 
                        output.match(/([\w-]+)\.(ts|js)/i);
      
      if (!agentMatch) {
        return {
          success: false,
          message: "Could not identify agent file in output",
        };
      }

      const agentFile = agentMatch[1] + '.ts';
      const agentPath = join(workspace, agentFile);
      
      if (!existsSync(agentPath)) {
        // Try external agents dir
        const externalPath = join(homedir(), '.ronin', 'agents', agentFile);
        if (existsSync(externalPath)) {
          // Hot reload will pick this up
          return {
            success: true,
            message: `Agent saved to ${externalPath}. Hot reload will load it automatically.`,
            agentName: agentMatch[1],
          };
        }
        
        return {
          success: false,
          message: `Agent file not found at ${agentPath}`,
        };
      }

      // File exists, hot reload service will pick it up if watching
      return {
        success: true,
        message: `Agent file created at ${agentPath}. Hot reload service will load it.`,
        agentName: agentMatch[1],
      };
    } catch (error) {
      return {
        success: false,
        message: `Hot reload check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Append content to task description
   */
  private async appendToTask(planId: string, content: string): Promise<void> {
    try {
      // Query todo agent to find and update the task
      // This uses the event system to communicate with todo agent
      this.api.events.emit("TaskAppendDescription", {
        planId,
        content,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`[coder-bot] Failed to append to task ${planId}:`, error);
    }
  }

  /**
   * Load configuration from config service
   */
  private async loadConfig(): Promise<CLIConfig> {
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
      // Default to external agents directory for agent creation
      return join(homedir(), ".ronin", "agents");
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
