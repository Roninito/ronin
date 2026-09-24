import type { Plugin } from "../src/plugins/base.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(exec);

interface OpencodeCLIOptions {
  instruction: string;
  workspace?: string;
  model?: string;
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
 *   opencode run --model opencode/muse-spark-1.3-contributor-free "Create React component"
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
      const model = options?.model || process.env.OPENCODE_MODEL || "opencode/muse-spark-1.3-contributor-free";

      // Validate workspace exists
      if (!existsSync(workspace)) {
        return {
          success: false,
          output: "",
          error: `Workspace does not exist: ${workspace}`,
        };
      }

      // Prefer the modern chat-oriented `opencode run` path so models like
      // muse-spark-1.3 can be selected with --model.
      const escapedInstruction = instruction.replace(/"/g, '\\"');
      const command = `cd "${workspace}" && opencode run --model ${model} "${escapedInstruction}"`;

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

        // Detect the common "not authenticated" / "please log in" cases so
        // callers can surface a helpful user message instead of a raw stderr dump.
        const authHint = /sign in|login|authenticate|auth required|not authenticated|session expired/i.test(errorMessage)
          ? " Opencode CLI appears to need authentication. Run `opencode login` in a terminal and retry."
          : "";

        return {
          success: false,
          output: "",
          error: errorMessage + authHint,
        };
      }
    },

    /**
     * Get available Opencode models known to work with `opencode run --model`.
     */
    getModels: async (): Promise<string[]> => {
      return [
        "opencode/muse-spark-1.3-contributor-free",
        "opencode/muse-spark-1.3",
        "opencode/default",
      ];
    },
  },
} as Plugin;
