import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Default data directory for Ronin assets
 */
export function getRoninDataDir(): string {
  return join(homedir(), ".ronin", "data");
}

/**
 * Ensure the Ronin data directory exists
 */
export function ensureRoninDataDir(): string {
  const dataDir = getRoninDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/**
 * Default user plugins directory
 */
export function getUserPluginDir(): string {
  return join(homedir(), ".ronin", "plugins");
}

/**
 * Ensure the user plugins directory exists
 */
export function ensureUserPluginDir(): string {
  const pluginDir = getUserPluginDir();
  if (!existsSync(pluginDir)) {
    mkdirSync(pluginDir, { recursive: true });
  }
  return pluginDir;
}

/**
 * Default user configs directory
 */
export function getUserConfigDir(): string {
  return join(homedir(), ".ronin", "configs");
}

/**
 * Ensure the user configs directory exists
 */
export function ensureUserConfigDir(): string {
  const configDir = getUserConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}

/**
 * Ronin base directory in home
 */
export function getRoninDir(): string {
  return join(homedir(), ".ronin");
}

/**
 * Ensure the Ronin base directory exists
 */
export function ensureRoninDir(): string {
  const dir = getRoninDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
