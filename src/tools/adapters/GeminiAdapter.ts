import { CloudAdapter, type CloudAdapterConfig } from "./CloudAdapter.js";
import type { CloudFeature, CloudResult, ExecutionOptions } from "../types.js";

/**
 * Gemini Adapter
 * 
 * Cloud adapter for Google Gemini API
 */
export class GeminiAdapter extends CloudAdapter {
  private apiKey: string;
  private baseUrl: string = "https://generativelanguage.googleapis.com/v1beta";

  constructor(config: CloudAdapterConfig) {
    super("gemini", config);
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  supports(feature: CloudFeature): boolean {
    const supportedFeatures: CloudFeature[] = [
      'vision',
      'function-calling',
      'streaming',
      'code-generation',
    ];
    return supportedFeatures.includes(feature);
  }

  async complete(prompt: string, options?: ExecutionOptions): Promise<CloudResult> {
    const model = options?.model || this.config.defaultModel;
    
    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }],
          }],
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.maxTokens,
            topP: options?.topP,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0),
      } : undefined,
      cost: this.getUsageCost(data),
      model: model,
      raw: data,
    };
  }

  async chat(
    messages: Array<{ role: string; content: string }>,
    options?: ExecutionOptions
  ): Promise<CloudResult> {
    const model = options?.model || this.config.defaultModel;
    
    // Convert messages to Gemini format
    const contents = messages.map(m => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const body: any = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        topP: options?.topP,
      },
    };

    if (options?.tools) {
      body.tools = options.tools.map(t => ({
        functionDeclarations: [{
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        }],
      }));
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0),
      } : undefined,
      cost: this.getUsageCost(data),
      model: model,
      raw: data,
    };
  }

  async analyzeImage(
    imageUrl: string,
    prompt: string,
    options?: ExecutionOptions
  ): Promise<CloudResult> {
    const model = this.config.models['vision'] || "gemini-pro-vision";
    
    // Download image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    
    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Image,
                },
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: options?.maxTokens || 1000,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini Vision API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0),
      } : undefined,
      cost: this.getUsageCost(data),
      model: model,
      raw: data,
    };
  }

  getUsageCost(response: any): number | undefined {
    if (!response.usageMetadata) return undefined;
    
    const model = this.config.defaultModel;
    const { promptTokenCount, candidatesTokenCount } = response.usageMetadata;
    
    // Pricing per 1K tokens (Gemini has different pricing tiers)
    const pricing: Record<string, { prompt: number; completion: number }> = {
      "gemini-1.5-pro": { prompt: 0.0035, completion: 0.0105 },
      "gemini-1.5-flash": { prompt: 0.00035, completion: 0.00105 },
      "gemini-pro": { prompt: 0.0005, completion: 0.0015 },
      "gemini-pro-vision": { prompt: 0.0005, completion: 0.0015 },
    };
    
    const modelPricing = pricing[model] || pricing["gemini-pro"];
    
    const promptCost = (promptTokenCount / 1000) * modelPricing.prompt;
    const completionCost = (candidatesTokenCount / 1000) * modelPricing.completion;
    
    return promptCost + completionCost;
  }

  estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
    const modelName = model || this.config.defaultModel;
    
    const pricing: Record<string, { prompt: number; completion: number }> = {
      "gemini-1.5-pro": { prompt: 0.0035, completion: 0.0105 },
      "gemini-1.5-flash": { prompt: 0.00035, completion: 0.00105 },
      "gemini-pro": { prompt: 0.0005, completion: 0.0015 },
    };
    
    const modelPricing = pricing[modelName] || pricing["gemini-pro"];
    
    const promptCost = (inputTokens / 1000) * modelPricing.prompt;
    const completionCost = (outputTokens / 1000) * modelPricing.completion;
    
    return promptCost + completionCost;
  }
}
