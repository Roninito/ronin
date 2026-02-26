/**
 * Model Selector with Database Usage Tracking
 * 
 * Enhanced version that uses SQLite for usage tracking instead of JSON
 */

import type { Plugin } from "@ronin/plugins/base.js";
import type { AgentAPI } from "@ronin/types/index.js";
import type { ModelConfig, ModelSelectionOptions } from "@ronin/types/model.js";
import {
  initializeUsageTables,
  recordUsageEvent,
  getDailyUsage,
  getMonthlyUsage,
  getDailyUsageRange,
  getDailyStats,
  getMonthlyStats,
  getUsageLog,
  getTotalCost,
} from "../src/database/usage.js";
import { migrateUsageData, isUsageDataMigrated } from "../src/database/migration.js";

const modelSelectorDbPlugin: Plugin = {
  name: "model-selector-db",
  description: "Model selection with database-backed usage tracking",
  methods: {
    // Initialize database tables for usage tracking
    initializeDb: async (api: AgentAPI): Promise<void> => {
      await initializeUsageTables(api);
    },

    // Migrate existing JSON usage data to database
    migrateUsageData: async (api: AgentAPI): Promise<number> => {
      const count = await migrateUsageData(api);
      return count;
    },

    // Check if usage data is in database
    isUsageDataMigrated: async (api: AgentAPI): Promise<boolean> => {
      return isUsageDataMigrated(api);
    },

    // Record usage to database
    recordUsageDb: async (
      api: AgentAPI,
      nametag: string,
      inputTokens: number,
      outputTokens: number,
      latencyMs: number,
      costPerMTok: number,
      costPerOTok: number
    ): Promise<void> => {
      // Calculate cost
      const cost = (inputTokens / 1000000) * costPerMTok + (outputTokens / 1000000) * costPerOTok;

      // Record to database
      await recordUsageEvent(api, nametag, inputTokens, outputTokens, latencyMs, cost);
    },

    // Get daily usage for a model
    getDailyUsage: async (
      api: AgentAPI,
      modelNametag: string,
      date?: string
    ): Promise<any> => {
      return getDailyUsage(api, modelNametag, date);
    },

    // Get monthly usage for a model
    getMonthlyUsage: async (
      api: AgentAPI,
      modelNametag: string,
      year?: number,
      month?: number
    ): Promise<any> => {
      return getMonthlyUsage(api, modelNametag, year, month);
    },

    // Get usage range for a model
    getDailyUsageRange: async (
      api: AgentAPI,
      modelNametag: string,
      startDate: string,
      endDate: string
    ): Promise<any[]> => {
      return getDailyUsageRange(api, modelNametag, startDate, endDate);
    },

    // Get all daily stats for a date
    getDailyStats: async (api: AgentAPI, date?: string): Promise<any[]> => {
      return getDailyStats(api, date);
    },

    // Get all monthly stats for a period
    getMonthlyStats: async (api: AgentAPI, year?: number, month?: number): Promise<any[]> => {
      return getMonthlyStats(api, year, month);
    },

    // Get usage log (detailed)
    getUsageLog: async (
      api: AgentAPI,
      modelNametag?: string,
      limit?: number
    ): Promise<any[]> => {
      return getUsageLog(api, modelNametag, limit);
    },

    // Get total cost for a period
    getTotalCost: async (
      api: AgentAPI,
      startDate: string,
      endDate: string,
      modelNametag?: string
    ): Promise<number> => {
      return getTotalCost(api, startDate, endDate, modelNametag);
    },
  },
};

export default modelSelectorDbPlugin;
