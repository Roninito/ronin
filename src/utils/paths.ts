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
