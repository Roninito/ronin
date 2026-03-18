/**
 * @ronin/sar — Semantic Agent Runtime
 *
 * Middleware-based AI agent execution engine with tool calling,
 * token budgets, ontology injection, and chain persistence.
 *
 * Quick start:
 * ```typescript
 * import { standardSAR, Chain, Executor } from "@ronin/sar";
 *
 * const executor = new Executor(api);  // api satisfies SARAgentAPI
 * const stack = standardSAR({ maxTokens: 12000 });
 * const chain = new Chain(executor, stack);
 * chain.withContext({ messages: [{ role: "user", content: "Hello!" }] });
 * await chain.run();
 * ```
 *
 * Or use the helper:
 * ```typescript
 * import { createSARChain } from "@ronin/sar";
 *
 * const chain = createSARChain("standard", api, ctx);
 * await chain.run();
 * ```
 */

// Core types
export type { SARAgentAPI, SARTool, SARToolCall, SARMessage, SARCompletionOptions } from "./types/api.js";
export type { SARToolDefinition, SARToolResult, SARToolContext, OpenAIFunctionSchema, JSONSchema } from "./types/tools.js";

// Chain
export { Chain } from "./chain/Chain.js";
export type { ChainContext, ChainMessage, TokenBudget, OntologyState } from "./chain/types.js";
export { serialize, rehydrate, persistChain, loadChain } from "./chain/persistence.js";
export type { SerializedChainState } from "./chain/persistence.js";

// Executor
export { Executor } from "./executor/Executor.js";
export type { ToolFilter, ExecutorContext } from "./executor/types.js";

// Middleware stack
export { MiddlewareStack } from "./middleware/MiddlewareStack.js";
export type { Middleware } from "./middleware/MiddlewareStack.js";

// Middleware factories
export { createAiToolMiddleware } from "./middleware/aiToolMiddleware.js";
export type { AiToolMiddlewareOptions } from "./middleware/aiToolMiddleware.js";

export { createChainLoggingMiddleware } from "./middleware/chainLogging.js";
export type { ChainLoggingOptions } from "./middleware/chainLogging.js";

export { createSmartTrimMiddleware } from "./middleware/smartTrim.js";
export type { SmartTrimOptions } from "./middleware/smartTrim.js";

export { createTokenGuardMiddleware } from "./middleware/tokenGuard.js";

export { createOntologyInjectMiddleware } from "./middleware/ontologyInject.js";

export { createPhaseResetMiddleware } from "./middleware/phaseReset.js";

export { createPersistChainMiddleware } from "./middleware/persistChain.js";
export type { PersistChainOptions } from "./middleware/persistChain.js";

export {
  createExecutionTrackingMiddleware,
  getExecutionLog,
  clearExecutionLog,
} from "./middleware/executionTracking.js";

export { createModelResolutionMiddleware } from "./middleware/modelResolution.js";
export type { ModelRegistry, ModelInfo } from "./middleware/modelResolution.js";

// Templates
export { quickSAR, standardSAR, smartSAR, CustomSARBuilder, createSARChain } from "./templates/index.js";
export type { TemplateOptions } from "./templates/index.js";

// Utilities
export { buildToolPrompt, estimateTokens } from "./utils/prompt.js";
export type { BuildToolPromptParams } from "./utils/prompt.js";
