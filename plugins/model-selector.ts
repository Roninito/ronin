/**
 * Model Selector Plugin
 * 
 * Handles all model selection logic, registration, constraint checking,
 * and usage tracking.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type {
  ModelConfig,
  ModelRegistry,
  ConstraintCheckResult,
  ModelSelectionOptions,
  DailyUsageStats,
} from "../types/model.js";

/**
 * Load registry from file, with fallback to defaults
 */
function loadRegistryFromFile(path: string): ModelRegistry | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Merge two registries (defaults + overrides)
 */
function mergeRegistries(defaults: ModelRegistry, overrides: ModelRegistry | null): ModelRegistry {
  if (!overrides) return defaults;

  return {
    default: overrides.default || defaults.default,
    providers: { ...defaults.providers, ...overrides.providers },
    models: { ...defaults.models, ...overrides.models },
    usage: { ...defaults.usage, ...overrides.usage },
  };
}

class ModelSelectorPlugin {
  private registryCache: ModelRegistry | null = null;
  private cacheTime: number = 0;
  private cacheTTL: number = 60000; // 1 minute

  /**
   * Load the model registry (repo defaults merged with user overrides)
   */
  async loadRegistry(): Promise<ModelRegistry> {
    const now = Date.now();
    if (this.registryCache && now - this.cacheTime < this.cacheTTL) {
      return this.registryCache;
    }

    // Load repo defaults
    const repoPath = join(process.cwd(), ".ronin", "ai-models.json");
    const repoDefaults = loadRegistryFromFile(repoPath);

    if (!repoDefaults) {
      throw new Error(`Failed to load model registry from ${repoPath}`);
    }

    // Load user overrides
    const userPath = join(homedir(), ".ronin", "ai-models.json");
    const userOverrides = loadRegistryFromFile(userPath);

    const merged = mergeRegistries(repoDefaults, userOverrides);
    this.registryCache = merged;
    this.cacheTime = now;
    return merged;
  }

  /**
   * Save the model registry (to user config only)
   */
  async saveRegistry(registry: ModelRegistry): Promise<void> {
    const userDir = join(homedir(), ".ronin");
    if (!existsSync(userDir)) {
      mkdirSync(userDir, { recursive: true });
    }

    const userPath = join(userDir, "ai-models.json");
    writeFileSync(userPath, JSON.stringify(registry, null, 2));

    // Invalidate cache
    this.registryCache = null;
  }

  /**
   * Get the default model
   */
  async getDefaultModel(): Promise<ModelConfig | null> {
    const registry = await this.loadRegistry();
    if (!registry.default || !registry.models[registry.default]) {
      return null;
    }
    return registry.models[registry.default];
  }

  /**
   * Get a model by nametag
   */
  async getModel(nametag: string): Promise<ModelConfig | null> {
    const registry = await this.loadRegistry();
    const model = registry.models[nametag];
    if (!model) return null;
    return { ...model, isDefault: registry.default === nametag };
  }

  /**
   * List all available models
   */
  async listModels(): Promise<ModelConfig[]> {
    const registry = await this.loadRegistry();
    return Object.entries(registry.models).map(([nametag, model]) => ({
      ...model,
      isDefault: registry.default === nametag,
    }));
  }

  /**
   * List models by tag (all tags must match)
   */
  async getModelsByTag(tag: string): Promise<ModelConfig[]> {
    const models = await this.listModels();
    return models.filter((m) => m.tags.includes(tag));
  }

  /**
   * Add a new model to the registry
   */
  async addModel(nametag: string, config: ModelConfig): Promise<ModelConfig> {
    const registry = await this.loadRegistry();
    registry.models[nametag] = config;
    await this.saveRegistry(registry);
    // Clear cache to ensure fresh load on next access
    this.registryCache = null;
    return config;
  }

  /**
   * Update an existing model
   */
  async updateModel(
    nametag: string,
    updates: Partial<ModelConfig>
  ): Promise<ModelConfig> {
    const registry = await this.loadRegistry();
    if (!registry.models[nametag]) {
      throw new Error(`Model ${nametag} not found`);
    }
    registry.models[nametag] = { ...registry.models[nametag], ...updates };
    await this.saveRegistry(registry);
    // Clear cache to ensure fresh load on next access
    this.registryCache = null;
    return registry.models[nametag];
  }

  /**
   * Remove a model from the registry
   */
  async removeModel(nametag: string): Promise<void> {
    const registry = await this.loadRegistry();
    delete registry.models[nametag];
    await this.saveRegistry(registry);
    // Clear cache to ensure fresh load on next access
    this.registryCache = null;
  }

  /**
   * Set the default model
   */
  async setDefaultModel(nametag: string): Promise<void> {
    const registry = await this.loadRegistry();
    if (!registry.models[nametag]) {
      throw new Error(`Model ${nametag} not found`);
    }
    registry.default = nametag;
    for (const [key, model] of Object.entries(registry.models)) {
      model.isDefault = key === nametag;
    }
    await this.saveRegistry(registry);
    // Clear cache to ensure fresh load on next access
    this.registryCache = null;
  }

