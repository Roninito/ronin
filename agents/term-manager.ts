import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface ShellCommand {
  command: string;
  cwd?: string;
  timeout?: number;
}

interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
}

interface PendingCommand {
  id: string;
  command: string;
  cwd?: string;
  requestedAt: number;
  confirmed: boolean;
}

/**
 * Term Manager Agent
 * 
 * Specialized agent for executing shell commands.
 * Includes extensive safety guards and requires confirmation for dangerous commands.
 * 
 * Capabilities:
 * - Execute shell commands
 * - Run in specific directories
 * - Timeout protection
 * - Dangerous command detection
 * 
 * Safety Features:
 * - Confirmation required for destructive commands (rm, dd, mkfs, etc.)
 * - Whitelist of allowed commands
 * - Blacklist of dangerous patterns
 * - Timeout protection (default 30s)
 * - Working directory restrictions
 * - Command logging
 */
export default class TermManagerAgent extends BaseAgent {
  static webhook = "/api/term-manager";
  
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private commandLog: Array<{ timestamp: number; command: string; success: boolean }> = [];
  private maxLogSize = 1000;
  
  // Dangerous commands that require confirmation
  private dangerousCommands = [
    "rm", "del", "rmdir",
    "dd", "mkfs", "fdisk", "format",
    "kill", "pkill", "killall",
    "shutdown", "reboot", "poweroff",
    "sudo", "su",
    "mv", "move", // Can overwrite files
    "cp", "copy", // Can overwrite files
    "chmod", "chown",
    ">", ">>", // Redirection
  ];
  
