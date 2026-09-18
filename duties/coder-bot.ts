import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { join } from "path";
import { homedir } from "os";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolveExternalDutyDir } from "../src/cli/commands/config.js";
import { buildDutyAuthoringSystemPrompt } from "../src/duty/duty-authoring.js";

interface PlanApprovedPayload {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
  approvedAt?: number;
  approvedBy?: string;
  source?: string;
  sourceChannel?: string;
  sourceUser?: string;
  /** Optional cheap single-completion draft (e.g. from duties/duty-executor.ts's
   *  proposeDuty() review card) to hand the CLI as a starting point — a real
   *  coding agent iterating on a draft tends to do better than one working from
   *  nothing, and the human already reviewed this draft's shape before approving. */
  draftCode?: string;
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
 * Coder Bot Duty - Silent Execution Model
 * 
 * Executes plans without user interaction using sensible defaults.
 * All decisions and results are logged to the task description.
 * 
 * Workflow:
 * 1. Receives PlanApproved with #create or #build tag
 * 2. Enhances prompt with sensible defaults
 * 3. Executes CLI (no blocking, no questions)
 * 4. Appends results to task description
 * 5. Triggers hot reload for duties
 * 6. Reports success/failure
 */
export default class CoderBotDuty extends BaseDuty {
  private executionQueue: string[] = [];
  private isExecuting = false;
  private cliPlugins: Record<string, string> = {
    claude: "claude-cli",
    qwen: "qwen-cli",
    cursor: "cursor-cli",
    opencode: "opencode-cli",
    gemini: "gemini-cli",
  };
  private cliStatus: Record<string, boolean> = {};
  private maxRetries = 1;

  constructor(api: DutyAPI) {
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
          const installed = Boolean(await this.api.plugins.call(pluginName, "checkInstallation"));
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
    // Listen for PlanApproved events (from manual approval or automation)
    this.api.events.on("PlanApproved", (data: unknown) => {
      const payload = data as PlanApprovedPayload;
      this.handlePlanApproved(payload);
    });

    // Also listen for TaskMoved events (when user moves card to "Doing" in kanban)
    this.api.events.on("TaskMoved", (data: unknown) => {
      const payload = data as { 
        planId?: string; 
        cardId?: string; 
        to?: string;
        from?: string;
        title?: string;
        description?: string;
        tags?: string[];
        source?: string;
        sourceChannel?: string;
        sourceUser?: string;
      };
      
      // Only process if moved to "Doing" column
      if (payload.to === "Doing" && payload.planId) {
        console.log(`[coder-bot] Detected card moved to Doing: ${payload.planId}`);
        
        // Reconstruct the plan payload from the task data
        const planPayload: PlanApprovedPayload = {
          id: payload.planId,
          title: payload.title || "Task",
          description: payload.description || "",
          tags: payload.tags || ["create"], // Default to create if no tags
          approvedAt: Date.now(),
          source: payload.source,
          sourceChannel: payload.sourceChannel,
          sourceUser: payload.sourceUser,
        };
        
        this.handlePlanApproved(planPayload);
      }
    });

    console.log("[coder-bot] Event handlers registered (PlanApproved + TaskMoved)");
  }

  /**
   * Handle PlanApproved: Queue and execute
   */
  private async handlePlanApproved(payload: PlanApprovedPayload): Promise<void> {
    console.log(`[coder-bot] Received PlanApproved: ${payload.id}`);

    // Check for execution tags
    const hasCreateTag = payload.tags?.includes("build") || payload.tags?.includes("create");
    const hasFixTag = payload.tags?.includes("fix");
    const hasUpdateTag = payload.tags?.includes("update");
    
    if (!hasCreateTag && !hasFixTag && !hasUpdateTag) {
      console.log(`[coder-bot] No execution tag (#create/#build/#fix/#update), skipping ${payload.id}`);
      return;
    }

    // Determine operation type
    const operation = hasFixTag ? "fix" : hasUpdateTag ? "update" : "create";

    // Add to queue
    this.executionQueue.push(payload.id);
    console.log(`[coder-bot] Added ${payload.id} to queue (${operation}). Queue length: ${this.executionQueue.length}`);

    // Process queue
    await this.processQueue(payload, operation);
  }

