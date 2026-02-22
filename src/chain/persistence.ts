/**
 * Persist and rehydrate chain context for restart-safe chains.
 * Executor is not persisted; reattach on rehydrate.
 */

import type { AgentAPI } from "../types/index.js";
import type { Executor } from "../executor/Executor.js";
import type {
  ChainContext,
  ChainMessage,
  TokenBudget,
  OntologyState,
} from "./types.js";

/** Serializable snapshot of chain context (no executor, no internal flags). */
export interface SerializedChainState {
  messages: ChainMessage[];
  ontology?: OntologyState;
  budget?: TokenBudget;
  phase?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

const CHAIN_PREFIX = "chain:";

export function serialize(ctx: ChainContext): SerializedChainState {
  return {
    messages: ctx.messages,
    ontology: ctx.ontology,
    budget: ctx.budget,
    phase: ctx.phase,
    conversationId: ctx.conversationId,
    metadata: ctx.metadata,
  };
}

export function rehydrate(
  data: SerializedChainState,
  executor: Executor
): ChainContext {
  return {
    ...data,
    executor,
    _ontologyInjected: false,
    phaseCompleted: false,
  };
}

export async function persistChain(
  api: AgentAPI,
  chainId: string,
  ctx: ChainContext
): Promise<void> {
  const payload = serialize(ctx);
  await api.memory.store(`${CHAIN_PREFIX}${chainId}`, payload);
}

export async function loadChain(
  api: AgentAPI,
  chainId: string
): Promise<SerializedChainState | null> {
  const value = await api.memory.retrieve(`${CHAIN_PREFIX}${chainId}`);
  if (value == null) return null;
  const data = value as SerializedChainState;
  if (!data.messages || !Array.isArray(data.messages)) return null;
  return data;
}
