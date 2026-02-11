import type { Plugin } from "../src/plugins/base.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(exec);

interface QwenCLIOptions {
  instruction: string;
  workspace?: string;
  model?: string;
  timeout?: number;
}

interface QwenResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Qwen CLI Plugin
 * 
 * Wraps the Qwen Code CLI tool for code generation and editing.
 * Provides check, execute, and installation instructions.
 * 
 * Installation:
 *   npm install -g @qwen/cli
 *   or
 *   pip install qwen-code
 * 
 * Usage:
 *   qwen code generate --instruction "Create auth middleware" --workspace ./src
 */
export default {
  name: "qwen-cli",
  description: "Qwen Code CLI integration for code generation",
  methods: {
    /**
     * Check if Qwen CLI is installed
     */
    checkInstallation: async (): Promise<boolean> => {
      try {
        await execAsync("qwen --version");
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
Qwen CLI is not installed. Install it with:

  npm install -g @qwen/cli
  
Or via pip:

  pip install qwen-code

For more information: https://github.com/QwenLM/qwen-code
      `.trim();
    },

    /**
     * Execute Qwen CLI command
     */
    execute: async (instruction: string, options?: QwenCLIOptions): Promise<QwenResult> => {
      const timeout = options?.timeout || 300000; // 5 minutes default
      const model = options?.model || "qwen3:1.7b";
      const workspace = options?.workspace || process.cwd();

      // Validate workspace exists
      if (!existsSync(workspace)) {
        return {
          success: false,
          output: "",
          error: `Workspace does not exist: ${workspace}`,
        };
      }

      // Build command - use positional prompt and cd to workspace
      // qwen CLI format: qwen [query..] --model <model>
      const escapedInstruction = instruction.replace(/"/g, '\\"');
      const command = `cd "${workspace}" && qwen "${escapedInstruction}" --model ${model} --yolo`;

      try {
        console.log(`[qwen-cli] Executing: ${command}`);
        
        const { stdout, stderr } = await execAsync(command, {
          timeout,
          cwd: workspace,
        });

        const output = stdout || stderr || "Command completed with no output";
        
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

    /**
     * Get available models
     */
    getModels: async (): Promise<string[]> => {
      return [
        "qwen3:1.7b",
        "qwen3:4b",
        "qwen3:8b",
        "qwen3:14b",
        "qwen3:32b",
      ];
    },
  },
} as Plugin;
