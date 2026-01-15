import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Configuration command: Set agent directory paths
 */
export interface ConfigOptions {
  agentDir?: string;
  externalAgentDir?: string;
  grokApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  show?: boolean;
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  const configDir = join(homedir(), ".ronin");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return join(configDir, "config.json");
}

/**
 * Get the default local agents directory
 */
export function getDefaultAgentDir(): string {
  return join(homedir(), ".ronin", "agents");
}

/**
 * Ensure the default agents directory exists
 */
export function ensureDefaultAgentDir(): string {
  const agentDir = getDefaultAgentDir();
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true });
  }
  return agentDir;
}

/**
 * Load configuration from file
 * Creates an empty config file if it doesn't exist
 */
export async function loadConfig(): Promise<Record<string, string>> {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const file = Bun.file(configPath);
      const content = await file.text();
      return JSON.parse(content);
    } catch {
      // If file is corrupted, return empty and let it be recreated
      return {};
    }
  } else {
    // Create empty config file on first access
    try {
      await Bun.write(configPath, JSON.stringify({}, null, 2));
    } catch {
      // If we can't write, that's okay - just return empty config
    }
    return {};
  }
}

/**
 * Save configuration to file
 */
async function saveConfig(config: Record<string, string>): Promise<void> {
  const configPath = getConfigPath();
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}

/**
 * Get shell profile path
 */
function getShellProfile(): string {
  const shell = process.env.SHELL || "";
  if (shell.includes("zsh")) {
    return join(homedir(), ".zshrc");
  } else if (shell.includes("bash")) {
    return join(homedir(), ".bashrc");
  } else {
    return join(homedir(), ".profile");
  }
}

/**
 * Mask sensitive values for display
 */
function maskValue(value: string): string {
  if (value.length <= 8) {
    return "****";
  }
  return value.substring(0, 4) + "****" + value.substring(value.length - 4);
}

/**
 * Config command: Manage Ronin configuration
 */
