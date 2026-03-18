/**
 * Model Resolution Middleware
 *
 * Resolves model selection for the chain:
 * 1. Explicit modelNametag → use specified model
 * 2. modelTags → auto-select best model by tags via injected registry
 * 3. Default model → use registry default
 *
 * The ModelRegistry interface is injected so any app can provide its own implementation.
 */

import type { ChainContext } from "../chain/types.js";
import type { Middleware } from "./MiddlewareStack.js";

export interface ModelInfo {
  nametag: string;
  limits: { maxTokensPerRequest: number };
}

export interface ModelRegistry {
  selectBestModel(opts: { tags: string[]; estimatedTokens: number }): Promise<ModelInfo | null>;
  getDefaultModel(): Promise<ModelInfo | null>;
  getModel(nametag: string): Promise<ModelInfo | null>;
  canHandleRequest(nametag: string, tokens: number): Promise<{ allowed: boolean; reason?: string }>;
  listModels(): Promise<ModelInfo[]>;
}

/**
 * Create model resolution middleware with an injected ModelRegistry.
 *
 * @example
 * import { createModelResolutionMiddleware } from "@ronin/sar";
 * import { modelSelector } from "./plugins/model-selector.js";
 *
 * const modelResolution = createModelResolutionMiddleware(modelSelector);
 * stack.use(modelResolution);
 */
export function createModelResolutionMiddleware(
  registry: ModelRegistry
): Middleware<ChainContext> {
  return async (ctx, next) => {
    let selectedNametag: string | undefined;

    if (ctx.modelNametag) {
      selectedNametag = ctx.modelNametag;
    } else if (ctx.modelTags && ctx.modelTags.length > 0) {
      const selected = await registry.selectBestModel({
        tags: ctx.modelTags,
        estimatedTokens: ctx.budget?.max || 4096,
      });
      if (!selected) {
        throw new Error(
          `Could not auto-select model matching tags: [${ctx.modelTags.join(", ")}]`
        );
      }
      selectedNametag = selected.nametag;
    } else {
      const defaultModel = await registry.getDefaultModel();
      if (!defaultModel) {
        throw new Error(
          "No model selected and no default model configured. " +
            "Set modelNametag, modelTags, or configure default in registry."
        );
      }
      selectedNametag = defaultModel.nametag;
    }

    const model = await registry.getModel(selectedNametag);
    if (!model) {
      throw new Error(`Model '${selectedNametag}' not found in registry`);
    }

    ctx.modelNametag = selectedNametag;

    const estimatedTokens = ctx.budget?.max || 4096;
    let canHandle = await registry.canHandleRequest(selectedNametag, estimatedTokens);

    if (!canHandle.allowed) {
      const allModels = await registry.listModels();
      const capable = allModels
        .filter((m) => m.limits.maxTokensPerRequest >= estimatedTokens)
        .sort((a, b) => b.limits.maxTokensPerRequest - a.limits.maxTokensPerRequest);

      if (capable.length > 0) {
        const fallback = capable[0]!;
        console.log(
          `[modelResolution] Falling back from '${selectedNametag}' to '${fallback.nametag}' ` +
            `(supports ${fallback.limits.maxTokensPerRequest} tokens)`
        );
        ctx.modelNametag = fallback.nametag;
        canHandle = { allowed: true };
      }
    }

    if (!canHandle.allowed) {
      throw new Error(
        `Model '${ctx.modelNametag}' cannot handle this request: ${canHandle.reason}`
      );
    }

    await next();
  };
}
