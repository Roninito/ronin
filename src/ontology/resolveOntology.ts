/**
 * Resolve a lightweight "domain + relevant skills" hint from a message,
 * via a static keyword map. Used by createOntologyInjectMiddleware (see
 * packages/sar/src/middleware/ontologyInject.ts) to format a short system
 * hint — unrelated to the (removed) ontology knowledge graph or the
 * external Ontologist daemon that used to back this.
 */

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
}

/** Return a domain/relevant-skills hint for the given message, from the static keyword map. */
export async function resolveOntology(params: ResolveOntologyParams): Promise<OntologyState> {
  const text = (params.message ?? "").toLowerCase();

  for (const [keyword, value] of Object.entries(KEYWORD_MAP)) {
    if (text.includes(keyword)) return { ...value };
  }

  return { ...DEFAULT_ONTOLOGY };
}
