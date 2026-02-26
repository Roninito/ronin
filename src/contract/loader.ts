import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentAPI } from "../types/index.js";
import { ContractParserV2, ContractParseError } from "./parser-v2.js";
import { ContractStorageV2 } from "./storage-v2.js";

/**
 * Loads .contract files from project and user directories into the DB.
 * Mirrors the AgentLoader / PluginLoader pattern.
 */
export class ContractLoader {
  private dirs: string[];

  constructor(projectRoot = process.cwd()) {
    this.dirs = [
      join(projectRoot, "contracts"),
      join(homedir(), ".ronin", "contracts"),
    ].filter(existsSync);
  }

  discover(): string[] {
    const files: string[] = [];
    for (const dir of this.dirs) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".contract")) {
            files.push(join(dir, entry.name));
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
    return files;
  }

  async loadAll(api: AgentAPI): Promise<{ loaded: number; skipped: number; errors: string[] }> {
    const storage = new ContractStorageV2(api);
    await storage.init();
    const parser = new ContractParserV2();
    const files = this.discover();
    let loaded = 0, skipped = 0;
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const source = readFileSync(filePath, "utf-8");
        const def = parser.parse(source);
        const existing = await storage.getByName(def.name);
        if (existing && existing.version === (def.version ?? "v1")) {
          skipped++;
          continue;
        }
        // Delete old version before re-inserting
        if (existing) {
          await api.db?.execute?.(`DELETE FROM contracts_v2 WHERE name = ?`, [def.name]);
        }
        await storage.create(def);
        loaded++;
      } catch (err: any) {
        const msg = err instanceof ContractParseError
          ? `Parse error in ${filePath}: ${err.message}`
          : `Error loading ${filePath}: ${err.message}`;
        errors.push(msg);
        console.warn(`[contract-loader] ${msg}`);
      }
    }

    return { loaded, skipped, errors };
  }
}
