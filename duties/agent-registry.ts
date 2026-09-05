/**
 * @enabled true
 * Duty Registry — Scans and catalogs all duties in the system
 * Extracts metadata and dependencies to populate dashboard
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

interface DutyMetadata {
  name: string;
  enabled: boolean;
  schedule?: string;
  watch?: string[];
  webhook?: string;
  requiredPlugins: string[];
  emitsEvents: string[];
  consumesEvents: string[];
  description?: string;
  source: "project" | "user";
}

export default class DutyRegistry extends BaseDuty {
  static schedule = "0 * * * *"; // Every hour
  static description = "Scans and catalogs all duties in the system";

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      const metadata = await this.scanDuties();
      await this.api.memory.store("agent-registry", metadata);
      console.log(`[agent-registry] Cataloged ${metadata.length} duties`);
    } catch (error) {
      console.error("[agent-registry] Error scanning duties:", error);
    }
  }

  /**
   * Scan all duty files from project and user directories
   */
  private async scanDuties(): Promise<DutyMetadata[]> {
    const duties: DutyMetadata[] = [];

    const projectDir = join(process.cwd(), "duties");
    const userDir = process.env.RONIN_EXTERNAL_DUTY_DIR ?? join(homedir(), ".ronin", "duties");

    const dirs: Array<{ dir: string; source: "project" | "user" }> = [
      { dir: projectDir, source: "project" },
      { dir: userDir, source: "user" },
    ];

    for (const { dir, source } of dirs) {
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (!file.endsWith(".ts")) continue;
          const filePath = join(dir, file);
          try {
            const content = await readFile(filePath, "utf-8");
            const metadata = this.parseDutyFile(file, content, source);
            if (metadata) {
              duties.push(metadata);
            }
          } catch (error) {
            console.warn(`[agent-registry] Failed to parse ${file}:`, error);
          }
        }
      } catch {
        // Directory doesn't exist, skip silently
      }
    }

    return duties;
  }

  /**
   * Parse a single duty file and extract metadata
   */
  private parseDutyFile(filename: string, content: string, source: "project" | "user"): DutyMetadata | null {
    const name = filename.replace(/\.ts$/, "");

    // Check if enabled (default true)
    const enabledMatch = content.match(/@enabled\s+(true|false|"true"|"false")/i);
    const enabled = !enabledMatch || enabledMatch[1] !== "false";

    // Extract static schedule
    const scheduleMatch = content.match(/static\s+schedule\s*=\s*["']([^"']+)["']/);
    const schedule = scheduleMatch?.[1];

    // Extract static watch
    const watchMatches = [...content.matchAll(/static\s+watch\s*=\s*\[([\s\S]*?)\]/g)];
    const watch: string[] = [];
    for (const match of watchMatches) {
      // match[1] is the regex's one non-optional capturing group — always present
      // (possibly empty) whenever the outer regex matches at all.
      const items = match[1]!.match(/["']([^"']+)["']/g);
      if (items) {
        watch.push(...items.map((s) => s.replace(/["']/g, "")));
      }
    }

    // Extract static webhook
    const webhookMatch = content.match(/static\s+webhook\s*=\s*["']([^"']+)["']/);
    const webhook = webhookMatch?.[1];

    // Extract description
    const descMatch = content.match(/static\s+description\s*=\s*["']([^"']+)["']/);
    const description = descMatch?.[1];

    // Extract API plugin usage (this.api.PLUGIN)
    // m[1] is each regex's one non-optional capturing group — always present whenever
    // matchAll finds a match at all.
    const pluginUsageMatches = [...content.matchAll(/this\.api\.(\w+)\./g)];
    const requiredPlugins = [...new Set(pluginUsageMatches.map((m) => m[1]!))];

    // Extract event emissions
    const emitMatches = [...content.matchAll(/this\.api\.events\.emit\(["']([^"']+)["']/g)];
    const emitsEvents = [...new Set(emitMatches.map((m) => m[1]!))];

    // Extract event listeners
    const onMatches = [...content.matchAll(/this\.api\.events\.on\(["']([^"']+)["']/g)];
    const consumesEvents = [...new Set(onMatches.map((m) => m[1]!))];

    return {
      name,
      enabled,
      schedule,
      watch: watch.length > 0 ? watch : undefined,
      webhook,
      description,
      requiredPlugins: requiredPlugins.filter((p) => p !== "memory" && p !== "files" && p !== "events"),
      emitsEvents,
      consumesEvents,
      source,
    };
  }
}
