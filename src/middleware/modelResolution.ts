/**
 * Model Resolution Middleware
 * 
 * Resolves model selection for the chain:
 * 1. Explicit modelNametag → use specified model
 * 2. modelTags → auto-select best model by tags
 * 3. Default model → use registry default
 * 4. Check constraints → fail if violated
 */

import type { ChainContext } from "../chain/types.js";
import type { Middleware } from "./MiddlewareStack.js";
import { modelSelector } from "../../plugins/model-selector.js";

/**
 * Model resolution middleware
 * Ensures every chain has a resolved model selected
 */
export const modelResolution: Middleware<ChainContext> = async (ctx, next) => {
  let selectedNametag: string | undefined;

  // Priority 1: Explicit modelNametag
  if (ctx.modelNametag) {
    selectedNametag = ctx.modelNametag;
  }
  // Priority 2: Tag-based auto-selection
  else if (ctx.modelTags && ctx.modelTags.length > 0) {
    const selected = await modelSelector.selectBestModel({
      tags: ctx.modelTags,
      estimatedTokens: ctx.budget?.max || 4096,
    });

    if (!selected) {
      throw new Error(
        `Could not auto-select model matching tags: [${ctx.modelTags.join(", ")}]`
      );
    }

    selectedNametag = selected.nametag;
  }
  // Priority 3: Default model
  else {
    const defaultModel = await modelSelector.getDefaultModel();

    if (!defaultModel) {
      throw new Error(
        "No model selected and no default model configured. " +
          "Set modelNametag, modelTags, or configure default in registry."
      );
    }

    selectedNametag = defaultModel.nametag;
  }

  // Verify model exists
  const model = await modelSelector.getModel(selectedNametag);
  if (!model) {
    throw new Error(`Model '${selectedNametag}' not found in registry`);
  }

  // Store resolved model in context
  ctx.modelNametag = selectedNametag;

  // Check constraints (estimated based on budget)
  // Use the full budget max, not capped at 4096
  const estimatedTokens = ctx.budget?.max || 4096;
  const canHandle = await modelSelector.canHandleRequest(selectedNametag, estimatedTokens);

  if (!canHandle.allowed) {
    throw new Error(
      `Model '${selectedNametag}' cannot handle this request: ${canHandle.reason}`
    );
  }

  // Continue chain
  await next();
};

export default modelResolution;
