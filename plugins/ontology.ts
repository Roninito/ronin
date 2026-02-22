/**
 * Ontology plugin: graph service over ronin.db.
 * Provides nodes and edges for tasks, skills, pipelines, failures, etc.
 * Read methods are memoized with use-count decay; writes invalidate cache.
 */

import type { Plugin } from "../src/plugins/base.js";
import { Database } from "bun:sqlite";
import { getDefaultCache } from "../src/utils/cache.js";

const DEFAULT_DB_PATH = "ronin.db";
const MAX_DEPTH = 3;
const DEFAULT_LIMIT = 10;
const CACHE_MAX_USES = 5;
const CACHE_MAX_AGE_MS = 30_000;
const CACHE_PREFIX = "ontology:";

let db: Database | null = null;
let dbPath: string = DEFAULT_DB_PATH;

function getDb(): Database {
  if (!db) {
    db = new Database(dbPath);
    ensureSchema(db);
  }
  return db;
}

function ensureSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS ontology_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      summary TEXT,
      metadata TEXT,
      domain TEXT DEFAULT 'system',
      confidence REAL DEFAULT 1.0,
      sensitivity TEXT DEFAULT 'internal',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS ontology_edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      metadata TEXT,
      confidence REAL DEFAULT 1.0,
      created_at INTEGER NOT NULL
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onto_nodes_type ON ontology_nodes(type)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onto_nodes_domain ON ontology_nodes(domain)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onto_edges_from ON ontology_edges(from_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onto_edges_to ON ontology_edges(to_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onto_edges_relation ON ontology_edges(relation)`);
}

function invalidateOntologyCache(): void {
  getDefaultCache().invalidatePattern(CACHE_PREFIX);
}

export interface OntologyNode {
  id: string;
  type: string;
  name: string | null;
  summary: string | null;
  metadata: string | null;
  domain: string;
  confidence: number;
  sensitivity: string;
  created_at: number;
  updated_at: number;
}

export interface OntologyEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  metadata: string | null;
  confidence: number;
  created_at: number;
}

function rowToNode(row: Record<string, unknown>): OntologyNode {
  return {
    id: String(row.id),
    type: String(row.type),
    name: row.name != null ? String(row.name) : null,
    summary: row.summary != null ? String(row.summary) : null,
    metadata: row.metadata != null ? String(row.metadata) : null,
    domain: String(row.domain ?? "system"),
    confidence: Number(row.confidence ?? 1),
    sensitivity: String(row.sensitivity ?? "internal"),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

function rowToEdge(row: Record<string, unknown>): OntologyEdge {
  return {
    id: String(row.id),
    from_id: String(row.from_id),
    to_id: String(row.to_id),
    relation: String(row.relation),
    metadata: row.metadata != null ? String(row.metadata) : null,
    confidence: Number(row.confidence ?? 1),
    created_at: Number(row.created_at),
  };
}

function hashParams(params: Record<string, unknown>): string {
  return JSON.stringify(params, Object.keys(params).sort());
}

const ontologyPlugin: Plugin = {
  name: "ontology",
  description: "Knowledge graph over ronin.db: nodes (tasks, skills, pipelines, etc.) and edges. Read methods are bounded and cached.",
  methods: {
    init: async (path?: string): Promise<{ success: boolean; dbPath: string }> => {
      if (path && typeof path === "string") {
        dbPath = path;
      }
      if (db) {
        db.close();
        db = null;
      }
      getDb();
      return { success: true, dbPath };
    },

    setNode: async (node: {
      id: string;
      type: string;
      name?: string;
      summary?: string;
      metadata?: string;
      domain?: string;
      confidence?: number;
      sensitivity?: string;
    }): Promise<void> => {
      const database = getDb();
      const now = Date.now();
      const n = node as Record<string, unknown>;
      const id = String(n.id);
      const meta = typeof n.metadata === "string" ? n.metadata : (n.metadata ? JSON.stringify(n.metadata) : null);
      const typeVal = n.type ?? "Event";
      const nameVal = n.name ?? null;
      const summaryVal = n.summary ?? null;
      const domainVal = n.domain ?? "system";
      const confidenceVal = Number(n.confidence ?? 1);
      const sensitivityVal = n.sensitivity ?? "internal";
      try {
        database.run(
          `INSERT INTO ontology_nodes (id, type, name, summary, metadata, domain, confidence, sensitivity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             type=excluded.type,
             name=excluded.name,
             summary=excluded.summary,
             metadata=excluded.metadata,
             domain=excluded.domain,
             confidence=excluded.confidence,
             sensitivity=excluded.sensitivity,
             updated_at=excluded.updated_at`,
          [id, typeVal, nameVal, summaryVal, meta, domainVal, confidenceVal, sensitivityVal, now, now]
        );
      } catch (err: unknown) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
        if (code === "SQLITE_CONSTRAINT" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
          database.run(
            `UPDATE ontology_nodes SET type=?, name=?, summary=?, metadata=?, domain=?, confidence=?, sensitivity=?, updated_at=? WHERE id=?`,
            [typeVal, nameVal, summaryVal, meta, domainVal, confidenceVal, sensitivityVal, now, id]
          );
        } else {
          throw err;
        }
      }
      invalidateOntologyCache();
    },

    setEdge: async (edge: {
      id: string;
      from_id: string;
      to_id: string;
      relation: string;
      metadata?: string;
      confidence?: number;
    }): Promise<void> => {
      const database = getDb();
      const now = Date.now();
      const e = edge as Record<string, unknown>;
      database.run(
        `INSERT OR REPLACE INTO ontology_edges (id, from_id, to_id, relation, metadata, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.from_id,
          e.to_id,
          e.relation,
          typeof e.metadata === "string" ? e.metadata : (e.metadata ? JSON.stringify(e.metadata) : null),
          e.confidence ?? 1,
          now,
        ]
      );
      invalidateOntologyCache();
    },

    removeNode: async (id: string): Promise<void> => {
      const database = getDb();
      database.run("DELETE FROM ontology_edges WHERE from_id = ? OR to_id = ?", [id, id]);
      database.run("DELETE FROM ontology_nodes WHERE id = ?", [id]);
      invalidateOntologyCache();
    },

    removeEdge: async (id: string): Promise<void> => {
      getDb().run("DELETE FROM ontology_edges WHERE id = ?", [id]);
      invalidateOntologyCache();
    },

    lookup: async (id: string): Promise<OntologyNode | null> => {
      const key = `${CACHE_PREFIX}lookup:${id}`;
      const cache = getDefaultCache();
      const cached = cache.get<OntologyNode | null>(key);
      if (cached !== undefined) return cached;

      const rows = getDb().query("SELECT * FROM ontology_nodes WHERE id = ?", [id]).all() as Record<string, unknown>[];
      const node = rows.length ? rowToNode(rows[0]) : null;
      cache.set(key, node, { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
      return node;
    },

    search: async (params: {
      type?: string;
      nameLike?: string;
      domain?: string;
      limit?: number;
    }): Promise<OntologyNode[]> => {
      const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 50);
      const key = `${CACHE_PREFIX}search:${hashParams({ ...params, limit })}`;
      const cache = getDefaultCache();
      const cached = cache.get<OntologyNode[]>(key);
      if (cached !== undefined) return cached;

      try {
        let sql = "SELECT * FROM ontology_nodes WHERE 1=1";
        const args: unknown[] = [];
        if (params.type) {
          sql += " AND type = ?";
          args.push(String(params.type));
        }
        if (params.nameLike) {
          sql += " AND (name LIKE ? OR id LIKE ?)";
          const like = `%${String(params.nameLike)}%`;
          args.push(like, like);
        }
        if (params.domain) {
          sql += " AND domain = ?";
          args.push(String(params.domain));
        }
        sql += " ORDER BY CAST(updated_at AS INTEGER) DESC LIMIT ?";
        args.push(limit | 0);

        const rows = getDb().query(sql, args).all() as Record<string, unknown>[];
        const result = rows.map(rowToNode);
        cache.set(key, result, { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
        return result;
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
        if (code === "SQLITE_MISMATCH" || code === "SQLITE_ERROR") {
          cache.set(key, [], { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
          return [];
        }
        throw err;
      }
    },

    related: async (params: {
      nodeId: string;
      relation?: string;
      direction?: "out" | "in" | "both";
      depth?: number;
      limit?: number;
    }): Promise<Array<{ node: OntologyNode; edges: OntologyEdge[] }>> => {
      const depth = Math.min(params.depth ?? 1, MAX_DEPTH);
      const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 50);
      const key = `${CACHE_PREFIX}related:${params.nodeId}:${params.relation ?? ""}:${params.direction ?? "out"}:${depth}:${limit}`;
      const cache = getDefaultCache();
      const cached = cache.get<Array<{ node: OntologyNode; edges: OntologyEdge[] }>>(key);
      if (cached !== undefined) return cached;

      const database = getDb();
      const result: Array<{ node: OntologyNode; edges: OntologyEdge[] }> = [];
      const seen = new Set<string>();
      let currentIds = [params.nodeId];
      const dir = params.direction ?? "out";

      for (let d = 0; d < depth && result.length < limit; d++) {
        const nextIds: string[] = [];
        for (const fromId of currentIds) {
          let edgeSql = "SELECT * FROM ontology_edges WHERE ";
          if (dir === "out") edgeSql += "from_id = ?";
          else if (dir === "in") edgeSql += "to_id = ?";
          else edgeSql += "(from_id = ? OR to_id = ?)";
          const edgeArgs: unknown[] = dir === "both" ? [fromId, fromId] : [fromId];
          if (params.relation) {
            edgeSql += " AND relation = ?";
            edgeArgs.push(params.relation);
          }
          const edgeRows = database.query(edgeSql, edgeArgs).all() as Record<string, unknown>[];
          for (const er of edgeRows) {
            const toId = String(er.to_id === fromId ? er.from_id : er.to_id);
            if (seen.has(toId)) continue;
            seen.add(toId);
            nextIds.push(toId);
            const nodeRows = database.query("SELECT * FROM ontology_nodes WHERE id = ?", [toId]).all() as Record<string, unknown>[];
            if (nodeRows.length) {
              result.push({
                node: rowToNode(nodeRows[0]),
                edges: edgeRows.map(rowToEdge).filter((e) => e.from_id === fromId || e.to_id === fromId),
              });
              if (result.length >= limit) break;
            }
          }
        }
        currentIds = nextIds;
        if (currentIds.length === 0) break;
      }

      cache.set(key, result, { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
      return result;
    },

    context: async (params: { taskId: string; depth?: number; limit?: number }): Promise<{
      task: OntologyNode | null;
      skills: OntologyNode[];
      failures: OntologyNode[];
      pipelines: OntologyNode[];
      conversations: OntologyNode[];
    }> => {
      const depth = Math.min(params.depth ?? 2, MAX_DEPTH);
      const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 20);
      const key = `${CACHE_PREFIX}context:${params.taskId}:${depth}:${limit}`;
      const cache = getDefaultCache();
      const cached = cache.get<{
        task: OntologyNode | null;
        skills: OntologyNode[];
        failures: OntologyNode[];
        pipelines: OntologyNode[];
        conversations: OntologyNode[];
      }>(key);
      if (cached !== undefined) return cached;

      const taskNode = (await ontologyPlugin.methods.lookup(`Task-${params.taskId}`)) as OntologyNode | null;
      if (!taskNode) {
        const empty = { task: null, skills: [], failures: [], pipelines: [], conversations: [] };
        cache.set(key, empty, { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
        return empty;
      }

      const related = await ontologyPlugin.methods.related({
        nodeId: taskNode.id,
        depth,
        limit,
      }) as Array<{ node: OntologyNode; edges: OntologyEdge[] }>;

      const skills: OntologyNode[] = [];
      const failures: OntologyNode[] = [];
      const pipelines: OntologyNode[] = [];
      const conversations: OntologyNode[] = [];
      for (const { node } of related) {
        if (node.type === "Skill") skills.push(node);
        else if (node.type === "Failure") failures.push(node);
        else if (node.type === "Pipeline") pipelines.push(node);
        else if (node.type === "Conversation") conversations.push(node);
      }

      const result = {
        task: taskNode,
        skills: skills.slice(0, limit),
        failures: failures.slice(0, limit),
        pipelines: pipelines.slice(0, limit),
        conversations: conversations.slice(0, limit),
      };
      cache.set(key, result, { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
      return result;
    },

    history: async (params: {
      type?: string;
      nameLike?: string;
      successfulOnly?: boolean;
      limit?: number;
    }): Promise<OntologyNode[]> => {
      const limit = Math.min(Number(params.limit) || DEFAULT_LIMIT, 20) | 0;
      const key = `${CACHE_PREFIX}history:${hashParams({ ...params, limit })}`;
      const cache = getDefaultCache();
      const cached = cache.get<OntologyNode[]>(key);
      if (cached !== undefined) return cached;

      try {
        let sql =
          "SELECT * FROM ontology_nodes WHERE CAST(type AS TEXT) = ? AND typeof(updated_at) IN ('integer','real')";
        const args: unknown[] = [String(params.type ?? "Pipeline")];
        if (params.nameLike) {
          sql += " AND (name LIKE ? OR summary LIKE ? OR id LIKE ?)";
          const like = `%${String(params.nameLike)}%`;
          args.push(like, like, like);
        }
        sql += " ORDER BY CAST(updated_at AS INTEGER) DESC LIMIT ?";
        args.push(limit);

        const rows = getDb().query(sql, args).all() as Record<string, unknown>[];
        const result = rows.map(rowToNode);
        cache.set(key, result, { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
        return result;
      } catch (err: unknown) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
        if (code === "SQLITE_MISMATCH") {
          cache.set(key, [], { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
          return [];
        }
        throw err;
      }
    },

    stats: async (): Promise<{ nodes: Record<string, number>; edges: Record<string, number> }> => {
      const key = `${CACHE_PREFIX}stats`;
      const cache = getDefaultCache();
      const cached = cache.get<{ nodes: Record<string, number>; edges: Record<string, number> }>(key);
      if (cached !== undefined) return cached;

      const database = getDb();
      const nodeRows = database.query<{ type: string; count: number }>("SELECT type, COUNT(*) as count FROM ontology_nodes GROUP BY type").all();
      const edgeRows = database.query<{ relation: string; count: number }>("SELECT relation, COUNT(*) as count FROM ontology_edges GROUP BY relation").all();
      const nodes: Record<string, number> = {};
      const edges: Record<string, number> = {};
      for (const r of nodeRows) nodes[r.type] = r.count;
      for (const r of edgeRows) edges[r.relation] = r.count;
      const result = { nodes, edges };
      cache.set(key, result, { maxUses: CACHE_MAX_USES, maxAgeMs: CACHE_MAX_AGE_MS });
      return result;
    },
  },
};

export default ontologyPlugin;
