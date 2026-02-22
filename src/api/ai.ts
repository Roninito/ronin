/**
 * AIAPI — Thin dispatcher that delegates to the active AIProvider.
 *
 * The public interface is unchanged so agents keep calling api.ai.complete(),
 * api.ai.chat(), etc. Under the hood the configured provider (Ollama, OpenAI,
 * Gemini, Grok) handles the actual request.  When fallback is enabled the
 * dispatcher tries providers in order until one succeeds.
 */

import type {
  CompletionOptions,
  Message,
  ChatOptions,
  Tool,
  ToolCall,
  ToolCallOptions,
} from "../types/api.js";
import type { AIConfig, AIProviderType, GeminiConfig, GrokConfig } from "../config/types.js";
import type { AIProvider } from "./providers.js";
import { createProvider, OllamaProvider } from "./providers.js";
import { withRetry } from "../utils/retry.js";

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL; // No hardcoded fallback - must be configured
const DEFAULT_OLLAMA_TIMEOUT_MS = (() => {
  const raw =
    process.env.OLLAMA_TIMEOUT_MS ||
    process.env.RONIN_AI_TIMEOUT_MS ||
    process.env.RONIN_OLLAMA_TIMEOUT_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 300_000;
})();
const DEFAULT_TEMPERATURE = 0.7;

export class AIAPI {
  private provider: AIProvider;
  private smartProvider?: AIProvider;
  private fallbackProviders: AIProvider[];
  private aiConfig?: AIConfig;

  constructor(
    baseUrl: string = DEFAULT_OLLAMA_URL,
    defaultModel: string = DEFAULT_MODEL,
    defaultTimeoutMs: number = DEFAULT_OLLAMA_TIMEOUT_MS,
    aiConfig?: AIConfig,
    geminiConfig?: GeminiConfig,
    grokConfig?: GrokConfig,
  ) {
    this.aiConfig = aiConfig;

    // Build the primary provider
    if (aiConfig) {
      const effectiveConfig: AIConfig = {
        ...aiConfig,
        ollamaUrl: baseUrl,
        ollamaModel: defaultModel,
        ollamaTimeoutMs: defaultTimeoutMs,
      };
      try {
        this.provider = createProvider(aiConfig.provider, effectiveConfig, geminiConfig, grokConfig);
      } catch {
        // If configured provider can't be created (e.g. missing API key), fall back to Ollama
        console.warn(`[AI] Failed to create ${aiConfig.provider} provider, falling back to Ollama`);
        this.provider = new OllamaProvider(baseUrl, defaultModel, defaultTimeoutMs, aiConfig.temperature ?? DEFAULT_TEMPERATURE);
      }
    } else {
      this.provider = new OllamaProvider(baseUrl, defaultModel, defaultTimeoutMs, DEFAULT_TEMPERATURE);
    }

    // Optional "smart" tier → remote Ollama (e.g. Ollama Cloud) for tool calling
    // If ollamaSmartUrl is set, use it for cloud; otherwise use models.smart with local URL
    const smartUrl = (aiConfig?.ollamaSmartUrl ?? "").trim();
    const smartModel = aiConfig?.models?.smart;
    if (aiConfig?.provider === "ollama" && smartModel) {
      const effectiveSmartUrl = smartUrl || baseUrl; // Use cloud URL if set, otherwise local
      const temp = aiConfig.temperature ?? DEFAULT_TEMPERATURE;
      const smartApiKey =
        (aiConfig.ollamaSmartApiKey ?? "").trim() ||
        (process.env.OLLAMA_API_KEY ?? "").trim();
      this.smartProvider = new OllamaProvider(
        effectiveSmartUrl,
        smartModel,
        defaultTimeoutMs,
        temp,
        smartApiKey || undefined,
      );
    }

    // Build fallback chain
    this.fallbackProviders = [];
    if (aiConfig?.fallback?.enabled && aiConfig.fallback.chain.length > 0) {
      for (const providerType of aiConfig.fallback.chain) {
        if (providerType === aiConfig.provider) continue; // skip primary
        try {
          const effectiveConfig: AIConfig = {
            ...aiConfig,
            ollamaUrl: baseUrl,
            ollamaModel: defaultModel,
            ollamaTimeoutMs: defaultTimeoutMs,
          };
          const fallback = createProvider(providerType, effectiveConfig, geminiConfig, grokConfig);
          this.fallbackProviders.push(fallback);
        } catch (err) {
          console.warn(`[AI] Skipping fallback provider ${providerType}:`, (err as Error).message);
        }
      }
    }
  }

