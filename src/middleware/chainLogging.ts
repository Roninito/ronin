/**
 * Chain logging middleware: log chain run start and end to the terminal.
 * Use with a label (e.g. "skill-maker") so logs are easy to filter.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";

export interface ChainLoggingOptions {
  /** Prefix for log lines (e.g. "skill-maker", "refactory"). */
  label: string;
}

export function createChainLoggingMiddleware(
  options: ChainLoggingOptions | string
): Middleware<ChainContext> {
  const label = typeof options === "string" ? options : options.label;
  const prefix = `[${label}]`;

  return async (ctx, next) => {
    const msgCount = ctx.messages?.length ?? 0;
    const userCount = ctx.messages?.filter((m) => m.role === "user").length ?? 0;
    console.log(`${prefix} Chain run started (${msgCount} messages, ${userCount} user)`);

    const start = Date.now();
    try {
      await next();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const finalCount = ctx.messages?.length ?? 0;
      const assistantCount = ctx.messages?.filter((m) => m.role === "assistant").length ?? 0;
      const toolCount = ctx.messages?.filter((m) => m.role === "tool").length ?? 0;
      console.log(
        `${prefix} Chain run finished in ${elapsed}s (${finalCount} messages, ${assistantCount} assistant, ${toolCount} tool results)`
      );
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`${prefix} Chain run failed after ${elapsed}s:`, (err as Error).message);
      throw err;
    }
  };
}
