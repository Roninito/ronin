/**
 * Resolve ontology state from message or taskId. v1: keyword-based + optional ontology plugin context.
 */

import type { AgentAPI } from "../types/index.js";
import type { OntologyState } from "../chain/types.js";

/** Static mapping: keyword (lowercase) -> { domain, relevantSkills } */
const KEYWORD_MAP: Record<string, { domain: string; relevantSkills: string[] }> = {
  repo: { domain: "repository", relevantSkills: ["skills.run"] },
  repository: { domain: "repository", relevantSkills: ["skills.run"] },
  skill: { domain: "skills", relevantSkills: ["skills.run"] },
  skills: { domain: "skills", relevantSkills: ["skills.run"] },
  memory: { domain: "memory", relevantSkills: ["local.memory.search", "local.events.emit"] },
  search: { domain: "search", relevantSkills: ["local.memory.search", "skills.run"] },
  note: { domain: "memory", relevantSkills: ["local.memory.search"] },
  notes: { domain: "memory", relevantSkills: ["local.memory.search"] },
  docs: { domain: "search", relevantSkills: ["local.memory.search", "skills.run"] },
  tools: { domain: "search", relevantSkills: ["local.memory.search", "skills.run"] },
  reference: { domain: "search", relevantSkills: ["local.memory.search", "skills.run"] },
  "ronin script": { domain: "memory", relevantSkills: ["local.memory.search", "skills.run"] },
};

const DEFAULT_ONTOLOGY: OntologyState = {
  domain: "general",
  relevantSkills: ["local.memory.search", "local.events.emit", "skills.run"],
};

export interface ResolveOntologyParams {
  message: string;
  taskId?: string;
  api?: AgentAPI;
}

/**
 * Return OntologyState for the given message and optional taskId.
 * When taskId and api.ontology are present, uses plugin context; otherwise keyword-based.
 */
export async function resolveOntology(
  params: ResolveOntologyParams
): Promise<OntologyState> {
  const { message, taskId, api } = params;
  const text = (message ?? "").toLowerCase();

  if (taskId && api?.ontology?.context) {
    try {
      const ctx = await api.ontology.context({ taskId, depth: 2, limit: 10 });
      const relevantSkills = (ctx.skills ?? [])
        .map((s: { name?: string | null; id?: string }) => s.name ?? s.id)
        .filter(Boolean) as string[];
      if (relevantSkills.length > 0) {
        return {
          domain: ctx.task?.domain ?? "task",
          relevantSkills,
          constraints: undefined,
        };
      }
    } catch {
      // fall through to keyword
    }
  }

  for (const [keyword, value] of Object.entries(KEYWORD_MAP)) {
    if (text.includes(keyword)) return { ...value };
  }

  return { ...DEFAULT_ONTOLOGY };
}
