/**
 * Technique Storage & Registry
 *
 * Handles persistence of techniques in the database.
 * TechniqueRegistry is the high-level API; TechniqueStorage is the DB layer.
 */

import type { AgentAPI } from "../types/index.js";
import type {
  TechniqueDefinition,
  TechniqueRow,
  TechniqueListFilters,
} from "./types.js";
import { runTechniqueMigrations } from "./migrations.js";

// ── Storage ───────────────────────────────────────────────────────────────────

export class TechniqueStorage {
  constructor(private api: AgentAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runTechniqueMigrations(db);
  }

  async save(def: TechniqueDefinition, author?: string): Promise<void> {
    const now = Date.now();
    await this.api.db?.execute?.(
      `INSERT INTO techniques (
        name, version, description, category, tags, type, definition,
        input_schema, output_schema, created_at, updated_at, author, deprecated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        def.name,
        def.version,
        def.description,
        def.category ?? null,
        def.tags ? JSON.stringify(def.tags) : null,
        def.type,
        def.source,
        def.inputSchema ? JSON.stringify(def.inputSchema) : null,
        def.outputSchema ? JSON.stringify(def.outputSchema) : null,
        now,
        now,
        author ?? null,
      ],
    );

    // Store dependencies
    for (const dep of def.requires) {
      await this.api.db?.execute?.(
        `INSERT OR IGNORE INTO technique_dependencies (technique_name, depends_on_tool, depends_on_skill)
         VALUES (?, ?, ?)`,
        [
          def.name,
          dep.kind === "tool" ? dep.name : null,
          dep.kind === "skill" ? dep.name : null,
        ],
      );
    }
  }

  async update(name: string, fields: Partial<TechniqueDefinition & { author?: string }>): Promise<void> {
    const now = Date.now();
    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    if (fields.description !== undefined) { updates.push("description = ?"); params.push(fields.description); }
    if (fields.category !== undefined) { updates.push("category = ?"); params.push(fields.category ?? null); }
    if (fields.tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(fields.tags)); }
    if (fields.source !== undefined) { updates.push("definition = ?"); params.push(fields.source); }
    if (fields.inputSchema !== undefined) { updates.push("input_schema = ?"); params.push(JSON.stringify(fields.inputSchema)); }
    if (fields.outputSchema !== undefined) { updates.push("output_schema = ?"); params.push(JSON.stringify(fields.outputSchema)); }
    if ((fields as any).author !== undefined) { updates.push("author = ?"); params.push((fields as any).author); }

    params.push(name);
    await this.api.db?.execute?.(
      `UPDATE techniques SET ${updates.join(", ")} WHERE name = ?`,
      params,
    );
  }

  async getByName(name: string): Promise<TechniqueRow | null> {
    const rows = await this.api.db?.query<TechniqueRow>(
      `SELECT * FROM techniques WHERE name = ?`,
      [name],
    );
    return rows?.[0] ?? null;
  }

  async exists(name: string): Promise<boolean> {
    const row = await this.getByName(name);
    return row !== null;
  }

  async list(filters: TechniqueListFilters = {}): Promise<TechniqueRow[]> {
    let sql = "SELECT * FROM techniques WHERE 1=1";
    const params: unknown[] = [];

    if (filters.category) { sql += " AND category = ?"; params.push(filters.category); }
    if (filters.tag) { sql += " AND tags LIKE ?"; params.push(`%"${filters.tag}"%`); }
    if (filters.type) { sql += " AND type = ?"; params.push(filters.type); }
    if (filters.deprecated === true) { sql += " AND deprecated = 1"; }
    else if (filters.deprecated === false || filters.deprecated === undefined) {
      sql += " AND deprecated = 0";
    }

    const sortMap: Record<string, string> = { name: "name ASC", created: "created_at DESC", usage: "usage_count DESC" };
    sql += ` ORDER BY ${sortMap[filters.sort ?? "name"] ?? "name ASC"}`;

    if (filters.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

    return (await this.api.db?.query<TechniqueRow>(sql, params)) ?? [];
  }

  async delete(name: string): Promise<void> {
    await this.api.db?.execute?.(`DELETE FROM technique_dependencies WHERE technique_name = ?`, [name]);
    await this.api.db?.execute?.(`DELETE FROM techniques WHERE name = ?`, [name]);
  }

  async deprecate(name: string, replacement?: string): Promise<void> {
    await this.api.db?.execute?.(
      `UPDATE techniques SET deprecated = 1, replacement_technique = ?, updated_at = ? WHERE name = ?`,
      [replacement ?? null, Date.now(), name],
    );
  }

  async incrementUsage(name: string, durationMs: number): Promise<void> {
    await this.api.db?.execute?.(
      `UPDATE techniques SET
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

  async getDependencies(name: string): Promise<Array<{ kind: "skill" | "tool"; dep: string }>> {
    const rows = await this.api.db?.query<{
      depends_on_tool: string | null;
      depends_on_skill: string | null;
    }>(
      `SELECT depends_on_tool, depends_on_skill FROM technique_dependencies WHERE technique_name = ?`,
      [name],
    );
    return (rows ?? []).map((r) =>
      r.depends_on_tool
        ? { kind: "tool" as const, dep: r.depends_on_tool }
        : { kind: "skill" as const, dep: r.depends_on_skill! },
    );
  }

  /** Find all katas that require a given technique */
  async getUsedByKatas(techniqueName: string): Promise<string[]> {
    const rows = await this.api.db?.query<{ kata_name: string }>(
      `SELECT kata_name FROM kata_dependencies WHERE depends_on_technique = ?`,
      [techniqueName],
    );
    return (rows ?? []).map((r) => r.kata_name);
  }
}

// ── Registry (high-level API) ─────────────────────────────────────────────────

export class TechniqueRegistry {
  private storage: TechniqueStorage;

  constructor(private api: AgentAPI) {
    this.storage = new TechniqueStorage(api);
    this.storage.init().catch((e: Error) => console.error("[technique-registry] DB init failed:", e.message));
  }

  /**
   * Register a technique from a parsed definition.
   * Throws if a technique with the same name already exists (non-deprecated).
   */
  async register(def: TechniqueDefinition, author?: string): Promise<void> {
    const existing = await this.storage.getByName(def.name);
    if (existing && !existing.deprecated) {
      throw new Error(
        `Technique "${def.name}" already registered. Use update or deprecate it first.`,
      );
    }
    if (existing) {
      // Re-registering over a deprecated technique — delete old and re-insert
      await this.storage.delete(def.name);
    }
    await this.storage.save(def, author);
  }

  async get(name: string): Promise<TechniqueRow | null> {
    return this.storage.getByName(name);
  }

  async list(filters?: TechniqueListFilters): Promise<TechniqueRow[]> {
    return this.storage.list(filters);
  }

  async deprecate(name: string, replacement?: string, reason?: string): Promise<void> {
    const existing = await this.storage.getByName(name);
    if (!existing) throw new Error(`Technique not found: ${name}`);
    await this.storage.deprecate(name, replacement);
  }

  async delete(name: string): Promise<void> {
    await this.storage.delete(name);
  }

  async getUsedBy(techniqueName: string): Promise<string[]> {
    return this.storage.getUsedByKatas(techniqueName);
  }

  async getDependencies(name: string): Promise<Array<{ kind: "skill" | "tool"; dep: string }>> {
    return this.storage.getDependencies(name);
  }

  async recordExecution(name: string, durationMs: number): Promise<void> {
    await this.storage.incrementUsage(name, durationMs);
  }
}
