import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ModelRegistry } from "../../src/types/model.js";

export function createTestModelRegistry(): ModelRegistry {
  return {
    default: "claude-haiku",
    providers: {
      anthropic: {
        type: "remote",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        description: "Anthropic Claude models",
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
        },
      },
      openai: {
        type: "remote",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        description: "OpenAI GPT models",
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
        },
      },
      lmstudio: {
        type: "local",
        baseUrl: "http://localhost:1234/v1",
        description: "LM Studio local inference",
        defaults: {
          temperature: 0.7,
          maxTokens: 2048,
        },
      },
    },
    models: {
      "claude-haiku": {
        provider: "anthropic",
        modelId: "claude-3-5-haiku-latest",
        nametag: "claude-haiku",
        displayName: "Claude Haiku",
        description: "Fast, affordable default model",
        tags: ["fast", "cheap", "reliable"],
        isDefault: true,
        limits: {
          costPerMTok: 0.25,
          costPerOTok: 1.25,
          maxDailySpend: 20,
          maxMonthlySpend: 200,
          maxConcurrent: 5,
          maxTokensPerRequest: 4096,
          rateLimit: {
            requestsPerMinute: 60,
            tokensPerMinute: 120000,
          },
        },
        config: {
          temperature: 0.7,
        },
      },
      "gpt-4o": {
        provider: "openai",
        modelId: "gpt-4o",
        nametag: "gpt-4o",
        displayName: "GPT-4 Omni",
        description: "Powerful multimodal model",
        tags: ["powerful", "expensive", "multimodal"],
        isDefault: false,
        limits: {
          costPerMTok: 2.5,
          costPerOTok: 10,
          maxDailySpend: 50,
          maxMonthlySpend: 500,
          maxConcurrent: 3,
          maxTokensPerRequest: 8192,
          rateLimit: {
            requestsPerMinute: 30,
            tokensPerMinute: 200000,
          },
        },
        config: {
          temperature: 0.7,
        },
      },
      "ministral-3b": {
        provider: "lmstudio",
        modelId: "ministral-3b",
        nametag: "ministral-3b",
        displayName: "Ministral 3B",
        description: "Small private local model",
        tags: ["local", "private"],
        isDefault: false,
        limits: {
          costPerMTok: 0,
          costPerOTok: 0,
          maxDailySpend: 0,
          maxMonthlySpend: 0,
          maxConcurrent: 10,
          maxTokensPerRequest: 2048,
          rateLimit: {
            requestsPerMinute: 100,
            tokensPerMinute: 500000,
          },
        },
        config: {
          temperature: 0.7,
        },
      },
      llama2: {
        provider: "lmstudio",
        modelId: "llama2",
        nametag: "llama2",
        displayName: "Llama 2",
        description: "General local model",
        tags: ["local", "private"],
        isDefault: false,
        limits: {
          costPerMTok: 0,
          costPerOTok: 0,
          maxDailySpend: 0,
          maxMonthlySpend: 0,
          maxConcurrent: 10,
          maxTokensPerRequest: 4096,
          rateLimit: {
            requestsPerMinute: 80,
            tokensPerMinute: 250000,
          },
        },
        config: {
          temperature: 0.7,
        },
      },
    },
    usage: {},
  };
}

export function setupTestModelRegistry(testRoot: string): string {
  const roninDir = join(testRoot, ".ronin");
  const registryPath = join(roninDir, "ai-models.json");
  mkdirSync(roninDir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify(createTestModelRegistry(), null, 2));
  process.env.RONIN_AI_MODELS_PATH = registryPath;
  return registryPath;
}

export function clearTestModelRegistryEnv(): void {
  delete process.env.RONIN_AI_MODELS_PATH;
}
