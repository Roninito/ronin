/**
 * ModelRegistry — Central registry for managing AI models across all providers
 */

import type { ModelDefinition, AIProviderType } from "../config/types.js";
import type { AIProvider } from "./BaseProvider.js";
import { AnthropicProvider } from "./providers/AnthropicProvider.js";
import { LMStudioProvider } from "./providers/LMStudioProvider.js";
import { OllamaProvider } from "./providers/OllamaProvider.js";

export interface ModelRegistryConfig {
  models: Record<string, ModelDefinition>;
  providers: Record<AIProviderType, Record<string, unknown>>;
}

export class ModelRegistry {
  private models: Map<string, ModelDefinition>;
  private providers: Map<AIProviderType, AIProvider>;
  private modelProviderMap: Map<string, AIProviderType>;

  constructor(config: ModelRegistryConfig) {
    this.models = new Map(Object.entries(config.models));
    this.providers = new Map();
    this.modelProviderMap = new Map();

    // Initialize providers
    for (const [modelId, model] of this.models) {
      this.modelProviderMap.set(modelId, model.provider);
    }

    // Create provider instances
    for (const [providerType, providerConfig] of Object.entries(config.providers)) {
      this.initializeProvider(providerType as AIProviderType, providerConfig as Record<string, unknown>);
    }
  }

  private initializeProvider(type: AIProviderType, config: Record<string, unknown>): void {
    try {
      switch (type) {
        case "anthropic":
          if (typeof config.apiKey === "string") {
            this.providers.set(
              type,
              new AnthropicProvider({
                apiKey: config.apiKey,
                model: config.model as string | undefined,
                timeout: config.timeout as number | undefined,
              }),
            );
          }
          break;

        case "lmstudio":
          this.providers.set(
            type,
            new LMStudioProvider({
              baseUrl: config.baseUrl as string | undefined,
              cloudUrl: config.cloudUrl as string | undefined,
              model: config.model as string | undefined,
              timeout: config.timeout as number | undefined,
            }),
          );
          break;

        case "ollama":
          this.providers.set(
            type,
            new OllamaProvider({
              baseUrl: config.baseUrl as string | undefined,
              model: config.model as string | undefined,
              temperature: config.temperature as number | undefined,
              timeout: config.timeout as number | undefined,
              apiKey: config.apiKey as string | undefined,
            }),
          );
          break;

        default:
          // Skip unknown providers
          break;
      }
    } catch (error) {
      console.error(`Failed to initialize ${type} provider:`, error);
    }
  }

  /**
   * Get a provider instance by type
   */
  getProvider(type: AIProviderType): AIProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get the provider for a specific model
   */
  getProviderForModel(modelId: string): AIProvider | undefined {
    const providerType = this.modelProviderMap.get(modelId);
    return providerType ? this.providers.get(providerType) : undefined;
  }

  /**
   * Get a model definition
   */
  getModel(modelId: string): ModelDefinition | undefined {
    return this.models.get(modelId);
  }

  /**
   * List all available models
   */
  listModels(provider?: AIProviderType): ModelDefinition[] {
    const result: ModelDefinition[] = [];
    for (const model of this.models.values()) {
      if (!provider || model.provider === provider) {
        result.push(model);
      }
    }
    return result;
  }

  /**
   * Check if a model is available
   */
  async checkModel(modelId: string): Promise<boolean> {
    const provider = this.getProviderForModel(modelId);
    if (!provider) return false;
    return provider.checkModel(modelId);
  }

  /**
   * Register a new model
   */
  registerModel(model: ModelDefinition): void {
    this.models.set(model.id, model);
    this.modelProviderMap.set(model.id, model.provider);
  }

  /**
   * Unregister a model
   */
  unregisterModel(modelId: string): void {
    this.models.delete(modelId);
    this.modelProviderMap.delete(modelId);
  }

  /**
   * Get stats for a provider
   */
  getProviderStats(provider: AIProviderType): { modelCount: number; isInitialized: boolean } {
    const models = this.listModels(provider);
    return {
      modelCount: models.length,
      isInitialized: this.providers.has(provider),
    };
  }

  /**
   * List all initialized providers
   */
  getInitializedProviders(): AIProviderType[] {
    return Array.from(this.providers.keys());
  }
}
