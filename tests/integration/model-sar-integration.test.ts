/**
 * Model Selection + SAR Integration Tests
 * 
 * Tests integration between model-selector and SAR chain:
 * - Model resolution through ChainContext
 * - Middleware integration
 * - Constraint checking in chain execution
 * - Backward compatibility
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { Chain } from "../../src/chain/Chain.js";
import { MiddlewareStack } from "../../src/middleware/MiddlewareStack.js";
import { modelResolution } from "../../src/middleware/modelResolution.js";
import type { ChainContext } from "../../src/chain/types.js";
import { modelSelector } from "../../plugins/model-selector.js";
import {
  clearTestModelRegistryEnv,
  setupTestModelConfig,
  setupTestModelRegistry,
} from "../helpers/modelRegistry.js";

// Mock executor for testing
class MockExecutor {
  async run() {
    // No-op
  }
}

const TEST_HOME = join(process.cwd(), ".test-ronin-integration");

describe("Model Selection + SAR Integration", () => {
  beforeEach(async () => {
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true });
    }
    mkdirSync(TEST_HOME, { recursive: true });
    setupTestModelRegistry(TEST_HOME);
    await setupTestModelConfig(TEST_HOME, "claude-haiku");
    modelSelector.clearCache();
  });

  afterEach(() => {
    modelSelector.clearCache();
    clearTestModelRegistryEnv();
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true });
    }
  });

  describe("Model Resolution Middleware", () => {
    it("should resolve explicit modelNametag", async () => {
      let resolvedModel: string | undefined;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);
      stack.use(async (ctx, next) => {
        resolvedModel = ctx.modelNametag;
        await next();
      });

      const ctx: ChainContext = {
        messages: [],
        modelNametag: "gpt-4o",
      };

      await stack.run(ctx);
      expect(resolvedModel).toBe("gpt-4o");
    });

    it("should auto-select by tags", async () => {
      let resolvedModel: string | undefined;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);
      stack.use(async (ctx, next) => {
        resolvedModel = ctx.modelNametag;
        await next();
      });

      const ctx: ChainContext = {
        messages: [],
        modelTags: ["fast", "cheap"],
      };

      await stack.run(ctx);
      expect(resolvedModel).toBeDefined();
      expect(resolvedModel).toBe("claude-haiku"); // Cheapest fast model
    });

    it("should use default model when nothing specified", async () => {
      let resolvedModel: string | undefined;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);
      stack.use(async (ctx, next) => {
        resolvedModel = ctx.modelNametag;
        await next();
      });

      const ctx: ChainContext = {
        messages: [],
      };

      await stack.run(ctx);
      expect(resolvedModel).toBe("claude-haiku"); // Default model
    });

    it("should fail when explicit model does not exist", async () => {
      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);

      const ctx: ChainContext = {
        messages: [],
        modelNametag: "non-existent-model",
      };

      try {
        await stack.run(ctx);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("not found in registry");
      }
    });

    it("should fail when no models match tag requirements", async () => {
      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);

      const ctx: ChainContext = {
        messages: [],
        modelTags: ["non-existent-tag"],
      };

      try {
        await stack.run(ctx);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("Could not auto-select model");
      }
    });

    it("should enforce constraint checks", async () => {
      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);

      const ctx: ChainContext = {
        messages: [],
        modelNametag: "claude-haiku",
        budget: {
          max: 100000, // Exceeds every model in the test registry, including the synthetic config default
          current: 0,
          reservedForResponse: 1000,
        },
      };

      try {
        await stack.run(ctx);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("cannot handle this request");
      }
    });

    it("should priority: explicit nametag > tags > default", async () => {
      let resolvedModel: string | undefined;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);
      stack.use(async (ctx, next) => {
        resolvedModel = ctx.modelNametag;
        await next();
      });

      const ctx: ChainContext = {
        messages: [],
        modelNametag: "gpt-4o", // Should be used first
        modelTags: ["fast"], // Ignored due to explicit nametag
      };

      await stack.run(ctx);
      expect(resolvedModel).toBe("gpt-4o");
    });

    it("should fallback to tags when nametag not set", async () => {
      let resolvedModel: string | undefined;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);
      stack.use(async (ctx, next) => {
        resolvedModel = ctx.modelNametag;
        await next();
      });

      const ctx: ChainContext = {
        messages: [],
        modelTags: ["cheap"], // Should select claude-haiku
        budget: {
          max: 3000, // Within claude-haiku's limits
          current: 0,
          reservedForResponse: 500,
        },
      };

      await stack.run(ctx);
      expect(resolvedModel).toBeDefined();
      expect(resolvedModel).toBe("claude-haiku");
    });
  });

  describe("Backward Compatibility", () => {
    it("should work without model specification", async () => {
      let didRun = false;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);
      stack.use(async (ctx, next) => {
        didRun = true;
        expect(ctx.modelNametag).toBeDefined();
        await next();
      });

      const ctx: ChainContext = {
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      };

      await stack.run(ctx);
      expect(didRun).toBe(true);
      expect(ctx.modelNametag).toBe("claude-haiku"); // Default
    });

    it("should work with existing tier-based model selection", async () => {
      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);

      const ctx: ChainContext = {
        messages: [],
        model: "smart", // Legacy tier-based selection - modelResolution should ignore
      };

      // Should use default model, not the legacy "smart" tier
      await stack.run(ctx);
      expect(ctx.modelNametag).toBe("claude-haiku");
    });
  });

  describe("Constraint Checking", () => {
    it("should check token constraints within limits", async () => {
      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);

      const ctx: ChainContext = {
        messages: [],
        modelNametag: "claude-haiku", // maxTokensPerRequest: 4096
        budget: {
          max: 3000, // Within limit
          current: 0,
          reservedForResponse: 500,
        },
      };

      await stack.run(ctx);
      expect(ctx.modelNametag).toBe("claude-haiku");
    });

    it("should prevent oversized requests", async () => {
      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);

      const ctx: ChainContext = {
        messages: [],
        modelNametag: "ministral-3b", // maxTokensPerRequest: 2048
        budget: {
          max: 3000, // Exceeds limit
          current: 0,
          reservedForResponse: 500,
        },
      };

      await stack.run(ctx);
      // Falls back to the configured default/fast model, which has a much higher token limit.
      expect(ctx.modelNametag).toBe("opencode:muse-spark-1.3-contributor-free");
    });
  });

  describe("Usage Tracking Setup", () => {
    it("should preserve model context for downstream usage tracking", async () => {
      let capturedNametag: string | undefined;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(modelResolution);
      stack.use(async (ctx, next) => {
        // Simulate downstream middleware capturing the model
        capturedNametag = ctx.modelNametag;
        await next();
      });

      const ctx: ChainContext = {
        messages: [],
        modelTags: ["reliable"],
      };

      await stack.run(ctx);
      expect(capturedNametag).toBeDefined();
      expect(capturedNametag).toBe("claude-haiku");
    });
  });
});
