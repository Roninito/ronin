import { CloudAdapter, type CloudAdapterConfig } from "./CloudAdapter.js";
import type { CloudFeature, CloudResult, ExecutionOptions } from "../types.js";

/**
 * Anthropic Adapter
 * 
 * Cloud adapter for Anthropic API (Claude models)
 */
export class AnthropicAdapter extends CloudAdapter {
  private apiKey: string;
  private baseUrl: string = "https://api.anthropic.com/v1";

  constructor(config: CloudAdapterConfig) {
    super("anthropic", config);
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
      'reasoning',
      'code-generation',
    ];
    return supportedFeatures.includes(feature);
  }

  async complete(prompt: string, options?: ExecutionOptions): Promise<CloudResult> {
    const model = options?.model || this.config.defaultModel;
    
    const response = await fetch(`${this.baseUrl}/complete`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
        max_tokens_to_sample: options?.maxTokens || 1000,
        temperature: options?.temperature || 0.7,
        top_p: options?.topP,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.completion || "",
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      cost: this.getUsageCost(data),
      model: data.model,
      raw: data,
    };
  }

  async chat(
    messages: Array<{ role: string; content: string }>,
    options?: ExecutionOptions
  ): Promise<CloudResult> {
    const model = options?.model || this.config.defaultModel;
    
    // Convert messages to Anthropic format
    const formattedMessages = messages.map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    const body: any = {
      model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || 1000,
      temperature: options?.temperature || 0.7,
      top_p: options?.topP,
    };

    if (options?.tools) {
      body.tools = options.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json();
    
    // Extract content from response
    let content = "";
    if (data.content && Array.isArray(data.content)) {
      content = data.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
    }
    
    return {
      content,
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      cost: this.getUsageCost(data),
      model: data.model,
      raw: data,
    };
  }

  async analyzeImage(
    imageUrl: string,
    prompt: string,
    options?: ExecutionOptions
  ): Promise<CloudResult> {
    const model = this.config.models['vision'] || "claude-3-opus-20240229";
    
    // Download image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
            { type: "text", text: prompt },
          ],
        }],
        max_tokens: options?.maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic Vision API error: ${error}`);
    }

    const data = await response.json();
    
    let content = "";
    if (data.content && Array.isArray(data.content)) {
      content = data.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
    }
    
    return {
      content,
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      cost: this.getUsageCost(data),
      model: data.model,
      raw: data,
    };
  }

  getUsageCost(response: any): number | undefined {
    if (!response.usage) return undefined;
    
    const model = response.model || this.config.defaultModel;
    const { input_tokens, output_tokens } = response.usage;
    
    // Pricing per 1K tokens (approximate, update as needed)
    const pricing: Record<string, { prompt: number; completion: number }> = {
      "claude-3-opus-20240229": { prompt: 0.015, completion: 0.075 },
      "claude-3-sonnet-20240229": { prompt: 0.003, completion: 0.015 },
      "claude-3-haiku-20240307": { prompt: 0.00025, completion: 0.00125 },
      "claude-2.1": { prompt: 0.008, completion: 0.024 },
    };
    
    const modelPricing = pricing[model] || pricing["claude-3-sonnet-20240229"];
    
    const promptCost = (input_tokens / 1000) * modelPricing.prompt;
    const completionCost = (output_tokens / 1000) * modelPricing.completion;
    
    return promptCost + completionCost;
  }

  estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
    const modelName = model || this.config.defaultModel;
    
    const pricing: Record<string, { prompt: number; completion: number }> = {
      "claude-3-opus-20240229": { prompt: 0.015, completion: 0.075 },
      "claude-3-sonnet-20240229": { prompt: 0.003, completion: 0.015 },
      "claude-3-haiku-20240307": { prompt: 0.00025, completion: 0.00125 },
    };
    
    const modelPricing = pricing[modelName] || pricing["claude-3-sonnet-20240229"];
    
    const promptCost = (inputTokens / 1000) * modelPricing.prompt;
    const completionCost = (outputTokens / 1000) * modelPricing.completion;
    
    return promptCost + completionCost;
  }
}
