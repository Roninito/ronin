import type { Tool } from "../types/api.js";

/**
 * Shared dispatcher tool schemas and prompts.
 *
 * The scheduled crew-dispatcher duty executes these tool calls (wakes via
 * POST /cmd); the dispatcher-console duty offers the same schemas to its
 * read-only ask endpoint and returns proposals WITHOUT executing them.
 * One writer, shared vocabulary — and no duty-to-duty imports.
 */

export const WAKE_TOOL: Tool = {
  type: "function",
  function: {
    name: "crew_wake",
    description:
      "Wake one crew agent in one project because something in the sweep needs engaging. " +
      "Use the reason to say exactly what needs attention (task id, review id, question id).",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "Crew project id from the sweep" },
        agent: { type: "string", description: "Agent name to wake" },
        task: { type: "string", description: "Optional task id to wake the agent about" },
        reason: { type: "string", description: "Why this agent needs to engage" },
      },
      required: ["project", "agent", "reason"],
    },
  },
};

export const NEEDS_HUMAN_TOOL: Tool = {
  type: "function",
  function: {
    name: "flag_needs_human",
    description:
      "Flag something the dispatcher cannot resolve itself (ambiguous ownership, repeated failures, " +
      "a decision only the human can make). Emits a dispatcher.needs_human event.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "Crew project id, or empty when cross-project" },
        summary: { type: "string", description: "What needs the human and why" },
        item: { type: "string", description: "Optional task/review/question id involved" },
      },
      required: ["summary"],
    },
  },
};

export function buildSweepPrompt(
  rollupJson: string,
  context: { maxWakes: number; cooledDown: string[]; dryRun: boolean },
): string {
  return `You are the crew dispatcher, a machine-level watcher over every crew project.
Once per hour you sweep crew state and wake exactly the agents that need engaging.

Crew state (GET /dispatcher rollup; agents carry name/state/task, plus actionable id lists):
${rollupJson}

Sweep policy — wake an agent only for one of these:
- review/escalated/sampled items aging with nobody on them (review[] entries)
- blocked tasks idle past a reasonable threshold (blocked[] entries)
- tasks in an uncoverable state with no planner follow-up
- unacknowledged anomalies (repeated failures, expiring claims)
- ready tasks matching idle enabled agents (same needs/can rule as crew wake)
- aging open questions (questions[] entries)
- lost jobs or an unhealthy crew service

Guards (hard rules):
- Never verify work and never approve anything — those lanes belong to verifiers and humans.
- At most ${context.maxWakes} wakes this run. Prefer the highest-impact ones.
- These agents are inside their wake cooldown — do NOT wake them again: ${context.cooledDown.length ? context.cooledDown.join(", ") : "(none)"}.
- Paused projects are out of scope — never wake into them.
- Every wake needs a concrete reason naming the item (task/review/question id).
- If everything is healthy, call no tools at all.
- When something needs the human instead of an agent, use flag_needs_human.
${context.dryRun ? "- DRY RUN: decide normally, but no wake will actually be sent." : ""}

Call crew_wake once per agent to wake, or flag_needs_human for human escalations.`;
}

export function buildAskPrompt(rollupJson: string, question: string): string {
  return `You are the crew dispatcher console, answering the human about live crew state.
Crew state (GET /dispatcher rollup, just fetched):
${rollupJson}

Human question: ${question}

Answer from the state above — name concrete projects, agents, and task/review/question ids.
You may call crew_wake to PROPOSE wakes and flag_needs_human to propose escalations, but this console is read-only: proposals are shown to the human, nothing is executed here. The hourly scheduled sweep is the only writer.

Keep the answer short enough to speak in under a minute (max ~130 words).`;
}
