import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { DesktopConfig, SystemConfig } from "../../config/types.js";

/**
 * Shape of ~/.ronin/config.json as read/written by this legacy flat-file loader (a
 * separate, simpler read path from the structured ConfigService/FullConfig system —
 * both read/write the same file, so `desktop`/`system` mirror ConfigService's own
 * nested shape while the rest remain the plain string settings this file manages).
 */
export interface RoninConfigFile {
  dutyDir?: string;
  externalDutyDir?: string;
  pluginDir?: string;
  userPluginDir?: string;
  grokApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  braveSearch?: { apiKey?: string };
  realmUrl?: string;
  realmCallsign?: string;
  realmToken?: string;
  realmLocalPort?: string;
  mcp?: unknown;
  desktop?: DesktopConfig;
  system?: Partial<SystemConfig>;
}

/**
 * Configuration command: Set agent directory paths
 */
export interface ConfigOptions {
  dutyDir?: string;
  externalDutyDir?: string;
  pluginDir?: string;
  userPluginDir?: string;
  init?: boolean;
  grokApiKey?: string;
  geminiApiKey?: string;
  braveApiKey?: string;
  geminiModel?: string;
  realmUrl?: string;
  realmCallsign?: string;
  realmToken?: string;
  realmLocalPort?: string;
  show?: boolean;
  edit?: boolean;
  setPassword?: boolean;
  backup?: boolean;
  listBackups?: boolean;
  restore?: string;
  export?: string;
  importPath?: string;
  validate?: boolean;
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
 * Get the default local duties directory
 */
export function getDefaultDutyDir(): string {
  // Local duties should be in ./duties relative to where ronin is run
  return join(process.cwd(), "duties");
}

/**
 * Ensure the default duties directory exists
 */
export function ensureDefaultDutyDir(): string {
  const dutyDir = getDefaultDutyDir();
  if (!existsSync(dutyDir)) {
    mkdirSync(dutyDir, { recursive: true });
  }
  return dutyDir;
}

/**
 * Get the default external duties directory
 */
export function getDefaultExternalDutyDir(): string {
  return join(homedir(), ".ronin", "duties");
}

/**
 * Ensure the default external duties directory exists
 */
export function ensureDefaultExternalDutyDir(): string {
  const dutyDir = getDefaultExternalDutyDir();
  if (!existsSync(dutyDir)) {
    mkdirSync(dutyDir, { recursive: true });
  }
  return dutyDir;
}

// Backward compatibility aliases (for existing installations with old paths)
export function getDefaultAgentDir(): string {
  // Check if ./duties exists, fall back to ./agents
  const dutiesDir = join(process.cwd(), "duties");
  const agentsDir = join(process.cwd(), "agents");
  if (existsSync(dutiesDir)) return dutiesDir;
  if (existsSync(agentsDir)) return agentsDir;
  return dutiesDir; // Default to new path
}

export function ensureDefaultAgentDir(): string {
  return ensureDefaultDutyDir();
}

export function getDefaultExternalAgentDir(): string {
  // Check if ~/.ronin/duties exists, fall back to ~/.ronin/agents
  const dutiesDir = join(homedir(), ".ronin", "duties");
  const agentsDir = join(homedir(), ".ronin", "agents");
  if (existsSync(dutiesDir)) return dutiesDir;
  if (existsSync(agentsDir)) return agentsDir;
  return dutiesDir; // Default to new path
}

export function ensureDefaultExternalAgentDir(): string {
  return ensureDefaultExternalDutyDir();
}

/**
 * Get the default plugins directory (user's home .ronin folder for global installs)
 */
export function getDefaultPluginDir(): string {
  // Use ~/.ronin/plugins instead of process.cwd()/plugins for global installs
  return join(homedir(), ".ronin", "plugins");
}

/**
 * Get the default user plugins directory
 */
export function getDefaultUserPluginDir(): string {
  return join(homedir(), ".ronin", "plugins");
}

/**
 * Ensure the default user plugins directory exists
 */
export function ensureDefaultUserPluginDir(): string {
  const pluginDir = getDefaultUserPluginDir();
  if (!existsSync(pluginDir)) {
    mkdirSync(pluginDir, { recursive: true });
  }
  return pluginDir;
}

/**
 * Get the default user skills directory
 */
export function getDefaultSkillsDir(): string {
  return join(homedir(), ".ronin", "skills");
}

/**
 * Ensure the default user skills directory exists
 */
export function ensureDefaultSkillsDir(): string {
  const skillsDir = getDefaultSkillsDir();
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }
  return skillsDir;
}

