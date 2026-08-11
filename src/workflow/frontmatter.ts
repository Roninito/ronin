/**
 * Frontmatter parsing for workflow markdown files.
 *
 * Deliberately simple regex-based parsing (no YAML library dependency) —
 * mirrors the convention already used for skill.md frontmatter in
 * plugins/skills.ts (parseFrontmatter/parseSkillMd). Malformed frontmatter
 * never throws: callers get back empty/default fields and can decide
 * whether that's fatal (e.g. discovery skips files with no name).
 */

import type { WorkflowDoc, WorkflowFrontmatter, WorkflowStatus } from "./types.js";

function parseScalarField(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^["']|["']$/g, "");
}

function parseListField(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  const bracketed = trimmed.match(/^\[(.*)\]$/);
  const inner = bracketed?.[1] ?? trimmed;
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseStatusField(raw: string | undefined): WorkflowStatus {
  const value = parseScalarField(raw);
  return value === "active" || value === "deprecated" ? value : "draft";
}

/** Parse the raw frontmatter block (text between the `---` fences, not including them). */
export function parseWorkflowFrontmatter(raw: string): WorkflowFrontmatter {
  const nameMatch = raw.match(/^name:\s*(.+)$/m);
  const descMatch = raw.match(/^description:\s*(.+)$/m);
  const statusMatch = raw.match(/^status:\s*(.+)$/m);
  const tagsMatch = raw.match(/^tags:\s*(.+)$/m);
  const skillsMatch = raw.match(/^skills:\s*(.+)$/m);

  return {
    name: parseScalarField(nameMatch?.[1]),
    description: parseScalarField(descMatch?.[1]),
    status: parseStatusField(statusMatch?.[1]),
    tags: parseListField(tagsMatch?.[1]),
    skills: parseListField(skillsMatch?.[1]),
  };
}

/** Parse a full workflow markdown file (frontmatter + body) read from `filePath`. */
export function parseWorkflowFile(content: string, filePath: string): WorkflowDoc {
  const parts = content.split(/\n---\s*\n/);
  if (!content.trimStart().startsWith("---") || parts.length < 2) {
    // No frontmatter block — treat the whole file as body, name left blank
    // (callers that require a name, like discovery, will skip this file).
    return {
      frontmatter: { name: "", description: "", tags: [], status: "draft", skills: [] },
      body: content.trim(),
      raw: content,
      filePath,
    };
  }
  const frontmatter = parseWorkflowFrontmatter(parts[0] ?? "");
  const body = parts.slice(1).join("\n---\n").trim();
  return { frontmatter, body, raw: content, filePath };
}

/** Serialize frontmatter + body back into a workflow markdown file's full text. */
export function renderWorkflowFile(frontmatter: WorkflowFrontmatter, body: string): string {
  const lines = [
    "---",
    `name: ${frontmatter.name}`,
    `description: ${frontmatter.description}`,
    `tags: [${frontmatter.tags.join(", ")}]`,
    `status: ${frontmatter.status}`,
    `skills: [${frontmatter.skills.join(", ")}]`,
    "---",
    "",
    body.trim(),
    "",
  ];
  return lines.join("\n");
}
