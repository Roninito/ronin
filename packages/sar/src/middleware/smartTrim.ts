/**
 * Smart trim middleware: preserve system messages, keep last N non-system messages.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";

const DEFAULT_RECENT_COUNT = 8;

export interface SmartTrimOptions {
  recentCount?: number;
  /** @deprecated Use recentCount. Accepted for backward compat. */
  maxLines?: number;
}

export function createSmartTrimMiddleware(
  options: SmartTrimOptions = {}
): Middleware<ChainContext> {
  const recentCount = options.recentCount ?? options.maxLines ?? DEFAULT_RECENT_COUNT;

  return async (ctx, next) => {
    const messages = ctx.messages;
    const system = messages.filter((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    if (rest.length <= recentCount) {
      await next();
      return;
    }
    const kept = rest.slice(-recentCount);
    ctx.messages = [...system, ...kept];
    await next();
  };
}