/**
 * Load configuration from file
 * Creates an empty config file if it doesn't exist
 */
export async function loadConfig(): Promise<RoninConfigFile> {
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
async function saveConfig(config: RoninConfigFile): Promise<void> {
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
        if (key === "grokApiKey" || key === "geminiApiKey" || key === "realmToken") {
          console.log(`   ${key}: ${maskValue(value)}`);
        } else if (key === "braveSearch" && value && typeof value === "object" && "apiKey" in value) {
          const bs = value as { apiKey?: string };
          console.log(`   braveSearch.apiKey: ${bs.apiKey ? maskValue(bs.apiKey) : "(not set)"}`);
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
      console.log(`   RONIN_EXTERNAL_AGENT_DIR: (not set, default: ${getDefaultExternalAgentDir()})`);
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
    if (process.env.BRAVE_API_KEY) {
      console.log(`   BRAVE_API_KEY: ${maskValue(process.env.BRAVE_API_KEY)}`);
    } else {
      console.log("   BRAVE_API_KEY: (not set)");
    }
    
    console.log("\nMCP Servers:");
    const mcp = config.mcp as { servers?: Record<string, unknown> } | undefined;
    if (mcp?.servers && Object.keys(mcp.servers).length > 0) {
      for (const [name, server] of Object.entries(mcp.servers)) {
        const s = server as { enabled?: boolean; command?: string; args?: string[] };
        const status = s.enabled ? "enabled" : "disabled";
        const cmd = s.command ? [s.command, ...(s.args ?? [])].join(" ") : "(no command)";
        console.log(`   ${name}: ${status} - ${cmd}`);
      }
    } else {
      console.log("   (none configured - use 'ronin mcp discover' to see options)");
    }

    console.log("\nDirectories:");
    console.log(`   Built-in plugins: ${getDefaultPluginDir()}`);
    console.log(`   User plugins: ${getDefaultUserPluginDir()}`);
    console.log(`   External duties: ${config.externalDutyDir || getDefaultExternalDutyDir()}`);
    
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

  if (options.braveApiKey !== undefined) {
    const config = await loadConfig();
    if (!config.braveSearch || typeof config.braveSearch !== "object") {
      config.braveSearch = { apiKey: "" };
    }
    const braveSearch = config.braveSearch as { apiKey?: string };
    
    if (options.braveApiKey === "") {
      braveSearch.apiKey = "";
      if (Object.keys(braveSearch).length === 0) {
        delete config.braveSearch;
      }
      await saveConfig(config);
      console.log("✅ Removed Brave Search API key from configuration");
      console.log("\n💡 Note: Environment variable BRAVE_API_KEY takes precedence if set");
    } else {
      braveSearch.apiKey = options.braveApiKey;
      config.braveSearch = braveSearch;
      await saveConfig(config);
      console.log("✅ Brave Search API key saved to configuration");
      console.log("\n💡 The API key is stored in ~/.ronin/config.json");
      console.log("💡 Environment variable BRAVE_API_KEY takes precedence if set");
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

  if (options.externalDutyDir !== undefined) {
    // Set external duty directory
    const config = await loadConfig();
    
    if (options.externalDutyDir === "") {
      // Remove external duty directory
      delete config.externalDutyDir;
      await saveConfig(config);
      console.log("✅ Removed external duty directory configuration");
      console.log("\n💡 To remove from environment, edit your shell profile:");
      console.log(`   ${getShellProfile()}`);
    } else {
      // Validate path
      if (!existsSync(options.externalDutyDir)) {
        console.error(`❌ Directory does not exist: ${options.externalDutyDir}`);
        console.log("\n💡 Create the directory first, or use an existing path");
        process.exit(1);
      }
      
      config.externalDutyDir = options.externalDutyDir;
      await saveConfig(config);
      
      console.log(`✅ External duty directory set to: ${options.externalDutyDir}`);
      console.log("\n💡 To make this permanent, add to your shell profile:");
      console.log(`   ${getShellProfile()}`);
      console.log(`   export RONIN_EXTERNAL_DUTY_DIR="${options.externalDutyDir}"`);
      console.log("\n   Then reload your shell or run:");
      console.log(`   source ${getShellProfile()}`);
    }
    
    return;
  }

  if (options.dutyDir !== undefined) {
    // Set local duty directory (for this project)
    const config = await loadConfig();
    config.dutyDir = options.dutyDir;
    await saveConfig(config);
    
    console.log(`✅ Local duty directory set to: ${options.dutyDir}`);
    console.log("\n💡 This setting is project-specific and stored in ~/.ronin/config.json");
    return;
  }

  if (options.userPluginDir !== undefined) {
    // Set user plugin directory
    const config = await loadConfig();
    
    if (options.userPluginDir === "") {
      // Remove user plugin directory override
      delete config.userPluginDir;
      await saveConfig(config);
      console.log("✅ Removed user plugin directory configuration");
      console.log("\n💡 Will use default: ~/.ronin/plugins");
    } else {
      // Validate path
      if (!existsSync(options.userPluginDir)) {
        console.error(`❌ Directory does not exist: ${options.userPluginDir}`);
        console.log("\n💡 Create the directory first, or use an existing path");
        process.exit(1);
      }
      
      config.userPluginDir = options.userPluginDir;
      await saveConfig(config);
      
      console.log(`✅ User plugin directory set to: ${options.userPluginDir}`);
      console.log("\n💡 User plugins in this directory will override built-in plugins");
      console.log("💡 This setting is stored in ~/.ronin/config.json");
    }
    
    return;
  }

  if (options.init) {
    // Initialize user directories
    const dutyDir = ensureDefaultExternalAgentDir();
    const pluginDir = ensureDefaultUserPluginDir();
    const skillsDir = ensureDefaultSkillsDir();
    const configPath = getConfigPath();
    
    console.log("\n🔧 Initializing Ronin user directories...\n");
    console.log(`✅ Duties directory: ${dutyDir}`);
    console.log(`✅ Plugins directory: ${pluginDir}`);
    console.log(`✅ Skills directory: ${skillsDir}`);
    console.log(`✅ Config file: ${configPath}`);
    console.log("\n📋 Your user directories are ready!");
    console.log("\n💡 To create your first duty:");
    console.log("   ronin create duty \"My custom duty\"");
    console.log("\n💡 To add a custom plugin:");
    console.log(`   Create a .ts file in: ${pluginDir}`);
    
    return;
  }

  if (options.realmUrl !== undefined) {
    const config = await loadConfig();
    
    if (options.realmUrl === "") {
      delete config.realmUrl;
      await saveConfig(config);
      console.log("✅ Removed Realm URL from configuration");
    } else {
      config.realmUrl = options.realmUrl;
      await saveConfig(config);
      console.log(`✅ Realm URL set to: ${options.realmUrl}`);
      console.log("\n💡 The URL is stored in ~/.ronin/config.json");
      console.log("💡 Use 'ronin config --realm-callsign <callsign>' to set your call sign");
    }
    return;
  }

  if (options.realmCallsign !== undefined) {
    const config = await loadConfig();
    
    if (options.realmCallsign === "") {
      delete config.realmCallsign;
      await saveConfig(config);
      console.log("✅ Removed Realm call sign from configuration");
    } else {
      config.realmCallsign = options.realmCallsign;
      await saveConfig(config);
      console.log(`✅ Realm call sign set to: ${options.realmCallsign}`);
      console.log("\n💡 The call sign is stored in ~/.ronin/config.json");
      console.log("💡 Use 'ronin config --realm-url <url>' to set the Realm server URL");
    }
    return;
  }

  if (options.realmToken !== undefined) {
    const config = await loadConfig();
    
    if (options.realmToken === "") {
      delete config.realmToken;
      await saveConfig(config);
      console.log("✅ Removed Realm token from configuration");
    } else {
      config.realmToken = options.realmToken;
      await saveConfig(config);
      console.log("✅ Realm token saved to configuration");
      console.log("\n💡 The token is stored in ~/.ronin/config.json");
    }
    return;
  }

  if (options.realmLocalPort !== undefined) {
    const config = await loadConfig();
    
    if (options.realmLocalPort === "") {
      delete config.realmLocalPort;
      await saveConfig(config);
      console.log("✅ Removed Realm local port from configuration");
      console.log("\n💡 Will use default port: 4000");
    } else {
      const port = parseInt(options.realmLocalPort);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`❌ Invalid port number: ${options.realmLocalPort}`);
        console.log("\n💡 Port must be between 1 and 65535");
        process.exit(1);
      }
      config.realmLocalPort = options.realmLocalPort;
      await saveConfig(config);
      console.log(`✅ Realm local port set to: ${port}`);
      console.log("\n💡 The port is stored in ~/.ronin/config.json");
      console.log("💡 If the port is in use, Realm will automatically try the next available port");
    }
    return;
  }

  // Config Editor commands
  if (options.setPassword) {
    console.log(`
🔒 Config Editor Password

Current password is set via CONFIG_EDITOR_PASSWORD environment variable.

To change it:
1. Set the environment variable:
   export CONFIG_EDITOR_PASSWORD="your-new-password"

2. Restart Ronin to apply the change

Default password (if not set): "roninpass"

⚠️  Security Note:
- Use a strong password in production
- Never commit passwords to version control
- Consider using a password manager
    `);
    return;
  }

  if (options.edit) {
    console.log(`
📝 Opening Config Editor

The config editor is available at:
  http://localhost:3000/config

Default password: "roninpass" (unless changed via CONFIG_EDITOR_PASSWORD)

Features:
- Edit config via forms or raw JSON
- Automatic validation
- Backup/restore
- Hot-reload (duties auto-update)
    `);
    
    // Try to open browser
    try {
      const { exec } = await import("child_process");
      const openCommand = process.platform === "darwin" ? "open" : 
                         process.platform === "win32" ? "start" : "xdg-open";
      exec(`${openCommand} http://localhost:3000/config`);
    } catch {
      // Browser opening is optional
    }
    return;
  }

  if (options.backup) {
    console.log("💾 Creating backup...");
    try {
      const res = await fetch("http://localhost:3000/config/api/backup", {
        method: "POST",
        headers: { "Cookie": "config_session=dummy" }
      });
      if (res.ok) {
        console.log("✅ Backup created successfully");
      } else {
        console.error("❌ Failed to create backup. Is Ronin running?");
      }
    } catch {
      console.error("❌ Config editor not running. Start it with: bun run ronin start");
    }
    return;
  }

  if (options.listBackups) {
    console.log("📜 Listing backups...");
    try {
      const res = await fetch("http://localhost:3000/config/api/backups", {
        headers: { "Cookie": "config_session=dummy" }
      });
      if (res.ok) {
        const data = await res.json();
        console.log("\nBackups:");
        if (data.backups && data.backups.length > 0) {
          data.backups.forEach((backup: any) => {
            console.log(`  ${backup.id} - ${new Date(backup.timestamp).toLocaleString()}`);
            console.log(`    ${backup.description}`);
          });
        } else {
          console.log("  No backups found");
        }
      } else {
        console.error("❌ Failed to list backups");
      }
    } catch {
      console.error("❌ Config editor not running. Start it with: bun run ronin start");
    }
    return;
  }

  if (options.restore) {
    console.log(`🔄 Restoring from backup: ${options.restore}`);
    try {
      const res = await fetch("http://localhost:3000/config/api/restore", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Cookie": "config_session=dummy"
        },
        body: JSON.stringify({ backupId: options.restore })
      });
      if (res.ok) {
        console.log("✅ Config restored successfully");
      } else {
        const error = await res.json();
        console.error("❌ Restore failed:", error.error);
      }
    } catch {
      console.error("❌ Config editor not running. Start it with: bun run ronin start");
    }
    return;
  }

  if (options.export) {
    console.log(`📤 Exporting config to: ${options.export}`);
    try {
      const res = await fetch("http://localhost:3000/config/api/current");
      if (res.ok) {
        const config = await res.json();
        await Bun.write(options.export!, JSON.stringify(config, null, 2));
        console.log("✅ Config exported successfully");
      } else {
        console.error("❌ Failed to export config");
      }
    } catch {
      console.error("❌ Config editor not running. Start it with: bun run ronin start");
    }
    return;
  }

  if (options.importPath) {
    console.log(`📥 Importing config from: ${options.importPath}`);
    try {
      const content = await Bun.file(options.importPath).text();
      const config = JSON.parse(content);
      
      const res = await fetch("http://localhost:3000/config/api/update", {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Cookie": "config_session=dummy"
        },
        body: JSON.stringify(config)
      });
      
      if (res.ok) {
        console.log("✅ Config imported successfully");
      } else {
        const error = await res.json();
        console.error("❌ Import failed:", error.errors || error.error);
      }
    } catch (err) {
      console.error("❌ Import failed:", err);
    }
    return;
  }

  if (options.validate) {
    console.log("✅ Validating config...");
    try {
      const res = await fetch("http://localhost:3000/config/api/validate");
      const result = await res.json();
      
      if (result.valid) {
        console.log("✅ Config is valid");
      } else {
        console.error("❌ Validation errors:");
        result.errors.forEach((err: string) => console.error(`  - ${err}`));
        process.exit(1);
      }
    } catch {
      console.error("❌ Config editor not running. Start it with: bun run ronin start");
    }
    return;
  }

  // No options provided, show help
  console.log(`
📋 Ronin Configuration

Usage:
  ronin config --show                    Show current configuration
  ronin config --init                    Initialize user directories (~/.ronin/)
  ronin config --duty-dir <path>        Set local duty directory
  ronin config --external-duty-dir <path>  Set external duty directory
  ronin config --external-duty-dir ""   Remove external duty directory
  ronin config --user-plugin-dir <path>  Set user plugin directory
  ronin config --user-plugin-dir ""      Remove user plugin directory
  ronin config --grok-api-key <key>      Set Grok API key
  ronin config --grok-api-key ""         Remove Grok API key
  ronin config --gemini-api-key <key>     Set Gemini API key
  ronin config --gemini-api-key ""        Remove Gemini API key
  ronin config --brave-api-key <key>      Set Brave Search API key (for MCP web search)
  ronin config --brave-api-key ""         Remove Brave Search API key
  ronin config --gemini-model <model>     Set Gemini model (e.g., gemini-1.5-pro)
  ronin config --gemini-model ""          Remove Gemini model (use default)
  ronin config --realm-url <url>          Set Realm discovery server URL
  ronin config --realm-url ""             Remove Realm URL
  ronin config --realm-callsign <callsign> Set Realm call sign
  ronin config --realm-callsign ""        Remove Realm call sign
  ronin config --realm-token <token>      Set Realm authentication token
  ronin config --realm-token ""           Remove Realm token
  ronin config --realm-local-port <port>  Set Realm local WebSocket port
  ronin config --realm-local-port ""      Remove Realm local port (use default: 4000)

Config Editor (Web UI):
  ronin config --edit                    Open config editor in browser
  ronin config --set-password            Show password configuration help
  ronin config --backup                  Create manual backup
  ronin config --list-backups            List all backups
  ronin config --restore <id>            Restore from backup
  ronin config --export <path>           Export config to file
  ronin config --import <path>           Import config from file
  ronin config --validate                Validate current config

Examples:
  ronin config --init                    Initialize user directories
  ronin config --show
  ronin config --external-duty-dir ~/my-duties
  ronin config --duty-dir ./custom-duties
  ronin config --user-plugin-dir ~/my-plugins
  ronin config --grok-api-key sk-xxxxx
  ronin config --gemini-api-key AIxxxxx
  ronin config --brave-api-key <key>      # Get from brave.com/search/api
  ronin config --gemini-model gemini-1.5-flash
  ronin config --realm-url wss://realm.afiwi.net
  ronin config --realm-callsign Roninito
  ronin config --realm-local-port 4001
  
  # Config Editor
  ronin config --edit                    Open web editor
  ronin config --backup                  Create backup
  ronin config --export ./my-config.json Export config

Note: 
  - API keys can also be set via environment variables (takes precedence)
  - External duty directory can also be set via RONIN_EXTERNAL_DUTY_DIR
  - User plugins in ~/.ronin/plugins override built-in plugins
  - Configuration is stored in ~/.ronin/config.json
  - Once Realm URL and call sign are configured, 'ronin start' will automatically connect
  - Config Editor password: CONFIG_EDITOR_PASSWORD env var (default: "roninpass")
`);
}

