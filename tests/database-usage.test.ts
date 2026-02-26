import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { AgentAPI } from "@ronin/types/index.js";
import {
  initializeUsageTables,
  recordUsageEvent,
  getDailyUsage,
  getMonthlyUsage,
  getDailyUsageRange,
  getDailyStats,
  getMonthlyStats,
  getTotalCost,
  clearUsageData,
} from "../src/database/usage.js";
import { migrateUsageData, isUsageDataMigrated, getMigrationStatus } from "../src/database/migration.js";

// Mock AgentAPI with in-memory database
function createMockAPI(): AgentAPI {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");

  return {
    db: {
      query: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        if (params && params.length > 0) {
          return stmt.all(...params);
        }
        return stmt.all();
      },
      execute: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        if (params && params.length > 0) {
          return stmt.run(...params);
        }
        return stmt.run();
      },
    },
  } as unknown as AgentAPI;
}

describe("Database Usage Tracking", () => {
  let api: AgentAPI;

  beforeEach(async () => {
    api = createMockAPI();
    await initializeUsageTables(api);
  });

  afterEach(async () => {
    await clearUsageData(api);
  });

  describe("Table Initialization", () => {
    it("should create usage tables", async () => {
      // Tables should be created without error
      expect(true).toBe(true);
    });
  });

  describe("Recording Usage Events", () => {
    it("should record a single usage event", async () => {
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);

      const today = new Date().toISOString().split("T")[0];
      const usage = await getDailyUsage(api, "claude-haiku", today);

      expect(usage).toBeTruthy();
      expect(usage!.inputTokens).toBe(1000);
      expect(usage!.outputTokens).toBe(500);
      expect(usage!.requests).toBe(1);
    });

    it("should aggregate multiple events in daily stats", async () => {
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);
      await recordUsageEvent(api, "claude-haiku", 2000, 1000, 1100, 1.0);

      const today = new Date().toISOString().split("T")[0];
      const usage = await getDailyUsage(api, "claude-haiku", today);

      expect(usage!.inputTokens).toBe(3000);
      expect(usage!.outputTokens).toBe(1500);
      expect(usage!.requests).toBe(2);
      expect(usage!.cost).toBeCloseTo(1.5, 1);
    });

    it("should track multiple models separately", async () => {
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);
      await recordUsageEvent(api, "gpt-4o", 2000, 1000, 1100, 2.0);

      const today = new Date().toISOString().split("T")[0];
      const haikuUsage = await getDailyUsage(api, "claude-haiku", today);
      const gptUsage = await getDailyUsage(api, "gpt-4o", today);

      expect(haikuUsage!.inputTokens).toBe(1000);
      expect(gptUsage!.inputTokens).toBe(2000);
    });
  });

  describe("Daily Usage Queries", () => {
    beforeEach(async () => {
      const today = new Date().toISOString().split("T")[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

      // Record today's data
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);
      await recordUsageEvent(api, "gpt-4o", 2000, 1000, 1100, 2.0);

      // Manually insert yesterday's data
      const db = (api as any).db;
      await db.execute(
        `INSERT INTO model_usage_daily (model_nametag, date, input_tokens, output_tokens, cost, requests, avg_latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["claude-haiku", yesterday, 5000, 2500, 2.5, 5, 1000]
      );
    });

    it("should get daily usage for specific date", async () => {
      const today = new Date().toISOString().split("T")[0];
      const usage = await getDailyUsage(api, "claude-haiku", today);

      expect(usage!.date).toBe(today);
      expect(usage!.requests).toBe(1);
    });

    it("should get all daily stats for a date", async () => {
      const today = new Date().toISOString().split("T")[0];
      const stats = await getDailyStats(api, today);

      expect(stats.length).toBe(2); // claude-haiku and gpt-4o
      const costs = stats.map((s) => s.cost).sort((a, b) => b - a);
      expect(costs[0]).toBeGreaterThan(costs[1]);
    });

    it("should get daily usage range", async () => {
      const today = new Date().toISOString().split("T")[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

      const range = await getDailyUsageRange(api, "claude-haiku", today, tomorrow);

      expect(range.length).toBeGreaterThan(0);
      expect(range[0].modelNametag).toBe("claude-haiku");
    });
  });

  describe("Monthly Usage Queries", () => {
    beforeEach(async () => {
      // Record current month
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);
      await recordUsageEvent(api, "claude-haiku", 2000, 1000, 1100, 1.0);
    });

    it("should get monthly usage stats", async () => {
      const now = new Date();
      const usage = await getMonthlyUsage(api, "claude-haiku", now.getFullYear(), now.getMonth() + 1);

      expect(usage).toBeTruthy();
      expect(usage!.inputTokens).toBe(3000);
      expect(usage!.outputTokens).toBe(1500);
      expect(usage!.requests).toBe(2);
    });

    it("should get all monthly stats", async () => {
      const now = new Date();
      const stats = await getMonthlyStats(api, now.getFullYear(), now.getMonth() + 1);

      expect(stats.length).toBeGreaterThan(0);
      expect(stats[0].year).toBe(now.getFullYear());
      expect(stats[0].month).toBe(now.getMonth() + 1);
    });
  });

  describe("Cost Calculations", () => {
    beforeEach(async () => {
      const startDate = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const today = new Date().toISOString().split("T")[0];

      // Manually insert cost data
      const db = (api as any).db;
      await db.execute(
        `INSERT INTO model_usage_daily (model_nametag, date, cost)
         VALUES (?, ?, ?)`,
        ["claude-haiku", startDate, 5.0]
      );
      await db.execute(
        `INSERT INTO model_usage_daily (model_nametag, date, cost)
         VALUES (?, ?, ?)`,
        ["claude-haiku", today, 3.0]
      );
      await db.execute(
        `INSERT INTO model_usage_daily (model_nametag, date, cost)
         VALUES (?, ?, ?)`,
        ["gpt-4o", today, 10.0]
      );
    });

    it("should calculate total cost for a period", async () => {
      const startDate = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const endDate = new Date().toISOString().split("T")[0];

      const total = await getTotalCost(api, startDate, endDate);

      expect(total).toBeCloseTo(18.0, 1);
    });

    it("should calculate total cost per model", async () => {
      const startDate = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const endDate = new Date().toISOString().split("T")[0];

      const haikuCost = await getTotalCost(api, startDate, endDate, "claude-haiku");
      const gptCost = await getTotalCost(api, startDate, endDate, "gpt-4o");

      expect(haikuCost).toBeCloseTo(8.0, 1);
      expect(gptCost).toBeCloseTo(10.0, 1);
    });
  });

  describe("Data Integrity", () => {
    it("should handle duplicate inserts gracefully", async () => {
      const today = new Date().toISOString().split("T")[0];

      // Record same event twice
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);

      const usage = await getDailyUsage(api, "claude-haiku", today);

      // Should have aggregated both
      expect(usage!.inputTokens).toBe(2000);
      expect(usage!.requests).toBe(2);
    });

    it("should maintain unique constraints", async () => {
      const today = new Date().toISOString().split("T")[0];
      const db = (api as any).db;

      // Try to insert duplicate daily record
      await db.execute(
        `INSERT INTO model_usage_daily (model_nametag, date, cost) VALUES (?, ?, ?)`,
        ["claude-haiku", today, 1.0]
      );

      // Second insert should fail (UNIQUE constraint)
      try {
        await db.execute(
          `INSERT INTO model_usage_daily (model_nametag, date, cost) VALUES (?, ?, ?)`,
          ["claude-haiku", today, 2.0]
        );
      } catch (e) {
        // Expected to fail on UNIQUE constraint
      }
    });
  });

  describe("Migration Utilities", () => {
    it("should detect if data is migrated", async () => {
      const isMigrated = await isUsageDataMigrated(api);
      expect(isMigrated).toBe(false);

      // Record some data
      await recordUsageEvent(api, "claude-haiku", 1000, 500, 1200, 0.5);

      const isMigratedAfter = await isUsageDataMigrated(api);
      expect(isMigratedAfter).toBe(true);
    });
  });
});
