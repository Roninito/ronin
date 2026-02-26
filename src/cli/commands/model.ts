/**
 * CLI model command — Manage AI models and providers
 * Subcommands: list, show, add, update, remove, default, usage, select
 */

import { modelSelector } from "../../plugins/model-selector.js";
import type { ModelConfig } from "../../types/model.js";

export interface ModelCommandOptions {
  subcommand:
    | "list"
    | "show"
    | "add"
    | "update"
    | "remove"
    | "default"
    | "usage"
    | "select";
  model?: string;
  nametag?: string;
  tags?: string[];
  json?: boolean;
  [key: string]: unknown;
}

/**
 * model list — List all available models
 */
async function listModels(options: ModelCommandOptions): Promise<void> {
  const models = await modelSelector.listModels();

  if (models.length === 0) {
    console.log("No models found");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(models, null, 2));
    return;
  }

  console.log("\n📦 Available Models:\n");
  for (const model of models) {
    const tags = model.tags.join(", ");
    const defaultMark = model.isDefault ? " ⭐" : "";
    console.log(`${model.nametag}${defaultMark}`);
    console.log(`  Display: ${model.displayName}`);
    console.log(`  Provider: ${model.provider}`);
    console.log(`  Tags: ${tags}`);
    console.log(`  Cost: $${model.limits.costPerMTok}/MTok input, $${model.limits.costPerOTok}/MTok output`);
    console.log(`  Daily limit: $${model.limits.maxDailySpend}`);
    console.log("");
  }
}

/**
 * model show — Show detailed model information
 */
async function showModel(nametag: string, options: ModelCommandOptions): Promise<void> {
  const model = await modelSelector.getModel(nametag);
  if (!model) {
    console.error(`❌ Model "${nametag}" not found`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(model, null, 2));
    return;
  }

  console.log(`\n📋 Model: ${nametag}\n`);
  console.log(`Name: ${model.displayName}`);
  console.log(`Provider: ${model.provider}`);
  console.log(`Description: ${model.description}`);
  console.log(`Default: ${model.isDefault ? "Yes ⭐" : "No"}`);
  console.log(`\nTags: ${model.tags.join(", ")}`);
  console.log(`\nPricing:`);
  console.log(`  Input: $${model.limits.costPerMTok} per million tokens`);
  console.log(`  Output: $${model.limits.costPerOTok} per million tokens`);
  console.log(`\nLimits:`);
  console.log(`  Max tokens per request: ${model.limits.maxTokensPerRequest}`);
  console.log(`  Max concurrent: ${model.limits.maxConcurrent}`);
  console.log(`  Daily spend limit: $${model.limits.maxDailySpend}`);
  console.log(`  Monthly spend limit: $${model.limits.maxMonthlySpend}`);
  console.log(`\nRate Limits:`);
  console.log(`  Requests per minute: ${model.limits.rateLimit.requestsPerMinute}`);
  console.log(`  Tokens per minute: ${model.limits.rateLimit.tokensPerMinute}`);
  console.log("");
}

/**
 * model remove — Remove a model
 */
async function removeModel(nametag: string): Promise<void> {
  const model = await modelSelector.getModel(nametag);
  if (!model) {
    console.error(`❌ Model "${nametag}" not found`);
    process.exit(1);
  }

  await modelSelector.removeModel(nametag);
  console.log(`✅ Removed model "${nametag}"`);
}

/**
 * model default — Get or set default model
 */
async function setDefault(nametag?: string): Promise<void> {
  if (!nametag) {
    // Get default
    const defaultModel = await modelSelector.getDefaultModel();
    if (!defaultModel) {
      console.log("No default model set");
      return;
    }
    console.log(`Default model: ${defaultModel.nametag} (${defaultModel.displayName})`);
    return;
  }

  // Set default
  const model = await modelSelector.getModel(nametag);
  if (!model) {
    console.error(`❌ Model "${nametag}" not found`);
    process.exit(1);
  }

  await modelSelector.setDefaultModel(nametag);
  console.log(`✅ Set default model to "${nametag}"`);
}

