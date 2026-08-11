/**
 * Graph store — persists the single latest derived graph snapshot.
 * graph-keeper is the sole writer (state-authority duty rule, ARCHITECTURE.md §6).
 */

import type { DutyAPI } from "../types/index.js";
import { runEngineMigrations } from "../database/migrations.js";
import type { DerivedGraph } from "./types.js";

export class GraphStore {
  constructor(private api: DutyAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runEngineMigrations(db);
  }

  async save(graph: DerivedGraph): Promise<void> {
    await this.api.db?.execute?.(
      `INSERT INTO graph_snapshots (id, graph_json, derived_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET graph_json = excluded.graph_json, derived_at = excluded.derived_at`,
      [JSON.stringify(graph), graph.derivedAt]
    );
  }

  async load(): Promise<DerivedGraph | null> {
    const rows = await this.api.db?.query<{ graph_json: string; derived_at: number }>(
      `SELECT graph_json, derived_at FROM graph_snapshots WHERE id = 1`
    );
    const row = rows?.[0];
    if (!row) return null;
    try {
      return JSON.parse(row.graph_json) as DerivedGraph;
    } catch {
      return null;
    }
  }
}
