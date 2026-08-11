/**
 * workflow propose — AI-authoring for Workflow markdown files.
 *
 * Mirrors src/contract/propose.ts's pattern (plain-English intent -> AI
 * completion -> parse -> preview), reused by both the `ronin workflow
 * propose` CLI command and the Chatty tool (workflows.propose). This module
 * only drafts — it never writes to workflows/ or any table. The CLI writes
 * directly after an inline y/n confirm (mirrors `contract propose`); the
 * chat tool stages the draft as a pending WorkflowProposalRecord for
 * approval via a chat card (see proposal-storage.ts) since that path is
 * unattended.
 */

import type { DutyAPI } from "../types/index.js";
import { listWorkflows } from "./discovery.js";

export class WorkflowProposeError extends Error {}

export interface WorkflowProposal {
  name: string;
  description: string;
  /** Full markdown file content, frontmatter included. */
  content: string;
  /** Deterministic one-line preview for approval UIs — never raw content. */
  preview: string;
}

function buildSystemPrompt(intent: string, existing: { name: string; description: string }[]): string {
  const existingList = existing.length > 0
    ? existing.map((w) => `  - ${w.name}: ${w.description}`).join("\n")
    : "  (none yet)";

  return `You are drafting a Ronin "Workflow" — a markdown Standard Operating Procedure describing a repeatable category of work: its purpose, standards, and rough steps. It is guidance an AI Duty consults, not executable code — no compiler, no validation, just clear prose a human can freely hand-edit later.

Given a plain-English description of the work, respond with ONLY the full markdown file content (no code fences, no explanation before or after) in exactly this shape:

---
name: kebab-case-name
description: one sentence description
tags: [tag1, tag2, tag3]
status: draft
skills: [optional, advisory, skill, names, not, enforced]
---

# Title

## Purpose
What "done" looks like and why this workflow exists.

## When to use
Trigger conditions — when a Duty or the user should reach for this.

## Standards & expectations
Quality bar, tone, required approvals, things to always/never do.

## Steps
1. First step, naming a skill/tool loosely if relevant.
2. ...

## Notes
Freeform — gotchas, open questions.

Pick a kebab-case name distinct from these existing workflows:
${existingList}

Work to formalize: ${intent}`;
}

function stripFences(raw: string): string {
  return raw.replace(/^```[a-z]*\n?/im, "").replace(/\n?```$/im, "").trim();
}

/** Draft a workflow markdown file from a plain-English intent. Writes nothing. */
export async function proposeWorkflow(intent: string, api: DutyAPI): Promise<WorkflowProposal> {
  if (!intent.trim()) {
    throw new WorkflowProposeError("Description required");
  }

  const existing = listWorkflows();
  const systemPrompt = buildSystemPrompt(intent, existing);
  const raw = await api.ai.complete(systemPrompt);
  const content = stripFences(raw);

  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);
  const name = (nameMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  const description = (descMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "");

  if (!name || !content.trimStart().startsWith("---")) {
    throw new WorkflowProposeError("AI did not return a valid workflow document (missing frontmatter or name)");
  }

  return {
    name,
    description,
    content,
    preview: `Drafts workflow '${name}'${description ? ` — ${description}` : ""}`,
  };
}
