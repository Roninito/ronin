/**
 * SAR chain and context types. ChainContext is serializable except for executor (reattached on rehydrate).
 */

import type { Executor } from "../executor/Executor.js";
import type { ExecutorContext } from "../executor/types.js";

/** Message with optional tool role and name for tool-result messages. */
export interface ChainMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface TokenBudget {
  max: number;
  current: number;
  reservedForResponse: number;
}

export interface OntologyState {
  domain: string;
  relevantSkills: string[];
  constraints?: Record<string, unknown>;
}

/**
 * Chain execution context. Executor is not serialized when persisting.
 */
export interface ChainContext extends ExecutorContext {
  messages: ChainMessage[];
  ontology?: OntologyState;
  budget?: TokenBudget;
  phase?: string;
  /** AI model tier for this chain (e.g. "smart", "fast", "default"). Passed to api.ai.callTools when set. */
  model?: string;
  /** Set by chain runner; excluded from serialized form. */
  executor?: Executor;
  /** Internal: ontology injected once per run. */
  _ontologyInjected?: boolean;
  /** Internal: phase completed, trigger prune in phaseReset middleware. */
  phaseCompleted?: boolean;
}