  /**
   * Provider to use for this request.
   * Smart tier → ollamaSmartUrl (cloud); default/fast/other → ollamaUrl (local).
   * We use the requested tier (modelOrTier), not the resolved model name, so that
   * when default and smart point to the same model name we still use local for default.
   */
  private getProviderForModel(
    modelOrTier: string | undefined,
    _resolvedModel?: string | undefined,
  ): AIProvider {
    if (modelOrTier === "smart" && this.smartProvider) {
      return this.smartProvider;
    }
    return this.provider;
  }

  /**
   * Resolve a model name, supporting named tiers (fast, smart, default, embedding)
   */
  private resolveModel(modelOrTier?: string): string | undefined {
    if (!modelOrTier) return undefined;
    if (!this.aiConfig?.models) return modelOrTier;
    const tier = modelOrTier as keyof NonNullable<AIConfig["models"]>;
    const mapped = this.aiConfig.models[tier];
    return mapped || modelOrTier;
  }

  /**
   * Execute an operation with retry + fallback support.
   * Uses primaryProvider when given (e.g. smart tier → Ollama Cloud), else this.provider.
   * Each provider attempt is wrapped in withRetry; then the fallback chain is tried if the primary fails.
   */
  private async withFallback<T>(
    operation: (provider: AIProvider) => Promise<T>,
    opts?: { retries?: number; primaryProvider?: AIProvider },
  ): Promise<T> {
    const maxRetries = opts?.retries ?? 3;
    const primary = opts?.primaryProvider ?? this.provider;

    const tryProvider = (provider: AIProvider) =>
      withRetry(() => operation(provider), {
        maxRetries,
        label: `ai.${provider.name}`,
      });

    try {
      return await tryProvider(primary);
    } catch (primaryError) {
      if (this.fallbackProviders.length === 0) throw primaryError;
      if (primary === this.smartProvider) {
        throw primaryError;
      }

      console.warn(`[AI] Primary provider (${primary.name}) failed: ${(primaryError as Error).message}`);

      for (const fallback of this.fallbackProviders) {
        try {
          console.log(`[AI] Trying fallback provider: ${fallback.name}`);
          return await tryProvider(fallback);
        } catch (fallbackError) {
          console.warn(`[AI] Fallback provider (${fallback.name}) failed: ${(fallbackError as Error).message}`);
        }
      }

      throw primaryError;
    }
  }

  // ─── Public API (unchanged interface) ────────────────────────────────

  async checkModel(model?: string): Promise<boolean> {
    const resolved = this.resolveModel(model);
    const provider = this.getProviderForModel(model, resolved);
    return provider.checkModel(resolved ?? model);
  }

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const resolved = { ...options, model: this.resolveModel(options.model) };
    const primary = this.getProviderForModel(options.model, resolved.model);
    return this.withFallback(p => p.complete(prompt, resolved), {
      retries: options.retries,
      primaryProvider: primary,
    });
  }

  async *stream(prompt: string, options: CompletionOptions = {}): AsyncIterable<string> {
    const resolved = { ...options, model: this.resolveModel(options.model) };
    const provider = this.getProviderForModel(options.model, resolved.model);
    yield* provider.stream(prompt, resolved);
  }

  async chat(messages: Message[], options: Omit<ChatOptions, "messages"> = {}): Promise<Message> {
    const resolved = { ...options, model: this.resolveModel(options.model) };
    const primary =
      (options as any).useLocalProvider === true
        ? this.provider
        : this.getProviderForModel(options.model, resolved.model);
    return this.withFallback(p => p.chat(messages, resolved), {
      retries: options.retries,
      primaryProvider: primary,
    });
  }

  async *streamChat(
    messages: Message[],
    options: Omit<ChatOptions, "messages"> = {},
  ): AsyncIterable<string> {
    const resolved = { ...options, model: this.resolveModel(options.model) };
    const provider = this.getProviderForModel(options.model, resolved.model);
    yield* provider.streamChat(messages, resolved);
  }

  async callTools(
    prompt: string,
    tools: Tool[],
    options: CompletionOptions = {},
  ): Promise<{ message: Message; toolCalls: ToolCall[] }> {
    const resolved = { ...options, model: this.resolveModel(options.model) };
    const primary =
      options.useLocalProvider === true
        ? this.provider
        : this.getProviderForModel(options.model, resolved.model);
    return this.withFallback(p => p.callTools(prompt, tools, resolved), {
      retries: options.retries,
      primaryProvider: primary,
    });
  }
}
