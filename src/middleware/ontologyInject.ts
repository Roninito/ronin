/**
 * Ontology injection middleware: inject minimal system message once per run.
 * Do not inject raw JSON; set ctx._ontologyInjected so it runs only once.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";

export function createOntologyInjectMiddleware(): Middleware<ChainContext> {
  return async (ctx, next) => {
    if (!ctx.ontology || ctx._ontologyInjected) {
      await next();
      return;
    }
    const o = ctx.ontology;
    const parts: string[] = [
      `Domain: ${o.domain}`,
      `Relevant skills: ${o.relevantSkills.join(", ")}`,
    ];
    if (o.constraints && Object.keys(o.constraints).length > 0) {
      parts.push(
        `Constraints: ${Object.entries(o.constraints)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join("; ")}`
      );
    }
    ctx.messages.unshift({
      role: "system",
      content: parts.join("\n"),
    });
    ctx._ontologyInjected = true;
    await next();
  };
}
