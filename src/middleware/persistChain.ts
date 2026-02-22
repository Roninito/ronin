/**
 * Persist chain context after the stack runs (restart-safe). Run near end of middleware order.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";
import type { AgentAPI } from "../types/index.js";
import { persistChain } from "../chain/persistence.js";

export interface PersistChainOptions {
  api: AgentAPI;
  /** Chain id for storage key, or function to derive from ctx (e.g. ctx.metadata?.sessionId). */
  chainId: string | ((ctx: ChainContext) => string);
}

export function createPersistChainMiddleware(
  options: PersistChainOptions
): Middleware<ChainContext> {
  const { api, chainId } = options;

  return async (ctx, next) => {
    await next();
    const id = typeof chainId === "function" ? chainId(ctx) : chainId;
    if (!id) return;
    await persistChain(api, id, ctx);
  };
}
