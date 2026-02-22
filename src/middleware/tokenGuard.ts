/**
 * Token guard middleware: if over budget, drop oldest assistant/tool messages.
 * Never drop latest user or system messages.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext, ChainMessage } from "../chain/types.js";
import { estimateTokens } from "../utils/prompt.js";

function totalTokens(messages: ChainMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function createTokenGuardMiddleware(): Middleware<ChainContext> {
  return async (ctx, next) => {
    const budget = ctx.budget;
    if (!budget || budget.max <= 0) {
      await next();
      return;
    }
    const messages = ctx.messages;
    let total = totalTokens(messages);
    if (total <= budget.max) {
      budget.current = total;
      await next();
      return;
    }
    const system = messages.filter((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    const lastUserIdx = rest.map((m) => m.role).lastIndexOf("user");
    const tailStart = lastUserIdx >= 0 ? lastUserIdx : 0;
    const tail = rest.slice(tailStart);
    const head = rest.slice(0, tailStart);
    const droppable = head.filter((m) => m.role === "assistant" || m.role === "tool");
    const keepFromHead = head.filter((m) => m.role !== "assistant" && m.role !== "tool");
    let trimmedHead: ChainMessage[] = [...keepFromHead, ...droppable];
    for (let drop = 0; drop <= droppable.length; drop++) {
      const candidate = [...keepFromHead, ...droppable.slice(drop), ...tail];
      if (totalTokens([...system, ...candidate]) <= budget.max) {
        trimmedHead = [...keepFromHead, ...droppable.slice(drop)];
        break;
      }
    }
    ctx.messages = [...system, ...trimmedHead, ...tail];
    ctx.budget.current = totalTokens(ctx.messages);
    await next();
  };
}
