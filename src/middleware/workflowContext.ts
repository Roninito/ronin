/**
 * Workflow context-injection middleware — "pull in the relevant SOP, if any."
 *
 * Confirmed design (docs/WORKFLOWS_PLAN.md §4): Workflows are never run.
 * On each SAR chain run, this derives a query from whatever's available
 * (the duty's name/description, plus the live user message for chat-driven
 * runs), keyword-matches it against workflows/*.md (src/workflow/discovery.ts
 * — same shape as skill discovery), and on a confident match unshifts one
 * system message containing that workflow's body before Analyze runs. No
 * match — no-op, same "never break the chain" contract as
 * createArtifactInjectMiddleware, which this mirrors.
 *
 * Applied uniformly at the SAR envelope level (DutyRegistry.executeDuty()),
 * not opt-in per duty — a scheduled contract run and a live chat turn both
 * get workflow guidance "for free" the moment a matching file exists.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";
import { discoverWorkflow } from "../workflow/discovery.js";
import type { WorkflowMatch } from "../workflow/discovery.js";

export interface WorkflowContextOptions {
  /** Project root containing workflows/. Defaults to process.cwd(). */
  projectRoot?: string;
}

function buildQuery(ctx: ChainContext): string {
  const parts: string[] = [];

  const dutyName = ctx.metadata?.dutyName;
  if (typeof dutyName === "string" && dutyName.trim()) parts.push(dutyName);

  const dutyDescription = ctx.metadata?.dutyDescription;
  if (typeof dutyDescription === "string" && dutyDescription.trim()) parts.push(dutyDescription);

  const lastUser = [...ctx.messages].reverse().find((m) => m.role === "user");
  if (lastUser?.content?.trim()) parts.push(lastUser.content);

  return parts.join(" — ");
}

function renderWorkflowContext(match: WorkflowMatch): string {
  const { workflow } = match;
  return [
    `Workflow guidance (matched by ${match.how}): "${workflow.frontmatter.name}"`,
    workflow.frontmatter.description ? `Purpose: ${workflow.frontmatter.description}` : undefined,
    `This is operator-authored guidance for how this kind of work should go — follow it as a standard, not a rigid script. It is not a tool and cannot be called.`,
    "",
    workflow.body,
  ].filter((line): line is string => line !== undefined).join("\n");
}

export function createWorkflowContextMiddleware(
  options: WorkflowContextOptions = {}
): Middleware<ChainContext> {
  const { projectRoot } = options;

  return async (ctx, next) => {
    if ((ctx as { _workflowInjected?: boolean })._workflowInjected) {
      await next();
      return;
    }

    try {
      const query = buildQuery(ctx);
      if (query.trim().length > 0) {
        const match = discoverWorkflow(query, projectRoot);
        if (match) {
          ctx.messages.unshift({
            role: "system",
            content: renderWorkflowContext(match),
          });
        }
      }
    } catch {
      // Workflow discovery is best-effort context injection — never let it
      // break a chain (missing workflows/ dir, unreadable file, etc).
    }

    (ctx as { _workflowInjected?: boolean })._workflowInjected = true;
    await next();
  };
}
