/**
 * Ingest Ronin Script into the ontology (nodes + edges).
 * Export ontology subgraph to Ronin Script for aggregation.
 */

import type { AgentAPI } from "../types/index.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";
import type { ParsedRoninScript, ParsedEntity, Relationship } from "./types.js";

function sanitizeId(s: string): string {
  return s.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
}

function entityToNodeId(entity: ParsedEntity, index: number): string {
  const first = entity.values[0] ?? "entity";
  const second = entity.values[1];
  const base = second ? `${entity.type}-${sanitizeId(first)}-${sanitizeId(second)}` : `${entity.type}-${sanitizeId(first)}`;
  return base ? `${base}-${index}` : `${entity.type}-${index}`;
}

/**
 * Ingest a Ronin Script document into the ontology: entities become nodes, relationships become edges.
 * Resolves subject/object to node ids by matching entity names (first value or first two values).
 */
export async function ingestRoninScriptToOntology(
  api: AgentAPI,
  script: string | ParsedRoninScript
): Promise<void> {
  if (!api.ontology) return;
  const ast = typeof script === "string" ? parse(script) : script;
  const nameToId: Record<string, string> = {};

  for (let i = 0; i < ast.entities.length; i++) {
    const entity = ast.entities[i];
    const id = entityToNodeId(entity, i);
    const name = entity.values[0] ?? id;
    const summary = entity.values.slice(0, 6).join(" ").slice(0, 500) || null;
    nameToId[name] = id;
    if (entity.values[1]) {
      const name2 = entity.values.slice(0, 2).join(" ");
      nameToId[name2] = id;
    }
    await api.ontology.setNode({
      id,
      type: entity.type,
      name: name || null,
      summary,
      domain: "ronin_script",
    });
  }

  if (ast.relationships?.length) {
    for (let i = 0; i < ast.relationships.length; i++) {
      const r = ast.relationships[i];
      const fromId = nameToId[r.subject] ?? (sanitizeId(r.subject) || `node-${r.subject}`);
      const toId = nameToId[r.object] ?? (sanitizeId(r.object) || `node-${r.object}`);
      const edgeId = `edge-${fromId}-${r.relation}-${toId}-${i}`;
      await api.ontology.setEdge({
        id: edgeId,
        from_id: fromId,
        to_id: toId,
        relation: r.relation,
      });
    }
  }
}

export interface ExportOntologyOptions {
  type?: string;
  limit?: number;
}

/**
 * Export a subset of the ontology to Ronin Script (entities + relationships).
 */
export async function exportOntologyToRoninScript(
  api: AgentAPI,
  options: ExportOntologyOptions = {}
): Promise<string> {
  if (!api.ontology?.search) return "";
  const limit = Math.min(options.limit ?? 50, 100);
  const nodes = await api.ontology.search({
    type: options.type,
    limit,
  });
  if (nodes.length === 0) return "";

  const entities: ParsedEntity[] = nodes.map((n) => ({
    type: n.type,
    values: [n.name ?? n.id, n.summary ?? ""].filter(Boolean),
  }));
  const relationships: Relationship[] = [];
  // Edges would require ontology.related() per node; for simplicity we only export nodes as entities
  const ast: ParsedRoninScript = { entities, relationships: relationships.length ? relationships : undefined };
  return serialize(ast);
}
