import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentAPI } from "../types/index.js";
import { KataRegistry } from "./registry.js";

/**
 * Loads .kata files from project and user directories into the DB.
 * Mirrors the AgentLoader / PluginLoader pattern.
 */
export class KataLoader {
  private dirs: string[];

  constructor(projectRoot = process.cwd()) {
    this.dirs = [
      join(projectRoot, "katas"),
      join(homedir(), ".ronin", "katas"),
    ].filter(existsSync);
  }

  discover(): string[] {
    const files: string[] = [];
    for (const dir of this.dirs) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".kata")) {
            files.push(join(dir, entry.name));
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
    return files;
  }

  async loadAll(api: AgentAPI): Promise<{ loaded: number; skipped: number; errors: string[] }> {
    const registry = new KataRegistry(api);
    const files = this.discover();
    let loaded = 0, skipped = 0;
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const source = readFileSync(filePath, "utf-8");
        // Parse first to get name+version for existence check
        const ast = (registry as any).parser.parse(source);
        const compiled = (registry as any).compiler.compile(ast);
        const exists = await (registry as any).storage.exists(compiled.name, compiled.version);
        if (exists) {
          skipped++;
          continue;
        }
        await registry.register(source);
        loaded++;
      } catch (err: any) {
        const msg = `Error loading ${filePath}: ${err.message}`;
        errors.push(msg);
        console.warn(`[kata-loader] ${msg}`);
      }
    }

    return { loaded, skipped, errors };
  }
}
