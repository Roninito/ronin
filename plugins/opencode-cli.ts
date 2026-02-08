import type { Plugin } from "../src/plugins/base.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(exec);

interface OpencodeCLIOptions {
  instruction: string;
  workspace?: string;
  timeout?: number;
}

interface OpencodeResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Opencode CLI Plugin
 * 
 * Wraps the Opencode CLI tool for AI-powered development.
 * 
 * Installation:
 *   npm install -g opencode
 *   
 *   Or download from: https://opencode.ai/docs/cli/
 * 
 * Usage:
 *   opencode generate --instruction "Create React component"
 */
export default {
  name: "opencode-cli",
  description: "Opencode CLI integration for AI-powered development",
  methods: {
    /**
     * Check if Opencode CLI is installed
     */
    checkInstallation: async (): Promise<boolean> => {
      try {
        await execAsync("opencode --version");
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
Opencode CLI is not installed. Install it with:

  npm install -g opencode
  
Or via yarn:

  yarn global add opencode

For more information: https://opencode.ai/docs/cli/
      `.trim();
    },

    /**
     * Execute Opencode CLI command
     */
    execute: async (instruction: string, options?: OpencodeCLIOptions): Promise<OpencodeResult> => {
      const timeout = options?.timeout || 120000; // 2 minutes default
      const workspace = options?.workspace || process.cwd();

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
        "opencode",
        "generate",
        "--instruction",
        `"${instruction.replace(/"/g, '\\"')}"`,
      ];

      if (workspace) {
        cmdParts.push("--workspace", workspace);
      }

      const command = cmdParts.join(" ");

      try {
        console.log(`[opencode-cli] Executing: ${command}`);
        
        const { stdout, stderr } = await execAsync(command, {
          timeout,
          cwd: workspace,
        });

        const output = stdout || stderr || "Opencode command completed";
        
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
