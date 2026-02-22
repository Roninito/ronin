/**
 * Resolve ontology from last user message (and optional taskId on context); set ctx.ontology.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";
import { resolveOntology } from "../ontology/resolveOntology.js";

export interface OntologyResolveOptions {
  api?: import("../types/index.js").AgentAPI;
  /** If set, ctx.metadata?.taskId is used when resolving. */
  useTaskIdFromMetadata?: boolean;
}

export function createOntologyResolveMiddleware(
  options: OntologyResolveOptions = {}
): Middleware<ChainContext> {
  const { api, useTaskIdFromMetadata = true } = options;

  return async (ctx, next) => {
    if (ctx.ontology?.relevantSkills?.length) {
      await next();
      return;
    }
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === "user");
    const message = lastUser?.content ?? "";
    const taskId =
      useTaskIdFromMetadata && ctx.metadata?.taskId != null
        ? String(ctx.metadata.taskId)
        : undefined;
    ctx.ontology = await resolveOntology({ message, taskId, api });
    await next();
  };
}
