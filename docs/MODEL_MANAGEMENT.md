# Model Management in Ronin

Ronin provides a unified interface for managing AI models across multiple providers, including local (Ollama, LM Studio) and cloud-based (Anthropic) services.

## Overview

### Supported Providers

- **Ollama** — Local models via Ollama server
- **LM Studio** — Local and cloud-based LM Studio deployments
- **Anthropic** — Claude API (cloud-only)

### Architecture

The model management system consists of:

1. **BaseProvider** — Abstract class providing common HTTP patterns and error handling
2. **Provider Implementations** — Specific adapters for each AI service
3. **ModelRegistry** — Central registry for model definitions and provider routing
4. **MetricsCollector** — Usage tracking and performance monitoring

## Configuration

### Setting Up Providers

Providers are configured in your Ronin config file under the `ai.providers` section:

```json
{
  "ai": {
    "providers": {
      "ollama": {
        "enabled": true,
        "baseUrl": "http://localhost:11434",
        "model": "granite3.2-16k",
        "temperature": 0.7,
        "timeout": 60000
      },
      "anthropic": {
        "enabled": false,
        "apiKey": "${ANTHROPIC_API_KEY}",
        "model": "claude-3-5-sonnet-20241022",
        "timeout": 30000
      },
      "lmstudio": {
        "enabled": false,
        "baseUrl": "http://localhost:1234",
        "model": "local-model",
        "timeout": 30000
      }
    }
  }
}
```

### Environment Variables

API keys can be configured via environment variables:

```bash
# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# LM Studio (optional, only for authenticated deployments)
export LMSTUDIO_API_KEY="..."
```

## Using Models

### In Agents

Get the model you want and use the provider directly:

```typescript
import type { AgentAPI } from "@ronin/types/index.js";

export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Get the default model's provider
    const provider = this.api.ai.getProviderForModel("default");
    if (!provider) {
      throw new Error("No provider for default model");
    }

    const response = await provider.complete("Hello, world!");
    console.log(response);
  }
}
```

### In CLI

Use the `ronin model` command for model management:

```bash
# List all models
ronin model list

# List models for a specific provider
ronin model list --provider anthropic

# Show model details
ronin model info --model default

# Test model availability
ronin model test --model default

# Show provider configuration
ronin model config --provider ollama

# Add a new model
ronin model add \
  --id my-model \
  --name "My Custom Model" \
  --provider ollama \
  --capabilities "completion,chat,tools"

# Remove a model
ronin model remove --model my-model
```

## API Reference

### ModelRegistry

```typescript
import { ModelRegistry } from "@ronin/api/ModelRegistry.js";

// Initialize registry
const registry = new ModelRegistry({
  models: { /* model definitions */ },
  providers: { /* provider configs */ },
});

// Get a provider
const provider = registry.getProvider("anthropic");

// Get provider for a model
const provider = registry.getProviderForModel("default");

// List models
const models = registry.listModels("anthropic");

// Check model availability
const available = await registry.checkModel("default");

// Register/unregister models
registry.registerModel(modelDef);
registry.unregisterModel("model-id");

// Get statistics
const stats = registry.getProviderStats("ollama");
```

### AIProvider Interface

All providers implement this interface:

```typescript
interface AIProvider {
  readonly name: string;
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
  chat(messages: Message[], options?: ChatOptions): Promise<Message>;
  stream(prompt: string, options?: CompletionOptions): AsyncIterable<string>;
  streamChat(messages: Message[], options?: ChatOptions): AsyncIterable<string>;
  callTools(prompt: string, tools: Tool[]): Promise<{ message: Message; toolCalls: ToolCall[] }>;
  checkModel(model?: string): Promise<boolean>;
}
```

### MetricsCollector

