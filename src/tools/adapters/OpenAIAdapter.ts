import { CloudAdapter, type CloudAdapterConfig } from "./CloudAdapter.js";
import type { CloudFeature, CloudResult, ExecutionOptions } from "../types.js";

/**
 * OpenAI Adapter
 * 
 * Cloud adapter for OpenAI API (GPT-4, DALL-E, Whisper, etc.)
 */
export class OpenAIAdapter extends CloudAdapter {
  private apiKey: string;
  private baseUrl: string = "https://api.openai.com/v1";

  constructor(config: CloudAdapterConfig) {
    super("openai", config);
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  supports(feature: CloudFeature): boolean {
    const supportedFeatures: CloudFeature[] = [
      'vision',
      'image-generation',
      'tts',
      'stt',
      'function-calling',
      'streaming',
      'reasoning',
      'code-generation',
    ];
    return supportedFeatures.includes(feature);
  }

  async complete(prompt: string, options?: ExecutionOptions): Promise<CloudResult> {
    const model = options?.model || this.config.defaultModel;
    
    const response = await fetch(`${this.baseUrl}/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        max_tokens: options?.maxTokens || 1000,
        temperature: options?.temperature || 0.7,
        top_p: options?.topP,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0]?.text || "",
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
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
    
    const body: any = {
      model,
      messages,
      max_tokens: options?.maxTokens || 1000,
      temperature: options?.temperature || 0.7,
      top_p: options?.topP,
    };

    if (options?.tools) {
      body.tools = options.tools;
      body.tool_choice = "auto";
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0]?.message?.content || "",
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      cost: this.getUsageCost(data),
      model: data.model,
      raw: data,
    };
  }

  async generateImage(
    prompt: string,
    options?: { size?: string; quality?: string; style?: string }
  ): Promise<{ url: string; cost: number }> {
    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.models['image-generation'] || "dall-e-3",
        prompt,
        size: options?.size || "1024x1024",
        quality: options?.quality || "standard",
        style: options?.style || "vivid",
        n: 1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Image API error: ${error}`);
    }

    const data = await response.json();
    const url = data.data[0]?.url;
    
    // DALL-E 3 pricing
    const cost = options?.quality === "hd" ? 0.08 : 0.04;
    
    return { url, cost };
  }

  async transcribeAudio(
    audioUrl: string,
    options?: { language?: string }
  ): Promise<{ text: string; cost: number }> {
    // Download audio first
    const audioResponse = await fetch(audioUrl);
    const audioBlob = await audioResponse.blob();
    
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.mp3");
    formData.append("model", this.config.models['stt'] || "whisper-1");
    if (options?.language) {
      formData.append("language", options.language);
    }

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Whisper API error: ${error}`);
    }

    const data = await response.json();
    
    // Whisper pricing: $0.006 per minute
    const durationMinutes = 1; // Would need actual duration
    const cost = durationMinutes * 0.006;
    
    return { text: data.text, cost };
  }

  async synthesizeSpeech(
    text: string,
    options?: { voice?: string; speed?: number }
  ): Promise<{ audioUrl: string; cost: number }> {
    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.models['tts'] || "tts-1",
        input: text,
        voice: options?.voice || "alloy",
        speed: options?.speed || 1.0,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS API error: ${error}`);
    }

    // Convert response to blob and create URL
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // TTS pricing: $0.015 per 1K characters
    const cost = (text.length / 1000) * 0.015;
    
    return { audioUrl, cost };
  }

  async analyzeImage(
    imageUrl: string,
    prompt: string,
    options?: ExecutionOptions
  ): Promise<CloudResult> {
    const model = this.config.models['vision'] || "gpt-4-vision-preview";
    
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ];

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options?.maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Vision API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0]?.message?.content || "",
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      cost: this.getUsageCost(data),
      model: data.model,
      raw: data,
    };
  }

  getUsageCost(response: any): number | undefined {
    if (!response.usage) return undefined;
    
    const model = response.model || this.config.defaultModel;
    const { prompt_tokens, completion_tokens } = response.usage;
    
    // Pricing per 1K tokens (approximate, update as needed)
    const pricing: Record<string, { prompt: number; completion: number }> = {
      "gpt-4": { prompt: 0.03, completion: 0.06 },
      "gpt-4-turbo": { prompt: 0.01, completion: 0.03 },
      "gpt-3.5-turbo": { prompt: 0.0005, completion: 0.0015 },
    };
    
    const modelPricing = pricing[model] || pricing["gpt-3.5-turbo"];
    
    const promptCost = (prompt_tokens / 1000) * modelPricing.prompt;
    const completionCost = (completion_tokens / 1000) * modelPricing.completion;
    
    return promptCost + completionCost;
  }

  estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
    const modelName = model || this.config.defaultModel;
    
    const pricing: Record<string, { prompt: number; completion: number }> = {
      "gpt-4": { prompt: 0.03, completion: 0.06 },
      "gpt-4-turbo": { prompt: 0.01, completion: 0.03 },
      "gpt-3.5-turbo": { prompt: 0.0005, completion: 0.0015 },
    };
    
    const modelPricing = pricing[modelName] || pricing["gpt-3.5-turbo"];
    
    const promptCost = (inputTokens / 1000) * modelPricing.prompt;
    const completionCost = (outputTokens / 1000) * modelPricing.completion;
    
    return promptCost + completionCost;
  }
}
