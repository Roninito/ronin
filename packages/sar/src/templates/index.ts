/**
 * Middleware Templates for @ronin/sar
 *
 * Pre-configured middleware stacks for common SAR patterns.
 *
 * Three built-in templates:
 * - quickSAR:    Fast, minimal (logging → trim → tokenGuard → tools)
 * - standardSAR: Recommended (+ ontologyInject + executionTracking)
 * - smartSAR:    Full-featured (+ persist + phaseReset)
 *
 * Both standardSAR and smartSAR accept an optional modelRegistry to enable
 * automatic model selection. When omitted, ctx.modelNametag must be set by the caller.
 */

import { MiddlewareStack } from "../middleware/MiddlewareStack.js";
import type { Middleware } from "../middleware/MiddlewareStack.js";
import {
  createChainLoggingMiddleware,
  createSmartTrimMiddleware,
  createTokenGuardMiddleware,
  createAiToolMiddleware,
  createOntologyInjectMiddleware,
  createPersistChainMiddleware,
  createPhaseResetMiddleware,
  createExecutionTrackingMiddleware,
  createModelResolutionMiddleware,
} from "../middleware/index.js";
import { Chain } from "../chain/Chain.js";
import { Executor } from "../executor/Executor.js";
import type { SARAgentAPI } from "../types/api.js";
import type { ChainContext } from "../chain/types.js";
import type { ModelRegistry } from "../middleware/modelResolution.js";

export interface TemplateOptions {
  /** Hard token limit for the chain (default varies per template). */
  maxTokens?: number;
  /** Log level. "debug" enables verbose message logging. */
  logLevel?: "debug" | "info" | "warn" | "error";
  /** Max nodes when injecting ontology context (default: 10). */
  ontologyMaxNodes?: number;
  /** When true, enable chain state persistence in smartSAR (default: true for smartSAR). */
  enablePersistence?: boolean;
  /** When true, enable phase reset middleware in smartSAR. */
  enablePhaseReset?: boolean;
  /**
   * Optional model registry. When provided, model resolution middleware is added
   * to automatically select a model from ctx.modelTags or the registry default.
   * When omitted, ctx.modelNametag must be set before running the chain.
   */
  modelRegistry?: ModelRegistry;
}

function addModelResolution(
  stack: MiddlewareStack<ChainContext>,
  registry?: ModelRegistry
): void {
  if (registry) {
    stack.use(createModelResolutionMiddleware(registry));
  }
}

/**
 * Quick SAR — fast, minimal overhead.
 *
 * Stack: logging → [modelResolution] → trim → tokenGuard → tools
 *
 * Use when: simple single-step tool calls, performance-critical, no ontology needed.
 * Performance: ~0.5s latency, 50MB memory
 */
export function quickSAR(options: TemplateOptions = {}): MiddlewareStack<ChainContext> {
  const stack = new MiddlewareStack<ChainContext>();

  stack.use(createChainLoggingMiddleware({ level: options.logLevel ?? "info" }));
  addModelResolution(stack, options.modelRegistry);
  stack.use(createSmartTrimMiddleware({ recentCount: 30 }));
  stack.use(createTokenGuardMiddleware({ maxTokens: options.maxTokens ?? 8000 }));
  stack.use(createAiToolMiddleware({ maxIterations: 3 }));

  return stack;
}

/**
 * Standard SAR — recommended for most agents.
 *
 * Stack: logging → [modelResolution] → ontologyInject → trim → tokenGuard → executionTracking → tools
 *
 * Use when: production agents, multi-turn conversations, structured knowledge needed.
 * Performance: ~1.2s latency, 80MB memory
 */
export function standardSAR(options: TemplateOptions = {}): MiddlewareStack<ChainContext> {
  const stack = new MiddlewareStack<ChainContext>();

  stack.use(createChainLoggingMiddleware({ level: options.logLevel ?? "info" }));
  addModelResolution(stack, options.modelRegistry);
  stack.use(createOntologyInjectMiddleware());
  stack.use(createSmartTrimMiddleware({ recentCount: 50 }));
  stack.use(createTokenGuardMiddleware({ maxTokens: options.maxTokens ?? 12000 }));
  stack.use(createExecutionTrackingMiddleware());
  stack.use(createAiToolMiddleware({ maxIterations: 5 }));

  return stack;
}

/**
 * Smart SAR — full-featured for complex, long-running workflows.
 *
 * Stack: logging → [modelResolution] → ontologyInject → trim → tokenGuard → tools
 *        → executionTracking → [persistChain] → [phaseReset]
 *
 * Use when: complex multi-turn conversations, state persistence, phase-based workflows.
 * Performance: ~2.5s latency, 150MB memory
 *
 * Note: persistChain requires api + chainId to be configured via options.
 */
export function smartSAR(
  options: TemplateOptions & {
    /** Required for persistChain: api instance and chain storage key. */
    persistence?: { api: SARAgentAPI; chainId: string | ((ctx: ChainContext) => string) };
  } = {}
): MiddlewareStack<ChainContext> {
  const stack = new MiddlewareStack<ChainContext>();

  stack.use(createChainLoggingMiddleware({ level: options.logLevel ?? "debug" }));
  addModelResolution(stack, options.modelRegistry);
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
 * Fluent builder for custom SAR middleware stacks.
 *
 * @example
 * const stack = new CustomSARBuilder()
 *   .withLogging("debug")
 *   .withOntologyInject()
 *   .withSmartTrim(75)
 *   .withTokenGuard(14000)
 *   .withToolExecution(7)
 *   .build();
 */
export class CustomSARBuilder {
  private mws: Middleware<ChainContext>[] = [];

  withLogging(level: "debug" | "info" | "warn" | "error" = "info"): this {
    this.mws.push(createChainLoggingMiddleware({ level }));
    return this;
  }

  withModelResolution(registry: ModelRegistry): this {
    this.mws.push(createModelResolutionMiddleware(registry));
    return this;
  }

  withOntologyInject(): this {
    this.mws.push(createOntologyInjectMiddleware());
    return this;
  }

  withSmartTrim(recentCount = 50): this {
    this.mws.push(createSmartTrimMiddleware({ recentCount }));
    return this;
  }

  withTokenGuard(maxTokens = 12000): this {
    this.mws.push(createTokenGuardMiddleware({ maxTokens }));
    return this;
  }

  withToolExecution(maxIterations = 5, logLabel?: string): this {
    this.mws.push(createAiToolMiddleware({ maxIterations, logLabel }));
    return this;
  }

  withExecutionTracking(): this {
    this.mws.push(createExecutionTrackingMiddleware());
    return this;
  }

  withPersistence(options: { api: SARAgentAPI; chainId: string | ((ctx: ChainContext) => string) }): this {
    this.mws.push(createPersistChainMiddleware(options));
    return this;
  }

  withPhaseReset(): this {
    this.mws.push(createPhaseResetMiddleware());
    return this;
  }

  /** Add any custom middleware. */
  use(mw: Middleware<ChainContext>): this {
    this.mws.push(mw);
    return this;
  }

  build(): MiddlewareStack<ChainContext> {
    const stack = new MiddlewareStack<ChainContext>();
    for (const mw of this.mws) stack.use(mw);
    return stack;
  }
}

/**
 * Helper: create a Chain directly from a template name or stack.
 *
 * @example
 * const chain = createSARChain("standard", api, ctx, { maxTokens: 8192 });
 * await chain.run();
 */
export function createSARChain(
  template: "quick" | "standard" | "smart" | MiddlewareStack<ChainContext>,
  api: SARAgentAPI,
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
