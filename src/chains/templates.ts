/**
 * Middleware Templates (Ronin-enhanced)
 *
 * These templates extend the @ronin/sar base templates with Ronin-specific middleware:
 * - modelResolution (Ronin model registry)
 * - ontologyResolve (Ronin ontology resolution)
 *
 * For portable templates without Ronin-specific deps, use @ronin/sar directly.
 *
 * Three templates:
 * - quickSAR: Fast, minimal overhead (logging + modelResolution + trim + tokens + tools)
 * - standardSAR: Recommended (+ ontologyResolve + ontologyInject)
 * - smartSAR: Full-featured (+ persist + phaseReset)
 */

import { MiddlewareStack } from "../middleware/MiddlewareStack.js";
import type { Middleware } from "../middleware/MiddlewareStack.js";
import {
  createChainLoggingMiddleware,
  createSmartTrimMiddleware,
  createTokenGuardMiddleware,
  createAiToolMiddleware,
  createOntologyInjectMiddleware,
  createOntologyResolveMiddleware,
  createPersistChainMiddleware,
  createPhaseResetMiddleware,
  createExecutionTrackingMiddleware,
} from "../middleware/index.js";
import { modelResolution } from "../middleware/modelResolution.js";
import { Chain } from "../chain/Chain.js";
import { Executor } from "../executor/Executor.js";
import type { DutyAPI } from "../types/index.js";
import type { ChainContext } from "../chain/types.js";

// Re-export package types + utilities
export type { TemplateOptions } from "@ronin/sar";
export { CustomSARBuilder, createSARChain } from "@ronin/sar";

export interface TemplateOptions {
  maxTokens?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  ontologyMaxNodes?: number;
  enablePersistence?: boolean;
  enablePhaseReset?: boolean;
}

/**
 * Quick SAR — fast, minimal overhead.
 * Stack: logging → modelResolution → trim → tokenGuard → tools
 */
export function quickSAR(options: TemplateOptions = {}): MiddlewareStack<ChainContext> {
  const stack = new MiddlewareStack<ChainContext>();

  stack.use(createChainLoggingMiddleware({ level: options.logLevel ?? "info" }));
  stack.use(modelResolution);
  stack.use(createSmartTrimMiddleware({ recentCount: 30 }));
  stack.use(createTokenGuardMiddleware({ maxTokens: options.maxTokens ?? 8000 }));
  stack.use(createAiToolMiddleware({ maxIterations: 3 }));

  return stack;
}

/**
 * Standard SAR — recommended for most Ronin agents.
 * Stack: logging → modelResolution → ontologyResolve → ontologyInject → trim → tokenGuard → executionTracking → tools
 */
export function standardSAR(options: TemplateOptions = {}): MiddlewareStack<ChainContext> {
  const stack = new MiddlewareStack<ChainContext>();

  stack.use(createChainLoggingMiddleware({ level: options.logLevel ?? "info" }));
  stack.use(modelResolution);
  stack.use(createOntologyResolveMiddleware());
  stack.use(createOntologyInjectMiddleware());
  stack.use(createSmartTrimMiddleware({ recentCount: 50 }));
  stack.use(createTokenGuardMiddleware({ maxTokens: options.maxTokens ?? 12000 }));
  stack.use(createExecutionTrackingMiddleware());
  stack.use(createAiToolMiddleware({ maxIterations: 5 }));

  return stack;
}

/**
 * Smart SAR — full-featured for complex workflows.
 * Stack: logging → modelResolution → ontologyResolve → ontologyInject → trim → tokenGuard → tools
 *        → executionTracking → [persist] → [phaseReset]
 */
export function smartSAR(
  options: TemplateOptions & {
    persistence?: { api: DutyAPI; chainId: string | ((ctx: ChainContext) => string) };
  } = {}
): MiddlewareStack<ChainContext> {
  const stack = new MiddlewareStack<ChainContext>();

  stack.use(createChainLoggingMiddleware({ level: options.logLevel ?? "debug" }));
  stack.use(modelResolution);
  stack.use(createOntologyResolveMiddleware());
  stack.use(createOntologyInjectMiddleware());
  stack.use(createSmartTrimMiddleware({ recentCount: 100 }));
  stack.use(createTokenGuardMiddleware({ maxTokens: options.maxTokens ?? 16000 }));
  stack.use(createAiToolMiddleware({ maxIterations: 10 }));
  stack.use(createExecutionTrackingMiddleware());

  if (options.enablePersistence !== false && options.persistence) {
    stack.use(createPersistChainMiddleware(options.persistence));
  }

  if (options.enablePhaseReset) {
    stack.use(createPhaseResetMiddleware());
  }

  return stack;
}

/**
 * Helper: create a Chain with a template or stack already wired up.
 */
export function useMiddlewareStack(
  template: "quick" | "standard" | "smart" | MiddlewareStack<ChainContext>,
  api: DutyAPI,
  ctx?: ChainContext,
  options?: TemplateOptions
): Chain {
  const executor = new Executor(api);
  let stack: MiddlewareStack<ChainContext>;
  if (typeof template === "string") {
    switch (template) {
      case "quick":    stack = quickSAR(options); break;
      case "standard": stack = standardSAR(options); break;
      case "smart":    stack = smartSAR(options); break;
      default:         throw new Error(`Unknown template: ${template}`);
    }
  } else {
    stack = template;
  }
  const chain = new Chain(executor, stack);
  if (ctx) chain.withContext(ctx);
  return chain;
}
