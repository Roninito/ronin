/**
 * CLI model command — Manage AI models and providers
 * Subcommands: list, add, remove, test, info, config
 */

import { loadConfig } from "./config.js";
import { ModelRegistry } from "../../api/ModelRegistry.js";
import type { AIProviderType, ModelDefinition } from "../../config/types.js";

export interface ModelCommandOptions {
  subcommand: "list" | "add" | "remove" | "test" | "info" | "config";
  provider?: AIProviderType;
  model?: string;
  name?: string;
  id?: string;
  configPath?: string;
}

/**
 * model list — List all available models
 */
async function listModels(registry: ModelRegistry, provider?: AIProviderType): Promise<void> {
  const models = registry.listModels(provider);

  if (models.length === 0) {
    console.log("No models found");
    return;
  }

  console.log(`\n📦 Available Models${provider ? ` (${provider})` : ""}:\n`);
  for (const model of models) {
    const capabilities = model.capabilities.join(", ");
    const cost = model.costPer1kTokens ? ` | $${model.costPer1kTokens.input}/$${model.costPer1kTokens.output}` : "";
    console.log(`  ${model.id}`);
    console.log(`    Name: ${model.name}`);
    console.log(`    Provider: ${model.provider}`);
    console.log(`    Capabilities: ${capabilities}`);
    if (model.maxTokens) console.log(`    Max Tokens: ${model.maxTokens}`);
    if (cost) console.log(`    Cost per 1k tokens: ${cost}`);
    console.log("");
  }
}

/**
 * model add — Register a new model
 */
async function addModel(
  registry: ModelRegistry,
  modelId: string,
  name: string,
  provider: AIProviderType,
  capabilities: string[],
): Promise<void> {
  const model: ModelDefinition = {
    id: modelId,
    name,
    provider,
    capabilities,
  };

  registry.registerModel(model);
  console.log(`✅ Model "${modelId}" registered`);
}

/**
 * model remove — Unregister a model
 */
async function removeModel(registry: ModelRegistry, modelId: string): Promise<void> {
  const model = registry.getModel(modelId);
  if (!model) {
    console.error(`❌ Model "${modelId}" not found`);
    return;
  }

  registry.unregisterModel(modelId);
  console.log(`✅ Model "${modelId}" removed`);
}

/**
 * model test — Test connection to a model
 */
async function testModel(registry: ModelRegistry, modelId: string): Promise<void> {
  const model = registry.getModel(modelId);
  if (!model) {
    console.error(`❌ Model "${modelId}" not found`);
    return;
  }

  const provider = registry.getProviderForModel(modelId);
  if (!provider) {
    console.error(`❌ Provider "${model.provider}" not initialized`);
    return;
  }

  try {
    console.log(`Testing ${modelId}...`);
    const available = await provider.checkModel(modelId);
    if (available) {
      console.log(`✅ Model "${modelId}" is available`);
    } else {
      console.error(`❌ Model "${modelId}" is not available`);
    }
  } catch (error) {
    console.error(`❌ Error testing model: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * model info — Show detailed info about a model
 */
async function infoModel(registry: ModelRegistry, modelId: string): Promise<void> {
  const model = registry.getModel(modelId);
  if (!model) {
    console.error(`❌ Model "${modelId}" not found`);
    return;
  }

  console.log(`\n📋 Model Details: ${modelId}\n`);
  console.log(`  Name: ${model.name}`);
  console.log(`  Provider: ${model.provider}`);
  console.log(`  Capabilities: ${model.capabilities.join(", ")}`);
  if (model.maxTokens) console.log(`  Max Tokens: ${model.maxTokens}`);
  if (model.tags) console.log(`  Tags: ${model.tags.join(", ")}`);
  if (model.costPer1kTokens) {
    console.log(`  Cost per 1k tokens:`);
    console.log(`    Input: $${model.costPer1kTokens.input}`);
    console.log(`    Output: $${model.costPer1kTokens.output}`);
  }
  console.log("");
}

/**
 * model config — Show provider configuration
 */
async function configModel(registry: ModelRegistry, provider: AIProviderType): Promise<void> {
  const stats = registry.getProviderStats(provider);
  const models = registry.listModels(provider);

  console.log(`\n⚙️  Provider: ${provider}\n`);
  console.log(`  Initialized: ${stats.isInitialized ? "✅" : "❌"}`);
  console.log(`  Models: ${stats.modelCount}`);
  if (models.length > 0) {
    console.log(`  Available Models: ${models.map((m) => m.id).join(", ")}`);
  }
  console.log("");
}

/**
 * Main model command handler
 */
export async function handleModelCommand(options: ModelCommandOptions & Record<string, unknown>): Promise<void> {
  const config = await loadConfig();

  // Initialize registry with current config
  const registryConfig = {
    models: {},
    providers: config.ai?.providers || {},
  };

  const registry = new ModelRegistry(registryConfig);

  switch (options.subcommand) {
    case "list":
      await listModels(registry, options.provider);
      break;

    case "add":
      if (!options.id || !options.name || !options.provider) {
        console.error("Usage: ronin model add --id <id> --name <name> --provider <provider>");
        return;
      }
      await addModel(
        registry,
        String(options.id),
        String(options.name),
        options.provider,
        (options.capabilities as string[]) || [],
      );
      break;

    case "remove":
      if (!options.model) {
        console.error("Usage: ronin model remove --model <modelId>");
        return;
      }
      await removeModel(registry, String(options.model));
      break;

    case "test":
      if (!options.model) {
        console.error("Usage: ronin model test --model <modelId>");
        return;
      }
      await testModel(registry, String(options.model));
      break;

    case "info":
      if (!options.model) {
        console.error("Usage: ronin model info --model <modelId>");
        return;
      }
      await infoModel(registry, String(options.model));
      break;

    case "config":
      if (!options.provider) {
        console.error("Usage: ronin model config --provider <provider>");
        return;
      }
      await configModel(registry, options.provider);
      break;

    default:
      console.error(`Unknown subcommand: ${options.subcommand}`);
  }
}