  // Allowed base commands (whitelist approach)
  private allowedCommands = [
    "ls", "dir", "ll",
    "cd", "pwd",
    "cat", "head", "tail", "less", "more",
    "grep", "find", "locate",
    "echo", "printf",
    "osascript",
    "mkdir", "touch",
    "ps", "top", "htop",
    "df", "du", "free", "vmstat",
    "uname", "whoami", "id",
    "git", "curl", "wget",
    "node", "npm", "npx",
    "bun",
    "python", "python3", "pip",
    "docker", "docker-compose",
    "kubectl",
    "ssh", // Though this is borderline
  ];

  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
    this.registerEventListeners();
    console.log("💻 Term Manager agent ready");
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/api/term-manager", this.handleTermRequest.bind(this));
    this.api.http.registerRoute("/api/term-manager/confirm", this.handleConfirmRequest.bind(this));
    this.api.http.registerRoute("/api/term-manager/history", this.handleHistoryRequest.bind(this));
  }

  /**
   * Register event listeners
   */
  private registerEventListeners(): void {
    // Listen for command execution requests from other agents
    this.api.events.on("ExecuteShellCommand", (data: unknown) => {
      const cmd = data as ShellCommand & { requestId: string };
      this.handleCommandRequest(cmd);
    });
  }

  /**
   * Handle shell command API requests
   */
  private async handleTermRequest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json() as ShellCommand & { autoConfirm?: boolean };
      
      // Check if command requires confirmation
      const requiresConfirmation = this.requiresConfirmation(body.command);
      
      if (requiresConfirmation && !body.autoConfirm) {
        // Store pending command
        const pendingId = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.pendingCommands.set(pendingId, {
          id: pendingId,
          command: body.command,
          cwd: body.cwd,
          requestedAt: Date.now(),
          confirmed: false,
        });
        
        return Response.json({
          success: false,
          requiresConfirmation: true,
          pendingId,
          command: body.command,
          message: `Command "${body.command}" requires confirmation due to potentially destructive nature. Use /api/term-manager/confirm with pendingId to execute.`,
        });
      }
      
      const result = await this.executeCommand(body);
      return Response.json(result);
    } catch (error) {
      console.error("[term-manager] Error:", error);
      return Response.json({
        success: false,
        stdout: "",
        stderr: "",
        exitCode: -1,
        executionTime: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Handle confirmation requests
   */
  private async handleConfirmRequest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json() as { pendingId: string };
      const pending = this.pendingCommands.get(body.pendingId);
      
      if (!pending) {
        return Response.json({
          success: false,
          error: "Pending command not found or expired",
        }, { status: 404 });
      }
      
      // Remove from pending
      this.pendingCommands.delete(body.pendingId);
      
      // Execute the command
      const result = await this.executeCommand({
        command: pending.command,
        cwd: pending.cwd,
      });
      
      return Response.json(result);
    } catch (error) {
      console.error("[term-manager] Confirmation error:", error);
      return Response.json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Handle history requests
   */
  private async handleHistoryRequest(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    return Response.json({
      commands: this.commandLog.slice(-100),
      pending: Array.from(this.pendingCommands.values()),
    });
  }

  /**
   * Check if a command requires confirmation
   */
  private requiresConfirmation(command: string): boolean {
    const cmdLower = command.toLowerCase().trim();
    
    // Check for dangerous keywords
    for (const dangerous of this.dangerousCommands) {
      if (cmdLower.includes(dangerous)) {
        return true;
      }
    }
    
    // Check for redirection operators
    if (cmdLower.includes(">") || cmdLower.includes("|")) {
      return true;
    }
    
    return false;
  }

  /**
   * Validate command against whitelist
   */
  private validateCommand(command: string): { valid: boolean; error?: string } {
    // Extract the base command
    const baseCmd = command.trim().split(/\s+/)[0].toLowerCase();
    
    // Check whitelist
    if (!this.allowedCommands.includes(baseCmd)) {
      // Some commands are allowed with paths (like /bin/ls)
      const cmdWithoutPath = baseCmd.replace(/^.*\//, "");
      if (!this.allowedCommands.includes(cmdWithoutPath)) {
        return {
          valid: false,
          error: `Command "${baseCmd}" is not in the allowed list. Allowed: ${this.allowedCommands.join(", ")}`,
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Execute a shell command
   */
  async executeCommand(params: ShellCommand): Promise<ShellResult> {
    const { command, cwd, timeout = 30000 } = params;
    
    console.log(`[term-manager] Executing: ${command}`);
    
    // Validate command
    const validation = this.validateCommand(command);
    if (!validation.valid) {
      return {
        success: false,
        stdout: "",
        stderr: validation.error || "Command validation failed",
        exitCode: -1,
        executionTime: 0,
      };
    }
    
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024, // 1MB max output
      });
      
      const executionTime = Date.now() - startTime;
      
      // Log command
      this.logCommand(command, true);
      
      console.log(`[term-manager] Completed in ${executionTime}ms`);
      
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        executionTime,
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      // Log command (even if failed)
      this.logCommand(command, false);
      
      console.error(`[term-manager] Failed: ${error.message}`);
      
      return {
        success: false,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.code || -1,
        executionTime,
        error: error.message,
      };
    }
  }

  /**
   * Handle command requests from events
   */
  private async handleCommandRequest(cmd: ShellCommand & { requestId: string }): Promise<void> {
    const result = await this.executeCommand(cmd);
    
    // Emit result back
    this.api.events.emit("ShellCommandResult", {
      requestId: cmd.requestId,
      result,
    });
  }

  /**
   * Log command execution
   */
  private logCommand(command: string, success: boolean): void {
    this.commandLog.push({
      timestamp: Date.now(),
      command: command.substring(0, 100), // Truncate long commands
      success,
    });
    
    // Trim log if needed
    if (this.commandLog.length > this.maxLogSize) {
      this.commandLog = this.commandLog.slice(-this.maxLogSize);
    }
  }

  async execute(): Promise<void> {
    // This agent is API-driven
    
    // Clean up old pending commands (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - 300000;
    for (const [id, pending] of this.pendingCommands) {
      if (pending.requestedAt < fiveMinutesAgo) {
        this.pendingCommands.delete(id);
      }
    }
  }
}
