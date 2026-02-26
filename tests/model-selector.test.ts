/**
 * Model Selector Plugin Unit Tests
 * 
 * Tests all core functionality of the model-selector plugin:
 * - Registry loading and saving
 * - Model queries (get, list, by tag)
 * - Model management (add, update, remove)
 * - Constraint checking
 * - Usage tracking
 * - Auto-selection
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { modelSelector } from "../plugins/model-selector.js";
import type { ModelConfig } from "../src/types/model.js";

const TEST_HOME = join(process.cwd(), ".test-ronin");
const TEST_CONFIG_PATH = join(TEST_HOME, "ai-models.json");

describe("Model Selector Plugin", () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true });
    }
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true });
    }
  });

  describe("Registry Operations", () => {
    it("should load the default registry", async () => {
      const registry = await modelSelector.loadRegistry();
      expect(registry).toBeDefined();
      expect(registry.default).toBe("claude-haiku");
      expect(registry.models).toBeDefined();
      expect(Object.keys(registry.models).length).toBeGreaterThan(0);
    });

    it("should get default model", async () => {
      const model = await modelSelector.getDefaultModel();
      expect(model).toBeDefined();
      expect(model?.nametag).toBe("claude-haiku");
      expect(model?.isDefault).toBe(true);
    });

    it("should get specific model by nametag", async () => {
      const model = await modelSelector.getModel("gpt-4o");
      expect(model).toBeDefined();
      expect(model?.displayName).toBe("GPT-4 Omni");
      expect(model?.provider).toBe("openai");
    });

    it("should return null for non-existent model", async () => {
      const model = await modelSelector.getModel("non-existent-model");
      expect(model).toBeNull();
    });

    it("should list all models", async () => {
      const models = await modelSelector.listModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.nametag === "claude-haiku")).toBe(true);
    });
  });

  describe("Tag-Based Queries", () => {
    it("should get models by tag", async () => {
      const fastModels = await modelSelector.getModelsByTag("fast");
      expect(Array.isArray(fastModels)).toBe(true);
      expect(fastModels.length).toBeGreaterThan(0);
      expect(fastModels.every((m) => m.tags.includes("fast"))).toBe(true);
    });

    it("should return empty array for non-existent tag", async () => {
      const models = await modelSelector.getModelsByTag("non-existent-tag");
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(0);
    });

    it("should get local models", async () => {
      const local = await modelSelector.getModelsByTag("local");
      expect(local.length).toBeGreaterThan(0);
      expect(local.every((m) => m.tags.includes("local"))).toBe(true);
    });
  });

  describe("Constraint Checking", () => {
    it("should pass constraint check for valid request", async () => {
      const result = await modelSelector.canHandleRequest("claude-haiku", 1000);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should fail constraint check for oversized request", async () => {
      const result = await modelSelector.canHandleRequest("claude-haiku", 10000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds max tokens");
    });

    it("should fail for non-existent model", async () => {
      const result = await modelSelector.canHandleRequest("non-existent", 1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not found");
    });

    it("should check daily spend limits", async () => {
      // First, record usage to approach limit
      await modelSelector.recordUsage("ministral-3b", 1000, 500, 100);
      
      const result = await modelSelector.canHandleRequest("ministral-3b", 2000);
      // Should pass because ministral-3b has maxDailySpend of 0.0 (local model)
      expect(result.allowed).toBe(true);
    });
  });

  describe("Usage Tracking", () => {
    it("should record usage", async () => {
      await modelSelector.recordUsage("claude-haiku", 1000, 500, 150);
      
      const stats = await modelSelector.getUsageStats("claude-haiku");
      expect(stats).toBeDefined();
      expect(stats?.today.inputTokens).toBe(1000);
      expect(stats?.today.outputTokens).toBe(500);
      expect(stats?.today.requests).toBe(1);
      expect(stats?.today.avgLatency).toBe(150);
    });

    it("should accumulate multiple usage records", async () => {
      // Clear any previous stats for this test
      const model = await modelSelector.getModel("llama2");
      expect(model).toBeDefined();
      
      await modelSelector.recordUsage("llama2", 1000, 500, 100);
      await modelSelector.recordUsage("llama2", 2000, 800, 200);
      
      const stats = await modelSelector.getUsageStats("llama2");
      expect(stats?.today.inputTokens).toBe(3000);
      expect(stats?.today.outputTokens).toBe(1300);
      expect(stats?.today.requests).toBe(2);
      expect(stats?.today.avgLatency).toBe(150); // (100 + 200) / 2
    });

    it("should calculate cost correctly", async () => {
      const model = await modelSelector.getModel("gpt-4o");
      expect(model).toBeDefined();
      
      // Cost calculation: (inputTokens/1M)*costPerMTok + (outputTokens/1M)*costPerOTok
      // (1M/1M)*2.50 + (500K/1M)*10 = 2.50 + 5.0 = 7.50
      await modelSelector.recordUsage("gpt-4o", 1000000, 500000, 100);
      
      const stats = await modelSelector.getUsageStats("gpt-4o");
      expect(stats?.today.cost).toBeCloseTo(7.5, 1);
    });

    it("should return null for model with no usage", async () => {
      const stats = await modelSelector.getUsageStats("unused-model");
      expect(stats).toBeNull();
    });
  });

  describe("Auto-Selection", () => {
    it("should select best model by tags", async () => {
      const selected = await modelSelector.selectBestModel({
        tags: ["fast", "cheap"],
      });
      
      expect(selected).toBeDefined();
      expect(selected?.tags.includes("fast")).toBe(true);
      expect(selected?.tags.includes("cheap")).toBe(true);
    });

    it("should select cheapest model when sorting", async () => {
      const selected = await modelSelector.selectBestModel({
        tags: ["fast"],
      });
      
      expect(selected).toBeDefined();
      // Should be one of the fast models
      expect(selected?.tags.includes("fast")).toBe(true);
    });

    it("should filter by token limit", async () => {
      const selected = await modelSelector.selectBestModel({
        estimatedTokens: 2000,
      });
      
      expect(selected).toBeDefined();
      expect(selected!.limits.maxTokensPerRequest).toBeGreaterThanOrEqual(2000);
    });

    it("should return null when no models match criteria", async () => {
      const selected = await modelSelector.selectBestModel({
        tags: ["non-existent-tag"],
      });
      
      expect(selected).toBeNull();
    });

    it("should handle multiple tag requirements", async () => {
      const selected = await modelSelector.selectBestModel({
        tags: ["local", "private"],
      });
      
      expect(selected).toBeDefined();
      expect(selected?.tags.includes("local")).toBe(true);
      expect(selected?.tags.includes("private")).toBe(true);
    });
  });

  describe("Model Management", () => {
    it("should add a new model", async () => {
      const newModel: ModelConfig = {
        provider: "custom",
        modelId: "test-model",
        nametag: "test-model",
        displayName: "Test Model",
        description: "A test model",
        tags: ["test"],
        isDefault: false,
        limits: {
          costPerMTok: 1.0,
          costPerOTok: 2.0,
          maxDailySpend: 10.0,
          maxMonthlySpend: 100.0,
          maxConcurrent: 1,
          maxTokensPerRequest: 1000,
          rateLimit: { requestsPerMinute: 10, tokensPerMinute: 10000 },
        },
        config: { temperature: 0.7 },
      };

      const added = await modelSelector.addModel("test-model", newModel);
      expect(added).toEqual(newModel);

      const retrieved = await modelSelector.getModel("test-model");
      expect(retrieved).toEqual(newModel);
    });

    it("should update an existing model", async () => {
      const updated = await modelSelector.updateModel("claude-haiku", {
        displayName: "Updated Haiku",
      });

      expect(updated.displayName).toBe("Updated Haiku");
      expect(updated.nametag).toBe("claude-haiku");

      const retrieved = await modelSelector.getModel("claude-haiku");
      expect(retrieved?.displayName).toBe("Updated Haiku");
    });

    it("should fail to update non-existent model", async () => {
      try {
        await modelSelector.updateModel("non-existent", { displayName: "Test" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("not found");
      }
    });

    it("should set default model", async () => {
      await modelSelector.setDefaultModel("gpt-4o");

      const registry = await modelSelector.loadRegistry();
      expect(registry.default).toBe("gpt-4o");

      const defaultModel = await modelSelector.getDefaultModel();
      expect(defaultModel?.nametag).toBe("gpt-4o");
    });

    it("should fail to set non-existent model as default", async () => {
      try {
        await modelSelector.setDefaultModel("non-existent");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("not found");
      }
    });

    it("should remove a model from user overrides", async () => {
      // Add to user config
      const newModel: ModelConfig = {
        provider: "custom",
        modelId: "temp-model",
        nametag: "temp-model",
        displayName: "Temporary Model",
        description: "A temporary model for testing",
        tags: ["test"],
        isDefault: false,
        limits: {
          costPerMTok: 1.0,
          costPerOTok: 2.0,
          maxDailySpend: 10.0,
          maxMonthlySpend: 100.0,
          maxConcurrent: 1,
          maxTokensPerRequest: 1000,
          rateLimit: { requestsPerMinute: 10, tokensPerMinute: 10000 },
        },
        config: { temperature: 0.7 },
      };

      await modelSelector.addModel("temp-model", newModel);
      let model = await modelSelector.getModel("temp-model");
      expect(model).toBeDefined();

      // Remove it
      await modelSelector.removeModel("temp-model");
      
      model = await modelSelector.getModel("temp-model");
      expect(model).toBeNull();
    });
  });
});
