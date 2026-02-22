/**
 * Phase reset middleware: when ctx.phaseCompleted is true, prune to last user + final assistant + system.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext, ChainMessage } from "../chain/types.js";

export function createPhaseResetMiddleware(): Middleware<ChainContext> {
  return async (ctx, next) => {
    if (!ctx.phaseCompleted) {
      await next();
      return;
    }
    const messages = ctx.messages;
    const system = messages.filter((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    const lastUserIdx = rest.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) {
      await next();
      return;
    }
    const fromLastUser = rest.slice(lastUserIdx);
    const lastAssistantIdx = fromLastUser.map((m) => m.role).lastIndexOf("assistant");
    const lastUserMessage = fromLastUser[0];
    const finalAssistantMessage =
      lastAssistantIdx >= 0 ? fromLastUser[lastAssistantIdx] : null;
    const tail = lastUserMessage
      ? finalAssistantMessage
        ? [lastUserMessage, finalAssistantMessage]
        : [lastUserMessage]
      : [];
    ctx.messages = [...system, ...tail];
    ctx.phaseCompleted = false;
    await next();
  };
}
