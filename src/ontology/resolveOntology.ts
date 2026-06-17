/**
 * Resolve ontology state from message or taskId.
 * Priority: 1) plugin context (api.ontology), 2) Ontologist daemon, 3) keyword fallback
 */

import type { DutyAPI } from "../types/index.js";
import type { OntologyState } from "../chain/types.js";

const ONT_BASE = process.env.ONT_BASE_URL ?? "http://localhost:47731";
const ONT_CLIENT_ID = process.env.ONT_CLIENT_ID ?? "ronin";

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
  api?: DutyAPI;
}

/**
 * Return OntologyState for the given message and optional taskId.
 * 1. If api.ontology.context is available, use it (plugin-driven).
 * 2. Query the Ontologist daemon for relevant context (live knowledge graph).
 * 3. Fall through to static keyword matching.
 */
export async function resolveOntology(
  params: ResolveOntologyParams
): Promise<OntologyState> {
  const { message, taskId, api } = params;
  const text = (message ?? "").toLowerCase();

  // ── 1. Plugin context ──────────────────────────────────────────────────────
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
      // fall through
    }
  }

  // ── 2. Ontologist daemon (best-effort, non-blocking) ───────────────────────
  try {
    const res = await fetch(
      `${ONT_BASE}/api/context?q=${encodeURIComponent(message.slice(0, 200))}`,
      {
        headers: { "X-Client-ID": ONT_CLIENT_ID },
        signal: AbortSignal.timeout(2000),
      },
    );

    if (res.ok) {
      const data = await res.json() as {
        nodes?: Array<{ type: string; label: string; meta?: Record<string, unknown> }>;
      };
      const nodes = data.nodes ?? [];

      if (nodes.length > 0) {
        // Infer domain from node types
        const hasPerson = nodes.some(n => n.type === "Person");
        const hasConcept = nodes.some(n => n.type === "Concept");
        const hasDocument = nodes.some(n => n.type === "Document");
        const hasPreference = nodes.some(n => n.type === "Preference");

        const domain = hasConcept ? "knowledge"
          : hasPerson ? "people"
          : hasDocument ? "documents"
          : hasPreference ? "preferences"
          : "context";

        return {
          domain,
          relevantSkills: ["local.memory.search", "local.events.emit", "skills.run"],
          constraints: undefined,
        };
      }
    }
  } catch {
    // ont not running — graceful degradation to keyword fallback
  }

  // ── 3. Keyword fallback ────────────────────────────────────────────────────
  for (const [keyword, value] of Object.entries(KEYWORD_MAP)) {
    if (text.includes(keyword)) return { ...value };
  }

  return { ...DEFAULT_ONTOLOGY };
}

/**
 * Inject ont knowledge graph context into a system prompt string.
 * Returns empty string if ont is not running.
 */
export async function getOntContext(topic: string): Promise<string> {
  try {
    const res = await fetch(
      `${ONT_BASE}/api/context?q=${encodeURIComponent(topic.slice(0, 200))}`,
      {
        headers: { "X-Client-ID": ONT_CLIENT_ID },
        signal: AbortSignal.timeout(2000),
      },
    );
    if (!res.ok) return "";

    const data = await res.json() as { nodes?: Array<{ type: string; label: string; meta?: Record<string, unknown> }> };
    const nodes = (data.nodes ?? []).filter(n => n.type !== "WebResource");
    if (!nodes.length) return "";

    const lines = nodes.slice(0, 6).map(n => {
      const detail = (n.meta?.statement ?? n.meta?.summary ?? n.label) as string;
      return `• [${n.type}] ${String(detail).slice(0, 160)}`;
    });

    return `Relevant context from knowledge graph:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

/**
 * Report a completed Ronin session to ont (best-effort, non-blocking).
 */
export async function reportSessionToOnt(summary: string, topics?: string[]): Promise<void> {
  try {
    await fetch(`${ONT_BASE}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-ID": ONT_CLIENT_ID },
      body: JSON.stringify({
        type: "Session",
        label: summary.slice(0, 100),
        confidence: 0.9,
        episodic: true,
        tags: ["ronin", ...(topics ?? [])],
        meta: { summary, agentType: "ronin" },
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
}
