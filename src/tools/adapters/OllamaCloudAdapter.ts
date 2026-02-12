import { CloudAdapter, type CloudAdapterConfig } from "./CloudAdapter.js";
import type { CloudFeature, CloudResult, ExecutionOptions } from "../types.js";

/**
 * Ollama Cloud Adapter
 * 
 * Cloud adapter for remote Ollama instances
 * This allows using Ollama as a "cloud" provider when running on remote servers
 */
export class OllamaCloudAdapter extends CloudAdapter {
  private baseUrl: string;

  constructor(config: CloudAdapterConfig) {
    super("ollama-cloud", config);
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }

  supports(feature: CloudFeature): boolean {
    // Ollama supports most features depending on the model
    const supportedFeatures: CloudFeature[] = [
      'function-calling',
      'streaming',
      'code-generation',
    ];
    return supportedFeatures.includes(feature);
  }

  async complete(prompt: string, options?: ExecutionOptions): Promise<CloudResult> {
    const model = options?.model || this.config.defaultModel;
    
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
          top_p: options?.topP,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json();
    
    // Estimate tokens (Ollama doesn't provide usage)
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.ceil((data.response || "").length / 4);
    
    return {
      content: data.response || "",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      cost: 0, // Local Ollama is free
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
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens,
        top_p: options?.topP,
      },
    };

    if (options?.tools) {
      body.tools = options.tools;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json();
    
    // Calculate approximate tokens
    const promptText = messages.map(m => m.content).join(" ");
    const promptTokens = Math.ceil(promptText.length / 4);
    const completionTokens = Math.ceil((data.message?.content || "").length / 4);
    
    return {
      content: data.message?.content || "",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      cost: 0, // Local/self-hosted Ollama is free
      model: data.model,
      raw: data,
    };
  }

  async analyzeImage(
    imageUrl: string,
    prompt: string,
    options?: ExecutionOptions
  ): Promise<CloudResult> {
    // Check if the model supports vision
    const model = options?.model || this.config.defaultModel;
    
    // Download image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        images: [base64Image],
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama Vision API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.response || "",
      usage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil((data.response || "").length / 4),
        totalTokens: 0,
      },
      cost: 0,
      model: data.model,
      raw: data,
    };
  }

  getUsageCost(): number | undefined {
    // Ollama is free (local/self-hosted)
    return 0;
  }

  estimateCost(): number {
    // Ollama is free (local/self-hosted)
    return 0;
  }

  /**
   * Check if a model exists on the Ollama server
   */
  async checkModel(model?: string): Promise<boolean> {
    const modelToCheck = model || this.config.defaultModel;
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      
      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const models = data.models || [];
      return models.some((m: { name: string }) => 
        m.name === modelToCheck || m.name.startsWith(`${modelToCheck}:`)
      );
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<Array<{ name: string; size: number; modified: string }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.models || [];
    } catch {
      return [];
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  async pullModel(model: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: model,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to pull model: ${error}`);
    }
  }
}