/**
 * model usage — Show usage statistics
 */
async function showUsage(nametag?: string, json?: boolean): Promise<void> {
  if (!nametag) {
    // Show all usage
    const models = await modelSelector.listModels();
    console.log("\n📊 Usage Statistics\n");
    for (const model of models) {
      const stats = await modelSelector.getUsageStats(model.nametag);
      if (!stats) continue;

      console.log(`${model.nametag}:`);
      console.log(`  Today: ${stats.today.requests} requests, ${stats.today.inputTokens} in / ${stats.today.outputTokens} out, $${stats.today.cost.toFixed(2)}`);
      console.log(`  Month: ${stats.thisMonth.requests} requests, $${stats.thisMonth.cost.toFixed(2)}`);
      console.log("");
    }
    return;
  }

  const stats = await modelSelector.getUsageStats(nametag);
  if (!stats) {
    console.log(`No usage data for model "${nametag}"`);
    return;
  }

  if (json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`\n📊 Usage: ${nametag}\n`);
  console.log("Today:");
  console.log(`  Requests: ${stats.today.requests}`);
  console.log(`  Input tokens: ${stats.today.inputTokens}`);
  console.log(`  Output tokens: ${stats.today.outputTokens}`);
  console.log(`  Cost: $${stats.today.cost.toFixed(2)}`);
  console.log(`  Avg latency: ${stats.today.avgLatency.toFixed(0)}ms`);
  console.log("\nThis Month:");
  console.log(`  Requests: ${stats.thisMonth.requests}`);
  console.log(`  Input tokens: ${stats.thisMonth.inputTokens}`);
  console.log(`  Output tokens: ${stats.thisMonth.outputTokens}`);
  console.log(`  Cost: $${stats.thisMonth.cost.toFixed(2)}`);
  console.log(`  Avg latency: ${stats.thisMonth.avgLatency.toFixed(0)}ms`);
  console.log("");
}

/**
 * model select — Test auto-selection logic
 */
async function selectModel(options: ModelCommandOptions): Promise<void> {
  const selected = await modelSelector.selectBestModel({
    tags: options.tags,
    maxCost: options.maxCost ? Number(options.maxCost) : undefined,
    estimatedTokens: options.tokens ? Number(options.tokens) : undefined,
  });

  if (!selected) {
    console.log("No models match the selection criteria");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(selected, null, 2));
    return;
  }

  console.log(`\n✅ Selected model: ${selected.nametag}`);
  console.log(`   Display: ${selected.displayName}`);
  console.log(`   Tags: ${selected.tags.join(", ")}`);
  console.log(`   Cost: $${selected.limits.costPerMTok}/MTok in, $${selected.limits.costPerOTok}/MTok out`);
  console.log("");
}

/**
 * Main model command handler
 */
export async function handleModelCommand(options: ModelCommandOptions & Record<string, unknown>): Promise<void> {
  try {
    switch (options.subcommand) {
      case "list":
        await listModels(options);
        break;

      case "show":
        if (!options.model && !options.nametag) {
          console.error("Usage: ronin model show <nametag>");
          process.exit(1);
        }
        await showModel((options.model || options.nametag) as string, options);
        break;

      case "remove":
        if (!options.model && !options.nametag) {
          console.error("Usage: ronin model remove <nametag>");
          process.exit(1);
        }
        await removeModel((options.model || options.nametag) as string);
        break;

      case "default":
        await setDefault((options.model || options.nametag) as string | undefined);
        break;

      case "usage":
        await showUsage((options.model || options.nametag) as string | undefined, options.json);
        break;

      case "select":
        await selectModel(options);
        break;

      default:
        console.error(`Unknown subcommand: ${options.subcommand}`);
        console.error(
          "Usage: ronin model <subcommand> [options]\nSubcommands: list, show, remove, default, usage, select"
        );
        process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
