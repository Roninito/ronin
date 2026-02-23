/**
 * Middleware Templates
 * 
 * Pre-configured middleware stacks for common SAR patterns.
 * Use these instead of manually building middleware stacks.
 * 
 * Three templates:
 * - quickSAR: Fast, minimal overhead (logging + trim + tokens + tools)
 * - standardSAR: Recommended for most agents (+ ontology)
 * - smartSAR: Full-featured for complex workflows (+ persist, phase reset)
 */

import type { Middleware } from "../middleware/MiddlewareStack.js";
import { MiddlewareStack } from "../middleware/MiddlewareStack.js";
import {
  createChainLoggingMiddleware,
  createSmartTrimMiddleware,
  createTokenGuardMiddleware,
  createAiToolMiddleware,
  createOntologyInjectMiddleware,
  createOntologyResolveMiddleware,
  createPersistChainMiddleware,
  createPhaseResetMiddleware,
} from "../middleware/index.js";

/**
 * Template configuration options
 */
export interface TemplateOptions {
  maxTokens?: number;
  tokenBudget?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  ontologyMaxNodes?: number;
  enablePersistence?: boolean;
  enablePhaseReset?: boolean;
}

/**
 * Quick SAR Template
 * 
 * Fast, minimal overhead for simple tool calls
 * Stack: logging → trim → tokens → tools
 * 
 * Use when:
 * - Simple single-step tool calls
 * - Performance is critical
 * - Ontology not needed
 * - Single-turn interactions
 * 
 * Performance: ~0.5s latency, 50MB memory
 */
export function quickSAR(options: TemplateOptions = {}): MiddlewareStack {
  const stack = new MiddlewareStack();

  stack.use(
    createChainLoggingMiddleware({
      level: options.logLevel || "info",
    })
  );

  stack.use(
    createSmartTrimMiddleware({
      maxLines: 30,
    })
  );

  stack.use(
    createTokenGuardMiddleware({
      maxTokens: options.maxTokens || 8000,
    })
  );

  stack.use(
    createAiToolMiddleware({
      maxIterations: 3,
    })
  );

  return stack;
}

/**
 * Standard SAR Template (RECOMMENDED)
 * 
 * Balanced approach for most agents
 * Stack: logging → ontology resolve → ontology inject → trim → tokens → tools
 * 
 * Use when:
 * - Most agents should use this
 * - Need ontology context
 * - Balanced performance/features
 * - Want structured knowledge integration
 * - Multi-turn conversations
 * 
 * Performance: ~1.2s latency, 80MB memory
 */
export function standardSAR(options: TemplateOptions = {}): MiddlewareStack {
  const stack = new MiddlewareStack();

  stack.use(
    createChainLoggingMiddleware({
      level: options.logLevel || "info",
    })
  );

  // Resolve ontology references first
  stack.use(
    createOntologyResolveMiddleware({
      maxDepth: 2,
    })
  );

  // Then inject ontology context
  stack.use(
    createOntologyInjectMiddleware({
      maxNodes: options.ontologyMaxNodes || 10,
    })
  );

  // Smart trimming for context management
  stack.use(
    createSmartTrimMiddleware({
      maxLines: 50,
      keepRecentMessages: 5,
    })
  );

  // Enforce token budget
  stack.use(
    createTokenGuardMiddleware({
      maxTokens: options.maxTokens || 12000,
    })
  );

  // Execute tools via AI
  stack.use(
    createAiToolMiddleware({
      maxIterations: 5,
    })
  );

  return stack;
}

/**
 * Smart SAR Template
 * 
 * Full-featured for complex workflows
 * Stack: logging → ontology resolve → ontology inject → trim → tokens → tools → persist → phase reset
 * 
 * Use when:
 * - Complex multi-turn conversations
 * - Need state persistence
 * - Long-running agents
 * - Complex decision making needed
 * - Need to reset between phases
 * 
 * Performance: ~2.5s latency, 150MB memory
 */
