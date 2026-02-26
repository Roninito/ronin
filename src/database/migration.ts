/**
 * Migration utility for usage statistics
 * Moves data from JSON registry to SQLite database
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentAPI } from "@ronin/types/index.js";
import type { ModelRegistry } from "@ronin/types/model.js";
import { recordUsageEvent } from "./usage.js";

/**
 * Load model registry from file
 */
function loadRegistry(path: string): ModelRegistry | null {
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Migrate usage data from JSON to database
 * Reads existing daily/monthly stats from registry and imports into DB
 */
export async function migrateUsageData(api: AgentAPI): Promise<number> {
  // Load registry
  const repoPath = join(process.cwd(), ".ronin", "ai-models.json");
  const userPath = join(homedir(), ".ronin", "ai-models.json");

  const repoRegistry = loadRegistry(repoPath);
  const userRegistry = loadRegistry(userPath);

  // Merge registries (user overrides repo)
  const registry = repoRegistry
    ? userRegistry
      ? { ...repoRegistry, usage: { ...repoRegistry.usage, ...userRegistry.usage } }
      : repoRegistry
    : userRegistry;

  if (!registry || !registry.usage || Object.keys(registry.usage).length === 0) {
    console.log("No usage data to migrate");
    return 0;
  }

  const db = api.db;
  let migratedCount = 0;

  // For each model in usage tracking
  for (const [modelNametag, usageData] of Object.entries(registry.usage)) {
    const data = usageData as any;

    // Migrate "today" data (assumed to be current date)
    if (data.today && data.today.requests > 0) {
      const today = new Date().toISOString().split("T")[0];
      const model = registry.models[modelNametag];

      if (model) {
        try {
          await db.execute(
            `INSERT OR IGNORE INTO model_usage_daily
             (model_nametag, date, input_tokens, output_tokens, cost, requests, avg_latency_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              modelNametag,
              today,
              data.today.inputTokens,
              data.today.outputTokens,
              data.today.cost,
              data.today.requests,
              data.today.avgLatency,
            ]
          );
          migratedCount++;
        } catch (e) {
          console.error(`Failed to migrate daily data for ${modelNametag}:`, e);
        }
      }
    }

    // Migrate "thisMonth" data (assumed to be current month)
    if (data.thisMonth && data.thisMonth.requests > 0) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const model = registry.models[modelNametag];

      if (model) {
        try {
          await db.execute(
            `INSERT OR IGNORE INTO model_usage_monthly
             (model_nametag, year, month, input_tokens, output_tokens, cost, requests, avg_latency_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              modelNametag,
              year,
              month,
              data.thisMonth.inputTokens,
              data.thisMonth.outputTokens,
              data.thisMonth.cost,
              data.thisMonth.requests,
              data.thisMonth.avgLatency,
            ]
          );
          migratedCount++;
        } catch (e) {
          console.error(`Failed to migrate monthly data for ${modelNametag}:`, e);
        }
      }
    }
  }

  return migratedCount;
}

/**
 * Check if usage data has been migrated
 */
export async function isUsageDataMigrated(api: AgentAPI): Promise<boolean> {
  const db = api.db;

  try {
    const result = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM model_usage_daily`
    );
    return (result?.[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(api: AgentAPI): Promise<{
  isMigrated: boolean;
  jsonRecords: number;
  dbRecords: number;
}> {
  const repoPath = join(process.cwd(), ".ronin", "ai-models.json");
  const userPath = join(homedir(), ".ronin", "ai-models.json");

  const repoRegistry = loadRegistry(repoPath);
  const userRegistry = loadRegistry(userPath);

  const registry = repoRegistry
    ? userRegistry
      ? { ...repoRegistry, usage: { ...repoRegistry.usage, ...userRegistry.usage } }
      : repoRegistry
    : userRegistry;

  let jsonRecords = 0;
  if (registry?.usage) {
    for (const usageData of Object.values(registry.usage)) {
      const data = usageData as any;
      if (data.today?.requests) jsonRecords++;
      if (data.thisMonth?.requests) jsonRecords++;
    }
  }

  const db = api.db;
  let dbRecords = 0;

  try {
    const dailyResult = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM model_usage_daily`
    );
    const monthlyResult = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM model_usage_monthly`
    );

    dbRecords = (dailyResult?.[0]?.count ?? 0) + (monthlyResult?.[0]?.count ?? 0);
  } catch {
    // DB tables might not exist
  }

  return {
    isMigrated: dbRecords > 0,
    jsonRecords,
    dbRecords,
  };
}
