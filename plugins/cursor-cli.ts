import type { Plugin } from "../src/plugins/base.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(exec);

interface CursorCLIOptions {
  instruction: string;
  projectPath?: string;
  file?: string;
  timeout?: number;
}

interface CursorResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Cursor CLI Plugin
 * 
 * Wraps the Cursor CLI tool for AI-powered code editing.
 * Note: Cursor CLI requires a Cursor license/subscription.
 * 
 * Installation:
 *   Cursor.app includes CLI. Enable in Settings > General > Cursor CLI
 *   Or download from: https://cursor.com/docs/cli/overview
 * 
 * Usage:
 *   cursor --project . --instruction "Refactor auth module"
 */
export default {
  name: "cursor-cli",
  description: "Cursor CLI integration for AI-powered code editing",
  methods: {
    /**
     * Check if Cursor CLI is installed
     */
    checkInstallation: async (): Promise<boolean> => {
      try {
        await execAsync("cursor --version");
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
Cursor CLI is not installed. 

Cursor CLI is included with Cursor.app:
1. Download Cursor from https://cursor.com
2. Open Cursor → Settings → General
3. Enable "Cursor CLI"
4. Restart your terminal

Or install via Homebrew:
  brew install --cask cursor

Note: Cursor requires a license/subscription for CLI usage.
Documentation: https://cursor.com/docs/cli/overview
      `.trim();
    },

    /**
     * Execute Cursor CLI command
     */
    execute: async (instruction: string, options?: CursorCLIOptions): Promise<CursorResult> => {
      const timeout = options?.timeout || 60000; // 1 minute default
      const projectPath = options?.projectPath || process.cwd();

      // Validate project path exists
      if (!existsSync(projectPath)) {
        return {
          success: false,
          output: "",
          error: `Project path does not exist: ${projectPath}`,
        };
      }

      // Build command
      const cmdParts = [
        "cursor",
        "--project",
        projectPath,
        "--instruction",
        `"${instruction.replace(/"/g, '\\"')}"`,
      ];

      if (options?.file) {
        cmdParts.push("--file", options.file);
      }

      const command = cmdParts.join(" ");

      try {
        console.log(`[cursor-cli] Executing: ${command}`);
        
        const { stdout, stderr } = await execAsync(command, {
          timeout,
          cwd: projectPath,
        });

        const output = stdout || stderr || "Cursor command completed";
        
        return {
          success: true,
          output,
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
