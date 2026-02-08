import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, basename } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { ensureUserConfigDir, getUserConfigDir } from "./paths.js";

/**
 * Configuration file mapping
 * Maps base config files to their destinations in ~/.ronin/configs/
 */
const CONFIG_FILES: Record<string, string> = {
  // Base path -> User path (relative to ~/.ronin/configs/)
  "tsconfig.json": "tsconfig.json",
};

/**
 * ConfigManager handles copying and managing configuration files
 * from the base app to the user's home directory
 */
export class ConfigManager {
  private baseDir: string;
  private userConfigDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.userConfigDir = getUserConfigDir();
  }

  /**
   * Initialize user configuration directory
   * Copies base config files to ~/.ronin/configs/ if they don't exist
   */
  async initialize(): Promise<void> {
    // Ensure user config directory exists
    ensureUserConfigDir();

    // Copy each config file if user doesn't have it
    for (const [basePath, userPath] of Object.entries(CONFIG_FILES)) {
      await this.copyIfNotExists(basePath, userPath);
    }
  }

  /**
   * Copy a config file from base to user directory if it doesn't exist
   */
  private async copyIfNotExists(basePath: string, userPath: string): Promise<void> {
    const sourcePath = join(this.baseDir, basePath);
    const destPath = join(this.userConfigDir, userPath);

    // Check if source exists
    if (!existsSync(sourcePath)) {
      return; // Source doesn't exist, skip
    }

    // Check if user already has this config
    if (existsSync(destPath)) {
      return; // User already has a config, don't overwrite
    }

    // Ensure parent directory exists
    const parentDir = join(destPath, "..");
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    try {
      // Copy file
      await copyFileSync(sourcePath, destPath);
      console.log(`📋 Copied ${basePath} to user config directory`);
    } catch (error) {
      console.warn(`Failed to copy ${basePath}:`, error);
    }
  }

  /**
   * Get the path to a config file
   * Returns user path if it exists, otherwise base path
   */
  getConfigPath(filename: string): string {
    const userPath = join(this.userConfigDir, filename);
    
    // Check user directory first
    if (existsSync(userPath)) {
      return userPath;
    }

    // Fall back to base directory
    return join(this.baseDir, filename);
  }

  /**
   * Load a config file
   * Tries user directory first, then base directory
   */
  async loadConfig(filename: string): Promise<Record<string, unknown> | null> {
    const configPath = this.getConfigPath(filename);

    if (!existsSync(configPath)) {
      return null;
    }

    try {
      const content = await readFile(configPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to load config ${filename}:`, error);
      return null;
    }
  }

  /**
   * Save a config file to user directory
   */
  async saveConfig(filename: string, config: Record<string, unknown>): Promise<void> {
    const userPath = join(this.userConfigDir, filename);
    
    // Ensure parent directory exists
    const parentDir = join(userPath, "..");
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    await writeFile(userPath, JSON.stringify(config, null, 2));
  }

  /**
   * List all config files in user directory
   */
  listUserConfigs(): string[] {
    if (!existsSync(this.userConfigDir)) {
      return [];
    }

    // This would need fs.readdir implementation
    // For now, return known configs
    return Object.values(CONFIG_FILES);
  }

  /**
   * Check if a config exists in user directory
   */
  hasUserConfig(filename: string): boolean {
    const userPath = join(this.userConfigDir, filename);
    return existsSync(userPath);
  }

  /**
   * Copy a specific config file to user directory
   * Overwrites existing if force=true
   */
  async copyToUser(filename: string, force: boolean = false): Promise<boolean> {
    const sourcePath = join(this.baseDir, filename);
    const destPath = join(this.userConfigDir, filename);

    if (!existsSync(sourcePath)) {
      console.warn(`Source config not found: ${filename}`);
      return false;
    }

    if (existsSync(destPath) && !force) {
      console.log(`User config already exists: ${filename} (use --force to overwrite)`);
      return false;
    }

    try {
      // Ensure parent directory exists
      const parentDir = join(destPath, "..");
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }

      copyFileSync(sourcePath, destPath);
      console.log(`✅ Copied ${filename} to user config directory`);
      return true;
    } catch (error) {
      console.error(`Failed to copy ${filename}:`, error);
      return false;
    }
  }
}

/**
 * Global config manager instance
 */
let globalConfigManager: ConfigManager | null = null;

/**
 * Get or create the global config manager
 */
export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager();
  }
  return globalConfigManager;
}

/**
 * Initialize configuration on first run
 * Call this early in the application lifecycle
 */
export async function initializeConfig(): Promise<void> {
  const manager = getConfigManager();
  await manager.initialize();
}

