/**
 * Kata Storage V2 — enhanced schema with category, tags, author, deprecated, usage stats
 * Works alongside the existing kata_definitions table.
 */

import type { AgentAPI } from "../types/index.js";
import type { KataRowV2, KataListFilters } from "../techniques/types.js";
import { runTechniqueMigrations } from "../techniques/migrations.js";

export class KataStorageV2 {
  constructor(private api: AgentAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runTechniqueMigrations(db);
  }

  async save(opts: {
    name: string;
    version?: string;
    description: string;
    category?: string;
    tags?: string[];
    definition: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    author?: string;
  }): Promise<void> {
    const now = Date.now();
    await this.api.db?.execute?.(
      `INSERT OR REPLACE INTO katas (
        name, version, description, category, tags, definition,
        input_schema, output_schema, created_at, updated_at, author, deprecated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        opts.name,
        opts.version ?? "v1",
        opts.description,
        opts.category ?? null,
        opts.tags ? JSON.stringify(opts.tags) : null,
        opts.definition,
        opts.inputSchema ? JSON.stringify(opts.inputSchema) : null,
        opts.outputSchema ? JSON.stringify(opts.outputSchema) : null,
        now,
        now,
        opts.author ?? null,
      ],
    );
  }

  async getByName(name: string): Promise<KataRowV2 | null> {
    const rows = await this.api.db?.query<KataRowV2>(
      `SELECT * FROM katas WHERE name = ?`,
      [name],
    );
    return rows?.[0] ?? null;
  }

  async list(filters: KataListFilters = {}): Promise<KataRowV2[]> {
    let sql = "SELECT * FROM katas WHERE 1=1";
    const params: unknown[] = [];

    if (filters.category) { sql += " AND category = ?"; params.push(filters.category); }
    if (filters.tag) { sql += " AND tags LIKE ?"; params.push(`%"${filters.tag}"%`); }
    if (filters.deprecated === true) { sql += " AND deprecated = 1"; }
    else if (filters.deprecated === false || filters.deprecated === undefined) {
      sql += " AND deprecated = 0";
    }

    const sortMap: Record<string, string> = { name: "name ASC", created: "created_at DESC", usage: "usage_count DESC" };
    sql += ` ORDER BY ${sortMap[filters.sort ?? "name"] ?? "name ASC"}`;

    if (filters.limit) { sql += " LIMIT ?"; params.push(filters.limit); }
    return (await this.api.db?.query<KataRowV2>(sql, params)) ?? [];
  }

  async deprecate(name: string, replacement?: string): Promise<void> {
    await this.api.db?.execute?.(
      `UPDATE katas SET deprecated = 1, replacement_kata = ?, updated_at = ? WHERE name = ?`,
      [replacement ?? null, Date.now(), name],
    );
  }

  async delete(name: string): Promise<void> {
    await this.api.db?.execute?.(`DELETE FROM kata_dependencies WHERE kata_name = ?`, [name]);
    await this.api.db?.execute?.(`DELETE FROM katas WHERE name = ?`, [name]);
  }

  async incrementUsage(name: string, durationMs: number): Promise<void> {
    await this.api.db?.execute?.(
      `UPDATE katas SET
        usage_count = usage_count + 1,
        last_used_at = ?,
        average_duration = CASE
          WHEN average_duration IS NULL THEN ?
          ELSE (average_duration * usage_count + ?) / (usage_count + 1)
        END
      WHERE name = ?`,
      [Date.now(), durationMs, durationMs, name],
    );
  }
}
