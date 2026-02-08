/**
 * Configuration Service
 * Centralized configuration management with precedence:
 * 1. Environment variables (highest priority)
 * 2. Config file (~/.ronin/config.json)
 * 3. Default values (lowest priority)
 */

import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { FullConfig, ConfigPath } from "./types.js";
import { DEFAULT_CONFIG, ENV_MAPPINGS } from "./defaults.js";

export class ConfigService {
  private config: FullConfig;
  private configPath: string;
  private envOverrides: Set<string> = new Set();

  constructor() {
    this.configPath = join(homedir(), ".ronin", "config.json");
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); // Deep copy
  }

  /**
   * Load configuration from all sources
   * Call this once at startup
   */
  async load(): Promise<void> {
    // Start with defaults (already set in constructor)
    
    // Layer 2: Load from config file
    await this.loadFromFile();
    
    // Layer 1: Override with environment variables (highest priority)
    this.loadFromEnv();
    
    console.log("[ConfigService] Configuration loaded successfully");
  }

  /**
   * Load configuration from file
   */
  private async loadFromFile(): Promise<void> {
    if (!existsSync(this.configPath)) {
      return;
    }

    try {
      const file = Bun.file(this.configPath);
      const content = await file.text();
      const fileConfig = JSON.parse(content);
      
      // Merge file config into defaults
      this.mergeConfig(this.config, fileConfig);
      
      console.log(`[ConfigService] Loaded config from ${this.configPath}`);
    } catch (error) {
      console.warn(`[ConfigService] Failed to load config file: ${error}`);
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnv(): void {
    for (const [configPath, envVar] of Object.entries(ENV_MAPPINGS)) {
      const envValue = process.env[envVar];
      if (envValue !== undefined) {
        this.setValueByPath(this.config, configPath, this.parseEnvValue(envValue));
        this.envOverrides.add(configPath);
      }
    }

    // Log which values are overridden by env vars (without showing sensitive values)
    const overrideCount = this.envOverrides.size;
    if (overrideCount > 0) {
      console.log(`[ConfigService] ${overrideCount} values overridden by environment variables`);
    }
  }

  /**
   * Parse environment variable value (handle booleans, numbers, arrays)
   */
  private parseEnvValue(value: string): string | boolean | number | string[] {
    // Handle boolean strings
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
    
    // Handle numbers
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    
    // Handle comma-separated arrays
    if (value.includes(",")) {
      return value.split(",").map(v => v.trim()).filter(v => v);
    }
    
    return value;
  }

  /**
   * Merge config objects deeply
   */
  private mergeConfig(target: any, source: any): void {
    for (const key in source) {
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this.mergeConfig(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  /**
   * Set a value by dot-notation path
   */
  private setValueByPath(obj: any, path: string, value: any): void {
    const keys = path.split(".");
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  /**
   * Get a value by dot-notation path
   */
  private getValueByPath(obj: any, path: string): any {
    const keys = path.split(".");
    let current = obj;
    
    for (const key of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    
    return current;
  }

  /**
   * Get config value by path
   */
  get<T>(path: ConfigPath): T {
    return this.getValueByPath(this.config, path) as T;
  }

  /**
   * Get full configuration object
   */
  getAll(): FullConfig {
    return JSON.parse(JSON.stringify(this.config)); // Return deep copy
  }

  /**
   * Get Telegram configuration
   */
  getTelegram() {
    return this.config.telegram;
  }

  /**
   * Get Discord configuration
   */
  getDiscord() {
    return this.config.discord;
  }

  /**
   * Get AI configuration
   */
  getAI() {
    return this.config.ai;
  }

  /**
   * Get Gemini configuration
   */
  getGemini() {
    return this.config.gemini;
  }

  /**
   * Get Grok configuration
   */
  getGrok() {
    return this.config.grok;
  }

  /**
   * Get System configuration
   */
  getSystem() {
    return this.config.system;
  }

  /**
   * Get CLI options
   */
  getCLIOptions() {
    return this.config.cliOptions;
  }

  /**
   * Get Event Monitor configuration
   */
  getEventMonitor() {
    return this.config.eventMonitor;
  }

  /**
   * Get Blog Boy configuration
   */
  getBlogBoy() {
    return this.config.blogBoy;
  }

  /**
   * Get Config Editor configuration
   */
  getConfigEditor() {
    return this.config.configEditor;
  }

  /**
   * Get RSS to Telegram configuration
   */
  getRssToTelegram() {
    return this.config.rssToTelegram;
  }

  /**
   * Get Realm configuration
   */
  getRealm() {
    return this.config.realm;
  }

  /**
   * Check if a value came from environment variable
   */
  isFromEnv(path: ConfigPath): boolean {
    return this.envOverrides.has(path);
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Save configuration to file
   * Note: Environment variables are not saved, they remain in env only
   */
  async saveConfig(config: FullConfig): Promise<void> {
    await Bun.write(this.configPath, JSON.stringify(config, null, 2));
    this.config = JSON.parse(JSON.stringify(config));
    console.log(`[ConfigService] Config saved to ${this.configPath}`);
  }

  /**
   * Reload configuration from file
   * Useful when config is edited externally
   */
  async reload(): Promise<void> {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    await this.load();
  }
}

// Singleton instance
let configService: ConfigService | null = null;

/**
 * Get or create ConfigService singleton
 */
export function getConfigService(): ConfigService {
  if (!configService) {
    configService = new ConfigService();
  }
  return configService;
}

/**
 * Reset ConfigService (useful for testing)
 */
export function resetConfigService(): void {
  configService = null;
}