export function smartSAR(options: TemplateOptions = {}): MiddlewareStack {
  const stack = new MiddlewareStack();

  stack.use(
    createChainLoggingMiddleware({
      level: options.logLevel || "debug",
    })
  );

  // Resolve ontology references
  stack.use(
    createOntologyResolveMiddleware({
      maxDepth: 3,
    })
  );

  // Inject rich ontology context
  stack.use(
    createOntologyInjectMiddleware({
      maxNodes: options.ontologyMaxNodes || 20,
    })
  );

  // Intelligent context trimming
  stack.use(
    createSmartTrimMiddleware({
      maxLines: 100,
      keepRecentMessages: 10,
    })
  );

  // Strict token budget enforcement
  stack.use(
    createTokenGuardMiddleware({
      maxTokens: options.maxTokens || 16000,
    })
  );

  // Tool execution with higher iteration limit
  stack.use(
    createAiToolMiddleware({
      maxIterations: 10,
    })
  );

  // Persist chain state
  if (options.enablePersistence !== false) {
    stack.use(
      createPersistChainMiddleware({
        storageKey: "chain-state",
      })
    );
  }

  // Reset between phases if enabled
  if (options.enablePhaseReset) {
    stack.use(
      createPhaseResetMiddleware({
        resetOnPhaseChange: true,
      })
    );
  }

  return stack;
}

/**
 * Custom SAR Template Builder
 * 
 * For advanced use cases where you need custom middleware composition
 */
export class CustomSARBuilder {
  private middlewares: Array<() => Middleware> = [];

  /**
   * Add logging middleware
   */
  withLogging(level: "debug" | "info" | "warn" | "error" = "info"): this {
    this.middlewares.push(() =>
      createChainLoggingMiddleware({ level })
    );
    return this;
  }

  /**
   * Add ontology resolution
   */
  withOntologyResolve(maxDepth: number = 2): this {
    this.middlewares.push(() =>
      createOntologyResolveMiddleware({ maxDepth })
    );
    return this;
  }

  /**
   * Add ontology injection
   */
  withOntologyInject(maxNodes: number = 10): this {
    this.middlewares.push(() =>
      createOntologyInjectMiddleware({ maxNodes })
    );
    return this;
  }

  /**
   * Add smart trimming
   */
  withSmartTrim(maxLines: number = 50, keepRecent: number = 5): this {
    this.middlewares.push(() =>
      createSmartTrimMiddleware({
        maxLines,
        keepRecentMessages: keepRecent,
      })
    );
    return this;
  }

  /**
   * Add token guard
   */
  withTokenGuard(maxTokens: number = 12000): this {
    this.middlewares.push(() =>
      createTokenGuardMiddleware({ maxTokens })
    );
    return this;
  }

  /**
   * Add AI tool middleware
   */
  withToolExecution(maxIterations: number = 5): this {
    this.middlewares.push(() =>
      createAiToolMiddleware({ maxIterations })
    );
    return this;
  }

  /**
   * Add persistence
   */
  withPersistence(storageKey: string = "chain-state"): this {
    this.middlewares.push(() =>
      createPersistChainMiddleware({ storageKey })
    );
    return this;
  }

  /**
   * Add phase reset
   */
  withPhaseReset(): this {
    this.middlewares.push(() =>
      createPhaseResetMiddleware({ resetOnPhaseChange: true })
    );
    return this;
  }

  /**
   * Build the middleware stack
   */
  build(): MiddlewareStack {
    const stack = new MiddlewareStack();
    for (const middlewareFactory of this.middlewares) {
      stack.use(middlewareFactory());
    }
    return stack;
  }
}

/**
 * Helper to get template by name
 */
export function getTemplate(
  name: "quick" | "standard" | "smart",
  options?: TemplateOptions
): MiddlewareStack {
  switch (name) {
    case "quick":
      return quickSAR(options);
    case "standard":
      return standardSAR(options);
    case "smart":
      return smartSAR(options);
    default:
      throw new Error(`Unknown template: ${name}`);
  }
}

/**
 * Recommended defaults
 */
export const TemplateDefaults = {
  quick: {
    maxTokens: 8000,
    logLevel: "info" as const,
  },
  standard: {
    maxTokens: 12000,
    logLevel: "info" as const,
    ontologyMaxNodes: 10,
  },
  smart: {
    maxTokens: 16000,
    logLevel: "debug" as const,
    ontologyMaxNodes: 20,
    enablePersistence: true,
  },
};

/**
 * Example usage:
 * 
 * // Use standard template (recommended for most agents)
 * const stack = standardSAR({ maxTokens: 12000 });
 * 
 * // Use quick template for performance-critical code
 * const stack = quickSAR();
 * 
 * // Use smart template for complex workflows
 * const stack = smartSAR({ enablePersistence: true });
 * 
 * // Custom template
 * const stack = new CustomSARBuilder()
 *   .withLogging("debug")
 *   .withOntologyInject(15)
 *   .withSmartTrim(75, 8)
 *   .withTokenGuard(14000)
 *   .withToolExecution(7)
 *   .build();
 */
