/**
 * Types for Workflow — a markdown-defined Standard Operating Procedure that
 * Duties consult as read-only guidance. See ARCHITECTURE.md §2 (Supporting
 * structure) and docs/WORKFLOWS_PLAN.md for the full design.
 *
 * Note: this is unrelated to the pre-existing `WorkflowDefinition` /
 * `WorkflowEngine` in src/tools/types.ts + src/tools/WorkflowEngine.ts (an
 * older, in-memory, tool-step orchestration pipeline used by
 * duties/tool-orchestrator.ts). That naming overlap predates this feature;
 * types here are deliberately named `WorkflowDoc`/`WorkflowMeta` (not
 * `WorkflowDefinition`) to avoid colliding with it.
 */

export type WorkflowStatus = "draft" | "active" | "deprecated";

/** Parsed YAML-ish frontmatter from a workflow markdown file. */
export interface WorkflowFrontmatter {
  name: string;
  description: string;
  tags: string[];
  status: WorkflowStatus;
  /** Advisory only — not enforced, never validated against real skill names. */
  skills: string[];
}

/** A fully parsed workflow file. */
export interface WorkflowDoc {
  frontmatter: WorkflowFrontmatter;
  /** Markdown body, with the frontmatter block removed. */
  body: string;
  /** Full original file content, frontmatter included. */
  raw: string;
  filePath: string;
}

/** Lightweight listing entry — no body/raw, for list views. */
export interface WorkflowMeta {
  name: string;
  description: string;
  tags: string[];
  status: WorkflowStatus;
}
