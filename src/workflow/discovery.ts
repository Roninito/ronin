/**
 * Discovery for Workflow files — project-level only (workflows/ at repo
 * root), no compile/registration step. Read-only: matching a workflow never
 * mutates anything. Mirrors src/kata/loader.ts's directory-scan shape and
 * src/middleware/artifactInject.ts's keyword-match-and-score shape.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { WorkflowDoc, WorkflowMeta } from "./types.js";
import { parseWorkflowFile } from "./frontmatter.js";

const WORKFLOWS_DIRNAME = "workflows";

export function getWorkflowsDir(projectRoot: string = process.cwd()): string {
  return join(projectRoot, WORKFLOWS_DIRNAME);
}

/** Lowercase letters, digits, hyphens only — also blocks path traversal (no `/`, `..`). */
export function sanitizeWorkflowName(name: string): string | null {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return null;
  return trimmed;
}

export function listWorkflowFiles(projectRoot: string = process.cwd()): string[] {
  const dir = getWorkflowsDir(projectRoot);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

export function loadWorkflowFromFile(filePath: string): WorkflowDoc | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return parseWorkflowFile(raw, filePath);
  } catch {
    return null;
  }
}

function loadAllWorkflows(projectRoot: string = process.cwd()): WorkflowDoc[] {
  return listWorkflowFiles(projectRoot)
    .map(loadWorkflowFromFile)
    .filter((w): w is WorkflowDoc => w !== null && w.frontmatter.name.length > 0);
}

/** Lite listing for `/api/workflows`, `ronin workflow list`, and CLI/UI display. */
export function listWorkflows(projectRoot: string = process.cwd()): WorkflowMeta[] {
  return loadAllWorkflows(projectRoot)
    .map((w) => ({
      name: w.frontmatter.name,
      description: w.frontmatter.description,
      tags: w.frontmatter.tags,
      status: w.frontmatter.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Full doc by exact name (frontmatter `name`, matching the `<name>.md` filename). */
export function loadWorkflow(name: string, projectRoot: string = process.cwd()): WorkflowDoc | null {
  const safeName = sanitizeWorkflowName(name);
  if (!safeName) return null;
  const filePath = join(getWorkflowsDir(projectRoot), `${safeName}.md`);
  if (!existsSync(filePath)) return null;
  return loadWorkflowFromFile(filePath);
}

export interface WorkflowMatch {
  workflow: WorkflowDoc;
  score: number;
  how: "name" | "tags" | "description";
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with",
  "is", "are", "this", "that", "it", "be", "do", "does", "please", "can",
  "you", "me", "my", "our", "we", "what", "how", "should",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Keyword-match a free-text query against known workflows. Simple and cheap
 * on purpose (no embeddings, no extra model call) — same discovery shape as
 * `discover_skills(query)` in docs/SKILLS.md. Deprecated workflows are
 * excluded. Returns the single best match above a confidence floor, or null
 * — callers (the SAR middleware, `ronin workflow` CLI) should no-op on null
 * rather than guess.
 */
export function discoverWorkflow(query: string, projectRoot: string = process.cwd()): WorkflowMatch | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return null;

  const docs = loadAllWorkflows(projectRoot).filter((w) => w.frontmatter.status !== "deprecated");
  if (docs.length === 0) return null;

  const lowerQuery = trimmedQuery.toLowerCase();
  const normalizedQuery = lowerQuery.replace(/-/g, " ");
  const queryTokens = new Set(tokenize(trimmedQuery));
  if (queryTokens.size === 0) return null;

  let best: WorkflowMatch | null = null;
  const consider = (candidate: WorkflowMatch) => {
    if (!best || candidate.score > best.score) best = candidate;
  };

  for (const workflow of docs) {
    const name = workflow.frontmatter.name.toLowerCase();
    const nameAsWords = name.replace(/-/g, " ");

    // 1. Explicit name mention — strongest signal.
    if (name.length >= 4 && (lowerQuery.includes(name) || normalizedQuery.includes(nameAsWords))) {
      consider({ workflow, score: 1, how: "name" });
      continue;
    }

    // 2. Tag keyword overlap.
    const tagTokens = new Set(workflow.frontmatter.tags.map((t) => t.toLowerCase()));
    let tagOverlap = 0;
    for (const t of queryTokens) if (tagTokens.has(t)) tagOverlap++;
    if (tagOverlap > 0) {
      consider({ workflow, score: Math.min(0.5 + tagOverlap * 0.15, 0.9), how: "tags" });
    }

    // 3. Description keyword overlap (needs a couple of shared words, not just one).
    const descTokens = new Set(tokenize(workflow.frontmatter.description));
    let descOverlap = 0;
    for (const t of queryTokens) if (descTokens.has(t)) descOverlap++;
    if (descOverlap >= 2) {
      consider({ workflow, score: Math.min(0.4 + descOverlap * 0.1, 0.8), how: "description" });
    }
  }

  const MIN_CONFIDENCE = 0.5;
  return best && (best as WorkflowMatch).score >= MIN_CONFIDENCE ? best : null;
}