export async function configCommand(options: ConfigOptions = {}): Promise<void> {
  if (options.show) {
    // Show current configuration
    const config = await loadConfig();
    const envExternal = process.env.RONIN_EXTERNAL_AGENT_DIR;
    const envGrok = process.env.GROK_API_KEY;
    const envGemini = process.env.GEMINI_API_KEY;
    const envGeminiModel = process.env.GEMINI_MODEL;
    
    console.log("\n📋 Ronin Configuration\n");
    console.log("From config file (~/.ronin/config.json):");
    if (Object.keys(config).length === 0) {
      console.log("   (no configuration set)");
    } else {
      for (const [key, value] of Object.entries(config)) {
        if (key === "grokApiKey" || key === "geminiApiKey") {
          console.log(`   ${key}: ${maskValue(value)}`);
        } else if (key === "geminiModel") {
          console.log(`   ${key}: ${value} (default: gemini-pro if not set)`);
        } else {
          console.log(`   ${key}: ${value}`);
        }
      }
    }
    
    console.log("\nFrom environment variables:");
    if (envExternal) {
      console.log(`   RONIN_EXTERNAL_AGENT_DIR: ${envExternal}`);
    } else {
      console.log("   RONIN_EXTERNAL_AGENT_DIR: (not set)");
    }
    if (envGrok) {
      console.log(`   GROK_API_KEY: ${maskValue(envGrok)}`);
    } else {
      console.log("   GROK_API_KEY: (not set)");
    }
    if (envGemini) {
      console.log(`   GEMINI_API_KEY: ${maskValue(envGemini)}`);
    } else {
      console.log("   GEMINI_API_KEY: (not set)");
    }
    if (envGeminiModel) {
      console.log(`   GEMINI_MODEL: ${envGeminiModel}`);
    } else {
      console.log("   GEMINI_MODEL: (not set)");
    }
    const envWebhookPort = process.env.WEBHOOK_PORT;
    const webhookPort = envWebhookPort ? parseInt(envWebhookPort) : 3000;
    if (envWebhookPort) {
      console.log(`   WEBHOOK_PORT: ${envWebhookPort} (using port ${webhookPort})`);
    } else {
      console.log(`   WEBHOOK_PORT: (not set, using default: ${webhookPort})`);
    }
    
    console.log("\nCurrent working directory:");
    console.log(`   ${process.cwd()}`);
    
    return;
  }

  if (options.grokApiKey !== undefined) {
    const config = await loadConfig();
    
    if (options.grokApiKey === "") {
      // Remove API key
      delete config.grokApiKey;
      await saveConfig(config);
      console.log("✅ Removed Grok API key from configuration");
      console.log("\n💡 Note: Environment variable GROK_API_KEY takes precedence if set");
    } else {
      config.grokApiKey = options.grokApiKey;
      await saveConfig(config);
      console.log("✅ Grok API key saved to configuration");
      console.log("\n💡 The API key is stored in ~/.ronin/config.json");
      console.log("💡 Environment variable GROK_API_KEY takes precedence if set");
    }
    return;
  }

  if (options.geminiApiKey !== undefined) {
    const config = await loadConfig();
    
    if (options.geminiApiKey === "") {
      // Remove API key
      delete config.geminiApiKey;
      await saveConfig(config);
      console.log("✅ Removed Gemini API key from configuration");
      console.log("\n💡 Note: Environment variable GEMINI_API_KEY takes precedence if set");
    } else {
      config.geminiApiKey = options.geminiApiKey;
      await saveConfig(config);
      console.log("✅ Gemini API key saved to configuration");
      console.log("\n💡 The API key is stored in ~/.ronin/config.json");
      console.log("💡 Environment variable GEMINI_API_KEY takes precedence if set");
    }
    return;
  }

  if (options.geminiModel !== undefined) {
    const config = await loadConfig();
    
    if (options.geminiModel === "") {
      // Remove model setting
      delete config.geminiModel;
      await saveConfig(config);
      console.log("✅ Removed Gemini model from configuration");
      console.log("\n💡 Will use default model: gemini-pro");
      console.log("💡 Note: Environment variable GEMINI_MODEL takes precedence if set");
    } else {
      config.geminiModel = options.geminiModel;
      await saveConfig(config);
      console.log(`✅ Gemini model set to: ${options.geminiModel}`);
      console.log("\n💡 The model is stored in ~/.ronin/config.json");
      console.log("💡 Environment variable GEMINI_MODEL takes precedence if set");
      console.log("💡 Common models: gemini-pro (v1beta), gemini-1.5-pro-latest, gemini-1.5-flash-latest");
      console.log("💡 If a model doesn't work, check Google's API documentation for available models");
    }
    return;
  }

  if (options.externalAgentDir !== undefined) {
    // Set external agent directory
    const config = await loadConfig();
    
    if (options.externalAgentDir === "") {
      // Remove external agent directory
      delete config.externalAgentDir;
      await saveConfig(config);
      console.log("✅ Removed external agent directory configuration");
      console.log("\n💡 To remove from environment, edit your shell profile:");
      console.log(`   ${getShellProfile()}`);
    } else {
      // Validate path
      if (!existsSync(options.externalAgentDir)) {
        console.error(`❌ Directory does not exist: ${options.externalAgentDir}`);
        console.log("\n💡 Create the directory first, or use an existing path");
        process.exit(1);
      }
      
      config.externalAgentDir = options.externalAgentDir;
      await saveConfig(config);
      
      console.log(`✅ External agent directory set to: ${options.externalAgentDir}`);
      console.log("\n💡 To make this permanent, add to your shell profile:");
      console.log(`   ${getShellProfile()}`);
      console.log(`   export RONIN_EXTERNAL_AGENT_DIR="${options.externalAgentDir}"`);
      console.log("\n   Then reload your shell or run:");
      console.log(`   source ${getShellProfile()}`);
    }
    
    return;
  }

  if (options.agentDir !== undefined) {
    // Set local agent directory (for this project)
    const config = await loadConfig();
    config.agentDir = options.agentDir;
    await saveConfig(config);
    
    console.log(`✅ Local agent directory set to: ${options.agentDir}`);
    console.log("\n💡 This setting is project-specific and stored in ~/.ronin/config.json");
    return;
  }

  // No options provided, show help
  console.log(`
📋 Ronin Configuration

Usage:
  ronin config --show                    Show current configuration
  ronin config --agent-dir <path>        Set local agent directory
  ronin config --external-agent-dir <path>  Set external agent directory
  ronin config --external-agent-dir ""   Remove external agent directory
  ronin config --grok-api-key <key>      Set Grok API key
  ronin config --grok-api-key ""         Remove Grok API key
  ronin config --gemini-api-key <key>     Set Gemini API key
  ronin config --gemini-api-key ""        Remove Gemini API key
  ronin config --gemini-model <model>     Set Gemini model (e.g., gemini-1.5-pro)
  ronin config --gemini-model ""          Remove Gemini model (use default)

Examples:
  ronin config --show
  ronin config --external-agent-dir ~/my-agents
  ronin config --agent-dir ./custom-agents
  ronin config --grok-api-key sk-xxxxx
  ronin config --gemini-api-key AIxxxxx
  ronin config --gemini-model gemini-1.5-flash

Note: 
  - API keys can also be set via environment variables (takes precedence)
  - External agent directory can also be set via RONIN_EXTERNAL_AGENT_DIR
  - Configuration is stored in ~/.ronin/config.json
`);
}