```typescript
import { MetricsCollector } from "@ronin/api/metrics.js";

const metrics = new MetricsCollector();

// Record successful completion
metrics.recordCompletion(
  "anthropic",           // provider
  "claude-3-5-sonnet",  // model
  1500,                  // tokens used
  234,                   // response time (ms)
  0.05,                  // cost ($)
);

// Record failure
metrics.recordFailure("ollama", "granite3.2-16k");

// Get metrics
const providerMetrics = metrics.getProviderMetrics("anthropic");
const modelMetrics = metrics.getModelMetrics("anthropic", "claude-3-5-sonnet");

// Get success rate
const rate = metrics.getSuccessRate("anthropic");

// Export as JSON
const json = metrics.export();

// Reset metrics
metrics.reset();  // all
metrics.reset("anthropic");  // provider
metrics.reset("anthropic", "claude-3-5-sonnet");  // model
```

## Backward Compatibility

Ronin maintains full backward compatibility with existing Ollama configurations. Legacy settings like `ollamaUrl`, `ollamaModel`, and `ollamaTimeoutMs` are still supported but should be migrated to the new `providers` configuration.

### Migration Guide

**Before (Legacy):**
```json
{
  "ai": {
    "provider": "ollama",
    "ollamaUrl": "http://localhost:11434",
    "ollamaModel": "granite3.2-16k",
    "ollamaTimeoutMs": 60000
  }
}
```

**After (Recommended):**
```json
{
  "ai": {
    "provider": "ollama",
    "providers": {
      "ollama": {
        "enabled": true,
        "baseUrl": "http://localhost:11434",
        "model": "granite3.2-16k",
        "timeout": 60000
      }
    }
  }
}
```

## Examples

### Using Anthropic Claude

1. Get your API key from [Claude API Console](https://console.anthropic.com/api_keys)
2. Set the environment variable: `export ANTHROPIC_API_KEY="sk-ant-..."`
3. Enable Anthropic in config:

```json
{
  "ai": {
    "providers": {
      "anthropic": {
        "enabled": true,
        "model": "claude-3-5-sonnet-20241022"
      }
    }
  }
}
```

4. Use in agents or CLI:

```typescript
const provider = registry.getProvider("anthropic");
const response = await provider.complete("Explain quantum computing");
```

### Using LM Studio (Local)

1. Download and install [LM Studio](https://lmstudio.ai)
2. Start the LM Studio server (usually on `http://localhost:1234`)
3. Enable LM Studio in config:

```json
{
  "ai": {
    "providers": {
      "lmstudio": {
        "enabled": true,
        "baseUrl": "http://localhost:1234",
        "model": "mistral-7b-instruct"
      }
    }
  }
}
```

### Fallback Chain

Set up fallback providers by priority:

```json
{
  "ai": {
    "fallback": {
      "enabled": true,
      "chain": ["anthropic", "lmstudio", "ollama"]
    }
  }
}
```

When the primary provider fails, Ronin will automatically try the next provider in the chain.

## Troubleshooting

### Provider Not Initializing

Check that:
- Provider is enabled in config
- API keys are set correctly (via env vars or config)
- Endpoint URLs are correct
- Service is running (for local providers)

### Model Not Available

```bash
# Test model availability
ronin model test --model model-id

# Check provider configuration
ronin model config --provider ollama

# List available models
ronin model list --provider ollama
```

### Slow Response Times

Check metrics to identify bottlenecks:

```typescript
const metrics = metricsCollector.getProviderMetrics("anthropic");
console.log("Average response time:", metrics.averageResponseTime, "ms");
```

Consider:
- Reducing `maxTokens` in requests
- Using `fast` models for real-time tasks
- Enabling streaming for large responses

## Best Practices

1. **Use Environment Variables** — Store API keys in env vars, not config files
2. **Enable Metrics** — Track performance and costs
3. **Test Models** — Use `ronin model test` to verify setup
4. **Use Appropriate Models** — Choose models based on task complexity
5. **Monitor Costs** — Track spending on cloud providers via metrics

## See Also

- [AIAPI Integration](./AIAPI.md) — Core AI API
- [Configuration Guide](./CONFIG.md) — Configuration options
- [Provider Architecture](./ARCHITECTURE.md) — Technical details
