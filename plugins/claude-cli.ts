import type { Plugin } from "../src/plugins/base.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(exec);

interface ClaudeCLIOptions {
  instruction: string;
  workspace?: string;
  timeout?: number;
  /** Resume a prior session (e.g. for comment-resume rounds). */
  sessionId?: string;
  /** Default 'acceptEdits' — auto-accepts file edits without prompting, but
   *  does not bypass all permission checks. Only widen this deliberately. */
  permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "manual";
}

interface ClaudeResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Claude CLI Plugin
 *
 * Wraps the Claude Code CLI for AI-powered development, following the same
 * shape as plugins/opencode-cli.ts / qwen-cli.ts / cursor-cli.ts / gemini-cli.ts
 * (checkInstallation / getInstallInstructions / execute) so it slots into
 * the same executor dispatch table (src/tasking/executors.ts) with no
 * special-casing.
 *
 * Usage:
 *   claude -p "<instruction>" --output-format json --permission-mode acceptEdits
 */
export default {
  name: "claude-cli",
  description: "Claude Code CLI integration for AI-powered development",
  methods: {
    /**
     * Check if the Claude CLI is installed
     */
    checkInstallation: async (): Promise<boolean> => {
      try {
        await execAsync("claude --version");
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Get installation instructions
     */
    getInstallInstructions: (): string => {
      return `
Claude CLI is not installed. Install it with:

  npm install -g @anthropic-ai/claude-code

For more information: https://docs.claude.com/en/docs/claude-code
      `.trim();
    },

    /**
     * Execute a Claude Code CLI command
     */
    execute: async (instruction: string, options?: ClaudeCLIOptions): Promise<ClaudeResult> => {
      const timeout = options?.timeout || 120000; // 2 minutes default
      const workspace = options?.workspace || process.cwd();
      const permissionMode = options?.permissionMode || "acceptEdits";

      // Validate workspace exists
      if (!existsSync(workspace)) {
        return {
          success: false,
          output: "",
          error: `Workspace does not exist: ${workspace}`,
        };
      }

      // Build command
      const cmdParts = [
        "claude",
        "-p",
        `"${instruction.replace(/"/g, '\\"')}"`,
        "--output-format",
        "json",
        "--permission-mode",
        permissionMode,
      ];

      if (options?.sessionId) {
        cmdParts.push("--resume", options.sessionId);
      }

      const command = cmdParts.join(" ");

      try {
        console.log(`[claude-cli] Executing: ${command}`);

        const { stdout, stderr } = await execAsync(command, {
          timeout,
          cwd: workspace,
        });

        const raw = stdout || stderr || "";
        let output = raw;
        let sessionId: string | undefined;
        let costUsd: number | undefined;
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        try {
          const parsed = JSON.parse(raw);
          output = parsed.result ?? parsed.content ?? raw;
          sessionId = parsed.session_id ?? parsed.sessionId;
          costUsd = parsed.total_cost_usd;
          inputTokens = parsed.usage?.input_tokens;
          outputTokens = parsed.usage?.output_tokens;
        } catch {
          // Not JSON (or --output-format json unavailable) — fall back to raw text.
        }

        return {
          success: true,
          output: output || "Claude command completed",
          sessionId,
          costUsd,
          inputTokens,
          outputTokens,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        return {
          success: false,
          output: "",
          error: errorMessage,
        };
      }
    },
  },
} as Plugin;
