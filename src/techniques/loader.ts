import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentAPI } from "../types/index.js";
import { TechniqueParser, TechniqueParseError } from "./parser.js";
import { TechniqueStorage } from "./storage.js";

/**
 * Loads .technique files from project and user directories into the DB.
 * Mirrors the AgentLoader / PluginLoader pattern.
 */
export class TechniqueLoader {
  private dirs: string[];

  constructor(projectRoot = process.cwd()) {
    this.dirs = [
      join(projectRoot, "techniques"),
      join(homedir(), ".ronin", "techniques"),
    ].filter(existsSync);
  }

  discover(): string[] {
    const files: string[] = [];
    for (const dir of this.dirs) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".technique")) {
            files.push(join(dir, entry.name));
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
    return files;
  }

  async loadAll(api: AgentAPI): Promise<{ loaded: number; skipped: number; errors: string[] }> {
    const storage = new TechniqueStorage(api);
    await storage.init();
    const parser = new TechniqueParser();
    const files = this.discover();
    let loaded = 0, skipped = 0;
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const source = readFileSync(filePath, "utf-8");
        const def = parser.parse(source);
        const existing = await storage.getByName(def.name);
        if (existing && existing.version === def.version && !existing.deprecated) {
          skipped++;
          continue;
        }
        // Delete old (deprecated or outdated) before re-inserting
        if (existing) await storage.delete(def.name);
        await storage.save(def);
        loaded++;
      } catch (err: any) {
        const msg = err instanceof TechniqueParseError
          ? `Parse error in ${filePath}: ${err.message}`
          : `Error loading ${filePath}: ${err.message}`;
        errors.push(msg);
        console.warn(`[technique-loader] ${msg}`);
      }
    }

    return { loaded, skipped, errors };
  }
}