  /**
   * Process execution queue sequentially
   */
  private async processQueue(payload: PlanApprovedPayload, operation: string = "create"): Promise<void> {
    if (this.isExecuting) {
      console.log(`[coder-bot] Queue busy, waiting...`);
      return;
    }

    this.isExecuting = true;

    try {
      await this.executePlanWithRetry(payload, operation);
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
  private async executePlanWithRetry(payload: PlanApprovedPayload, operation: string = "create", attempt: number = 1): Promise<void> {
    try {
      await this.executePlan(payload, operation, attempt);
    } catch (error) {
      if (attempt <= this.maxRetries) {
        console.log(`[coder-bot] Retrying ${payload.id} (attempt ${attempt + 1})...`);
        await this.appendToTask(payload.id, `
═══════════════════════════════════════════════════
[RETRY ATTEMPT ${attempt + 1}]
Previous error: ${error instanceof Error ? error.message : String(error)}
═══════════════════════════════════════════════════
`);
        await this.executePlanWithRetry(payload, operation, attempt + 1);
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute a plan
   */
  private async executePlan(payload: PlanApprovedPayload, operation: string = "create", attempt: number = 1): Promise<void> {
    const planId = payload.id;

    // Emit starting progress
    this.api.events.emit("PlanInProgress", {
      id: planId,
      status: "starting",
      message: `Initializing CLI execution (attempt ${attempt}, operation: ${operation})...`,
      timestamp: Date.now(),
    }, "coder-bot");

    // Initialize task log
    await this.appendToTask(planId, `
═══════════════════════════════════════════════════
[EXECUTION ATTEMPT ${attempt}]
Operation: ${operation.toUpperCase()}
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
      // cliTag (if set) came from .find()'s own predicate already confirming
      // this.cliPlugins[cliTag] is truthy, so the lookup can't be undefined here.
      const pluginName = cliTag
        ? this.cliPlugins[cliTag]!
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

      // For fix/update operations, find existing duty code
      let existingCode: string | undefined;
      if (operation === "fix" || operation === "update") {
        existingCode = await this.findExistingDutyCode(payload.title || "", workspace);
        if (existingCode) {
          await this.appendToTask(planId, `
Found existing duty code. Will ${operation} it.
`);
        }
      }

      if (payload.draftCode) {
        await this.appendToTask(planId, `
Starting from a reviewed draft (see the approved proposal card).
`);
      }

      // Enhance prompt based on operation
      const enhancedPrompt = this.enhancePrompt(
        payload.description || "",
        payload.tags,
        operation,
        existingCode,
        payload.draftCode
      );

      // Update task with CLI info
      await this.appendToTask(planId, `
CLI: ${cli}
Workspace: ${workspace}
Operation: ${operation}
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

      // Execute CLI, watching for the real hot-reload event it should trigger
      // (see runCliAndDetectDuty — far more reliable than guessing a filename
      // out of the CLI's text output).
      const cliOptions = config.cliOptions?.[cli] || {};
      const { result, reload: reloadResult } = await this.runCliAndDetectDuty(
        pluginName,
        enhancedPrompt,
        workspace,
        cliOptions
      );

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

        await this.appendToTask(planId, `
═══════════════════════════════════════════════════
HOT RELOAD: ${reloadResult.success ? '✅ Success' : '❌ Failed'}
${reloadResult.message}
═══════════════════════════════════════════════════
`);

        // Emit completed with source info for notifications
        this.api.events.emit("PlanCompleted", {
          id: planId,
          result: result.output,
          outputPath,
          executedBy: cli,
          workspace,
          reloadStatus: reloadResult.success ? 'success' : 'failed',
          completedAt: Date.now(),
          source: payload.source,
          sourceChannel: payload.sourceChannel,
          sourceUser: payload.sourceUser,
          title: payload.title,
        }, "coder-bot");

        // Final task update
        await this.appendToTask(planId, `
═══════════════════════════════════════════════════
[COMPLETED]
Status: ✅ SUCCESS
Duty: ${reloadResult.dutyName || 'Unknown'}
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

      // Emit failed with source info for notifications
      this.api.events.emit("PlanFailed", {
        id: planId,
        error: errorMessage,
        failedAt: Date.now(),
        failedBy: "coder-bot",
        source: payload.source,
        sourceChannel: payload.sourceChannel,
        sourceUser: payload.sourceUser,
        title: payload.title,
      }, "coder-bot");

      console.error(`[coder-bot] ❌ PlanFailed: ${planId}`, errorMessage);
      throw error;
    }
  }

  /**
   * Enhance prompt with sensible defaults
   */
  private enhancePrompt(
    description: string,
    tags?: string[],
    operation: string = "create",
    existingCode?: string,
    draftCode?: string
  ): string {
    // "duty" is the current name; "agent" tags are accepted too since existing
    // Kanban cards and callers may still use the pre-rename word.
    const isDuty = tags?.some(tag => tag.includes('duty') || tag.includes('agent'));
    const isPlugin = tags?.some(tag => tag.includes('plugin'));

    let enhanced = "";

    if (operation === "fix" && existingCode) {
      enhanced = `Fix bugs in the following Ronin ${isDuty ? 'duty' : isPlugin ? 'plugin' : 'code'}.

CURRENT CODE:
${existingCode}

ISSUE TO FIX:
${description}

Instructions:
1. Analyze the code for the issue described
2. Fix the bug while maintaining existing functionality
3. Ensure TypeScript compiles without errors
4. Keep the same file name and exports`;
    } else if (operation === "update" && existingCode) {
      enhanced = `Update/modify the following Ronin ${isDuty ? 'duty' : isPlugin ? 'plugin' : 'code'}.

CURRENT CODE:
${existingCode}

MODIFICATIONS NEEDED:
${description}

Instructions:
1. Modify the code as described
2. Maintain backward compatibility where possible
3. Ensure TypeScript compiles without errors
4. Keep the same file name and exports`;
    } else if (isDuty) {
      // Duty creation: use the same authoring instructions duty-executor.ts's
      // proposeDuty() draft was written against, so a real coding agent
      // implements against the actual current BaseDuty/DutyAPI shape instead
      // of a generic one-liner guess.
      enhanced = `${buildDutyAuthoringSystemPrompt()}

I want to create a duty that: ${description}
${draftCode ? `
A first-pass draft already exists and was reviewed by the user — use it as
a starting point, but fix anything wrong rather than keeping it verbatim:

${draftCode}
` : ""}
Write the complete duty file now. Save it directly into the current working
directory (that's the duties directory this task is scoped to) using a
kebab-case filename matching the duty's purpose.`;
    } else {
      // Generic / plugin creation (default when no duty/agent tag is present)
      enhanced = description;

      enhanced += `

Context: This is for the Ronin automation system.
${isPlugin ? 'Create a Ronin plugin following the Plugin pattern.' : ''}

Use sensible defaults for any unspecified parameters:
- Use standard patterns from existing code
- Follow TypeScript best practices
- Include proper error handling
- Add appropriate logging`;
    }

    return enhanced;
  }

  /**
   * Find existing duty code for fix/update operations
   */
  private async findExistingDutyCode(title: string, workspace: string): Promise<string | undefined> {
    try {
      // Try to find the duty by name in title
      const possibleNames = [
        title.toLowerCase().replace(/\s+/g, '-'),
        title.toLowerCase().replace(/\s+/g, '_'),
        title.split(/\s+/)[0]!.toLowerCase(), // .split() always returns >= 1 element
      ];

      for (const name of possibleNames) {
        // Check in workspace
        const dutyPath = join(workspace, `${name}.ts`);
        if (existsSync(dutyPath)) {
          const code = await readFile(dutyPath, 'utf-8');
          return code;
        }

        // Check in external duties dir
        const externalPath = join(homedir(), '.ronin', 'duties', `${name}.ts`);
        if (existsSync(externalPath)) {
          const code = await readFile(externalPath, 'utf-8');
          return code;
        }

        // Check with legacy -agent suffix (pre-rename duty files still use it)
        const agentSuffixPath = join(workspace, `${name}-agent.ts`);
        if (existsSync(agentSuffixPath)) {
          const code = await readFile(agentSuffixPath, 'utf-8');
          return code;
        }
      }

      return undefined;
    } catch (error) {
      console.error(`[coder-bot] Error finding existing duty:`, error);
      return undefined;
    }
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
   * Run a coding CLI and detect whether it produced a duty HotReloadService picked up
   */
  /**
   * Run a coding CLI and observe whether it actually produced a duty
   * HotReloadService picked up — by listening for the real duty_created /
   * duty_reloaded events (HotReloadService.ts watches both duties/ and
   * ~/.ronin/duties/ directly via fs.watch, independent of any explicit
   * signal from this duty), not by regex-guessing a filename out of the
   * CLI's text output. The listener is attached BEFORE the CLI runs: the
   * file write happens during CLI execution, and fs.watch's own ~100ms
   * debounce means the event can otherwise be missed if you only start
   * listening after the CLI call resolves.
   */
  private async runCliAndDetectDuty(
    pluginName: string,
    enhancedPrompt: string,
    workspace: string,
    cliOptions: Record<string, unknown>
  ): Promise<{
    result: CLIResult;
    reload: { success: boolean; message: string; dutyName?: string; routes?: string[] };
  }> {
    const detected: Array<{ dutyName?: string; filePath?: string; routes?: string[] }> = [];
    const onHotReload = (data: unknown) => {
      const d = data as { dutyName?: string; filePath?: string; routes?: string[] };
      if (d.filePath && d.filePath.startsWith(workspace)) {
        detected.push(d);
      }
    };
    this.api.events.on("duty_created", onHotReload);
    this.api.events.on("duty_reloaded", onHotReload);

    try {
      const result = (await this.api.plugins.call(
        pluginName,
        "execute",
        enhancedPrompt,
        { workspace, ...cliOptions }
      )) as CLIResult;

      // Give fs.watch's debounce a moment to fire if the CLI's own write
      // landed right as (or just after) the process exited.
      if (detected.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (detected.length > 0) {
        const last = detected[detected.length - 1]!;
        return {
          result,
          reload: {
            success: true,
            message: `Duty '${last.dutyName}' loaded from ${last.filePath}.`,
            dutyName: last.dutyName,
            routes: last.routes,
          },
        };
      }

      return {
        result,
        reload: {
          success: false,
          message: `CLI finished but no duty_created/duty_reloaded event was observed for a file under ${workspace} — check the output log to see what it actually did.`,
        },
      };
    } finally {
      this.api.events.off("duty_created", onHotReload);
      this.api.events.off("duty_reloaded", onHotReload);
    }
  }

  /**
   * Append content to task description
   */
  private async appendToTask(planId: string, content: string): Promise<void> {
    try {
      // Query the todo duty to find and update the task
      // This uses the event system to communicate with the todo duty
      this.api.events.emit("TaskAppendDescription", {
        planId,
        content,
        timestamp: Date.now(),
      }, "coder-bot");
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
      // Real CLIOptions is a fixed {qwen,cursor,opencode,gemini} shape with no index
      // signature; this duty looks options up by a dynamically-resolved CLI name
      // (`config.cliOptions?.[cli]`), so it's treated as an open map here instead.
      cliOptions: config.cliOptions as unknown as Record<string, { timeout?: number; model?: string }>,
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
      // Default to the external duties directory for duty creation.
      return resolveExternalDutyDir();
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
    // This duty is event-driven
    console.log("[coder-bot] Running...");
  }
}
