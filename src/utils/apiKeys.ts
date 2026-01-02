import { loadConfig } from "../cli/commands/config.js";

/**
 * Get API key from environment variable or config file
 * Environment variables take precedence over config file
 */
export async function getApiKey(keyName: "GROK_API_KEY" | "GEMINI_API_KEY"): Promise<string | null> {
  // First check environment variable
  const envKey = process.env[keyName];
  if (envKey) {
    return envKey;
  }

  // Fall back to config file
  const config = await loadConfig();
  const configKeyName = keyName === "GROK_API_KEY" ? "grokApiKey" : "geminiApiKey";
  return config[configKeyName] || null;
}

/**
 * Get API key synchronously (for plugins that need immediate access)
 * This will only check environment variables, not config file
 */
export function getApiKeySync(keyName: "GROK_API_KEY" | "GEMINI_API_KEY"): string | null {
  return process.env[keyName] || null;
}

