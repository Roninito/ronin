/**
 * Chain logging middleware: log chain run start, end, and message content to the terminal.
 * Use with a label (e.g. "skill-maker") so logs are easy to filter.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";

export interface ChainLoggingOptions {
  /** Prefix for log lines (e.g. "skill-maker", "refactory"). */
  label?: string;
  /** Legacy: log level (debug, info, warn, error) - kept for backward compatibility */
  level?: "debug" | "info" | "warn" | "error";
  /** Whether to log full message content (enabled if level is "debug") */
  verbose?: boolean;
}

export function createChainLoggingMiddleware(
  options: ChainLoggingOptions | string
): Middleware<ChainContext> {
  let label = "chain";
  let verbose = false;
  
  if (typeof options === "string") {
    label = options;
  } else {
    label = options.label || "chain";
    verbose = options.verbose || options.level === "debug";
  }
  
  const prefix = `[${label}]`;

  return async (ctx, next) => {
    const msgCount = ctx.messages?.length ?? 0;
    const userCount = ctx.messages?.filter((m) => m.role === "user").length ?? 0;
    
    if (msgCount === 0) {
      console.log(`${prefix} ⚠️  Chain run started with NO MESSAGES (context may be empty)`);
    } else {
      console.log(`${prefix} ▶️  Chain run started (${msgCount} total, ${userCount} user)`);
      
      // Log user messages if verbose
      if (verbose) {
        ctx.messages
          ?.filter((m) => m.role === "user")
          .forEach((m, i) => {
            const content = typeof m.content === "string" 
              ? m.content.slice(0, 200) + (m.content.length > 200 ? "..." : "")
              : JSON.stringify(m.content).slice(0, 200) + "...";
            console.log(`${prefix}   [user ${i + 1}] ${content}`);
          });
      }
    }

    const start = Date.now();
    try {
      await next();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const finalCount = ctx.messages?.length ?? 0;
      const assistantCount = ctx.messages?.filter((m) => m.role === "assistant").length ?? 0;
      const toolCount = ctx.messages?.filter((m) => m.role === "tool").length ?? 0;
      
      if (verbose) {
        // Log assistant responses
        ctx.messages
          ?.filter((m) => m.role === "assistant")
          .forEach((m, i) => {
            const content = typeof m.content === "string" 
              ? m.content.slice(0, 300) + (m.content.length > 300 ? "..." : "")
              : JSON.stringify(m.content).slice(0, 300) + "...";
            console.log(`${prefix}   [assistant ${i + 1}] ${content}`);
          });
      }
      
      console.log(
        `${prefix} ✅ Chain run finished in ${elapsed}s (${finalCount} messages total, ${assistantCount} assistant, ${toolCount} tool results)`
      );
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`${prefix} ❌ Chain run failed after ${elapsed}s: ${(err as Error).message}`);
      
      // Log final message count for debugging
      const finalCount = ctx.messages?.length ?? 0;
      if (finalCount === 0) {
        console.error(`${prefix}    No messages captured before failure (context was empty)`);
      } else {
        const lastMsg = ctx.messages?.[ctx.messages.length - 1];
        if (lastMsg) {
          const content = typeof lastMsg.content === "string" 
            ? lastMsg.content.slice(0, 150) + (lastMsg.content.length > 150 ? "..." : "")
            : JSON.stringify(lastMsg.content).slice(0, 150) + "...";
          console.error(`${prefix}    Last message [${lastMsg.role}]: ${content}`);
        }
      }
      throw err;
    }
  };
}