  /**
   * Check if a model can handle a request (constraints)
   */
  async canHandleRequest(
    nametag: string,
    estimatedTokens: number
  ): Promise<ConstraintCheckResult> {
    const model = await this.getModel(nametag);
    if (!model) {
      return { allowed: false, reason: "Model not found" };
    }

    // Check token limit
    if (estimatedTokens > model.limits.maxTokensPerRequest) {
      return {
        allowed: false,
        reason: `Request exceeds max tokens (${estimatedTokens} > ${model.limits.maxTokensPerRequest})`,
      };
    }

    // Check daily spend limit
    const registry = await this.loadRegistry();
    const usage = registry.usage[nametag]?.today;
    if (usage && model.limits.maxDailySpend > 0) {
      const estimatedCost =
        (estimatedTokens / 1000000) * (model.limits.costPerMTok + model.limits.costPerOTok) / 2;
      const projectedSpend = (usage.cost || 0) + estimatedCost;

      if (projectedSpend > model.limits.maxDailySpend) {
        return {
          allowed: false,
          reason: `Would exceed daily spend limit ($${projectedSpend.toFixed(2)} > $${model.limits.maxDailySpend})`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record usage after a completion
   */
  async recordUsage(
    nametag: string,
    inputTokens: number,
    outputTokens: number,
    latency: number
  ): Promise<void> {
    const registry = await this.loadRegistry();
    const model = registry.models[nametag];
    if (!model) return;

    const cost =
      (inputTokens / 1000000) * model.limits.costPerMTok +
      (outputTokens / 1000000) * model.limits.costPerOTok;

    if (!registry.usage[nametag]) {
      registry.usage[nametag] = {
        today: {
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          requests: 0,
          avgLatency: 0,
        },
        thisMonth: {
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          requests: 0,
          avgLatency: 0,
        },
      };
    }

    // Update today
    const today = registry.usage[nametag].today;
    today.inputTokens += inputTokens;
    today.outputTokens += outputTokens;
    today.cost += cost;
    today.requests += 1;
    today.avgLatency = (today.avgLatency * (today.requests - 1) + latency) / today.requests;

    // Update this month
    const thisMonth = registry.usage[nametag].thisMonth;
    thisMonth.inputTokens += inputTokens;
    thisMonth.outputTokens += outputTokens;
    thisMonth.cost += cost;
    thisMonth.requests += 1;
    thisMonth.avgLatency =
      (thisMonth.avgLatency * (thisMonth.requests - 1) + latency) / thisMonth.requests;

    await this.saveRegistry(registry);
    // Clear cache to ensure fresh load on next access
    this.registryCache = null;
  }

  /**
   * Get usage statistics for a model
   */
  async getUsageStats(
    nametag: string
  ): Promise<{ today: DailyUsageStats; thisMonth: DailyUsageStats } | null> {
    const registry = await this.loadRegistry();
    return registry.usage[nametag] || null;
  }

  /**
   * Auto-select best model based on criteria
   */
  async selectBestModel(options: ModelSelectionOptions): Promise<ModelConfig | null> {
    const models = await this.listModels();
    let candidates = models;

    // Filter by tags (all tags must match)
    if (options.tags && options.tags.length > 0) {
      candidates = candidates.filter((m) =>
        options.tags!.every((tag) => m.tags.includes(tag))
      );
    }

    // Filter by token limit
    if (options.estimatedTokens) {
      candidates = candidates.filter(
        (m) => options.estimatedTokens! <= m.limits.maxTokensPerRequest
      );
    }

    // Filter by cost
    if (options.maxCost) {
      candidates = candidates.filter((m) => m.limits.costPerMTok <= options.maxCost!);
    }

    // Sort by cost (cheapest first), then by latency (fastest first)
    candidates.sort((a, b) => {
      const costDiff = a.limits.costPerMTok - b.limits.costPerMTok;
      if (costDiff !== 0) return costDiff;
      return a.limits.rateLimit.requestsPerMinute - b.limits.rateLimit.requestsPerMinute;
    });

    return candidates[0] || null;
  }
}

export const modelSelector = new ModelSelectorPlugin();

/**
 * Plugin export for registration
 */
const modelSelectorPlugin = {
  name: "model-selector",
  description:
    "Manage AI model selection, routing, constraint checking, and usage tracking",
  methods: {
    loadRegistry: () => modelSelector.loadRegistry(),
    saveRegistry: (registry: ModelRegistry) => modelSelector.saveRegistry(registry),
    getDefaultModel: () => modelSelector.getDefaultModel(),
    getModel: (nametag: string) => modelSelector.getModel(nametag),
    listModels: () => modelSelector.listModels(),
    getModelsByTag: (tag: string) => modelSelector.getModelsByTag(tag),
    addModel: (nametag: string, config: ModelConfig) =>
      modelSelector.addModel(nametag, config),
    updateModel: (nametag: string, updates: Partial<ModelConfig>) =>
      modelSelector.updateModel(nametag, updates),
    removeModel: (nametag: string) => modelSelector.removeModel(nametag),
    setDefaultModel: (nametag: string) => modelSelector.setDefaultModel(nametag),
    canHandleRequest: (nametag: string, estimatedTokens: number) =>
      modelSelector.canHandleRequest(nametag, estimatedTokens),
    recordUsage: (nametag: string, inputTokens: number, outputTokens: number, latency: number) =>
      modelSelector.recordUsage(nametag, inputTokens, outputTokens, latency),
    getUsageStats: (nametag: string) => modelSelector.getUsageStats(nametag),
    selectBestModel: (options: ModelSelectionOptions) =>
      modelSelector.selectBestModel(options),
  },
};

export default modelSelectorPlugin;
