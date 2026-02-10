import type { Plugin } from "../src/plugins/base.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { getConfigService } from "../src/config/ConfigService.js";

const execAsync = promisify(exec);

/**
 * Get Gemini API key from ConfigService or environment
 */
async function getApiKey(): Promise<string | undefined> {
  // Try ConfigService first
  try {
    const configService = getConfigService();
    const configGemini = configService.getGemini();
    if (configGemini.apiKey) {
      return configGemini.apiKey;
    }
  } catch {
    // ConfigService not available
  }
  
  // Fallback to environment variable
  return process.env.GEMINI_API_KEY;
}

interface GeminiCLIOptions {
  instruction: string;
  workspace?: string;
  model?: string;
  timeout?: number;
}

interface GeminiResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Gemini CLI Plugin
 * 
 * Wraps the Google Gemini CLI tool for AI-powered development.
 * 
 * Installation:
 *   npm install -g @google/gemini-cli
 *   
 *   Requires Gemini API key from: https://aistudio.google.com/app/apikey
 * 
 * Usage:
 *   gemini generate --instruction "Create API endpoint" --workspace ./src
 */
export default {
  name: "gemini-cli",
  description: "Google Gemini CLI integration for AI-powered development",
  methods: {
    /**
     * Check if Gemini CLI is installed
     */
    checkInstallation: async (): Promise<boolean> => {
      try {
        await execAsync("gemini --version");
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
Gemini CLI is not installed. Install it with:

  npm install -g @google/gemini-cli
  
You also need a Gemini API key:
1. Get API key from: https://aistudio.google.com/app/apikey
2. Set environment variable: export GEMINI_API_KEY=your_key

For more information: https://ai.google.dev/docs
      `.trim();
    },

    /**
     * Execute Gemini CLI command
     */
    execute: async (instruction: string, options?: GeminiCLIOptions): Promise<GeminiResult> => {
      const timeout = options?.timeout || 60000; // 1 minute default
      const model = options?.model || "gemini-pro";
      const workspace = options?.workspace || process.cwd();

      // Validate workspace exists
      if (!existsSync(workspace)) {
        return {
          success: false,
          output: "",
          error: `Workspace does not exist: ${workspace}`,
        };
      }

      // Check for API key
      const apiKey = await getApiKey();
      if (!apiKey) {
        return {
          success: false,
          output: "",
          error: "GEMINI_API_KEY not configured. Set it via config (gemini.apiKey), environment variable (GEMINI_API_KEY), or: ronin config --gemini-api-key <key>",
        };
      }

      // Build command
      const cmdParts = [
        "gemini",
        "generate",
        "--instruction",
        `"${instruction.replace(/"/g, '\\"')}"`,
        "--model",
        model,
      ];

      if (workspace) {
        cmdParts.push("--workspace", workspace);
      }

      const command = cmdParts.join(" ");

      try {
        console.log(`[gemini-cli] Executing: ${command}`);
        
        const { stdout, stderr } = await execAsync(command, {
          timeout,
          cwd: workspace,
          env: {
            ...process.env,
            GEMINI_API_KEY: apiKey,
          },
        });

        const output = stdout || stderr || "Gemini command completed";
        
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
        "gemini-pro",
        "gemini-pro-vision",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
      ];
    },
  },
} as Plugin;
