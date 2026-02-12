/**
 * Cloud Adapter Base Class
 * 
 * Abstract base for cloud model providers (OpenAI, Anthropic, etc.)
 */

import type { 
  CloudFeature, 
  CloudResult, 
  ExecutionOptions,
  OpenAIFunctionSchema 
} from "./types.js";

export interface CloudAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  defaultModel: string;
  models: Record<string, string>;
}

export abstract class CloudAdapter {
  protected config: CloudAdapterConfig;
  protected name: string;

  constructor(name: string, config: CloudAdapterConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * Get adapter name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get available models
   */
  getModels(): string[] {
    return Object.values(this.config.models);
  }

  /**
   * Get default model
   */
  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  /**
   * Get model for specific capability
   */
  getModelForCapability(capability: string): string | undefined {
    return this.config.models[capability];
  }

  /**
   * Check if adapter supports a feature
   */
  abstract supports(feature: CloudFeature): boolean;

  /**
   * Execute completion request
   */
  abstract complete(
    prompt: string,
    options?: ExecutionOptions
  ): Promise<CloudResult>;

  /**
   * Execute chat completion
   */
  abstract chat(
    messages: Array<{ role: string; content: string }>,
    options?: ExecutionOptions
  ): Promise<CloudResult>;

  /**
   * Extract cost from API response
   */
  abstract getUsageCost(response: any): number | undefined;

  /**
   * Generate image
   */
  abstract generateImage?(
    prompt: string,
    options?: { size?: string; quality?: string; style?: string }
  ): Promise<{ url: string; cost: number }>;

  /**
   * Transcribe audio
   */
  abstract transcribeAudio?(
    audioUrl: string,
    options?: { language?: string }
  ): Promise<{ text: string; cost: number }>;

  /**
   * Synthesize speech
   */
  abstract synthesizeSpeech?(
    text: string,
    options?: { voice?: string; speed?: number }
  ): Promise<{ audioUrl: string; cost: number }>;

  /**
   * Analyze image with vision
   */
  abstract analyzeImage?(
    imageUrl: string,
    prompt: string,
    options?: ExecutionOptions
  ): Promise<CloudResult>;

  /**
   * Estimate cost for request
   */
  estimateCost(
    inputTokens: number,
    outputTokens: number,
    model?: string
  ): number {
    // Base implementation - override in subclasses
    return 0;
  }

  /**
   * Count tokens in text
   */
  countTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}
