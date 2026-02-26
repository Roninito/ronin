/**
 * Contract Storage V2 — enhanced schema with params, on_failure, execution tracking
 */

import type { AgentAPI } from "../types/index.js";
import type {
  ContractV2Row,
  ContractV2Definition,
  ContractListFilters,
  TriggerType,
} from "../techniques/types.js";
import { runTechniqueMigrations } from "../techniques/migrations.js";

interface HistoryFilter {
  limit?: number;
  status?: string;
  since?: number;
  until?: number;
}

interface TaskHistoryRow {
  task_id: string;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  duration: number | null;
  error: string | null;
}

export class ContractStorageV2 {
  constructor(private api: AgentAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runTechniqueMigrations(db);
  }

  async create(def: ContractV2Definition): Promise<void> {
    const now = Date.now();
    await this.api.db?.execute?.(
      `INSERT INTO contracts_v2 (
        name, version, description, target_kata, target_kata_version,
        parameters, trigger_type, trigger_config,
        on_failure_action, on_failure_config, enabled,
        created_at, updated_at, author
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        def.name,
        def.version ?? "v1",
        def.description ?? null,
        def.targetKata,
        def.targetKataVersion ?? "v1",
        Object.keys(def.parameters ?? {}).length > 0 ? JSON.stringify(def.parameters) : null,
        def.triggerType,
        JSON.stringify(def.triggerConfig),
        def.onFailureAction ?? "ignore",
        def.onFailureConfig && Object.keys(def.onFailureConfig).length > 0
          ? JSON.stringify(def.onFailureConfig)
          : null,
        def.enabled ? 1 : 0,
        now,
        now,
        def.author ?? null,
      ],
    );
  }

  async update(name: string, fields: Partial<Record<string, unknown>>): Promise<void> {
    const now = Date.now();
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    const allowed = ["description", "target_kata", "target_kata_version", "parameters",
      "trigger_type", "trigger_config", "on_failure_action", "on_failure_config",
      "enabled", "author", "next_scheduled_at"] as const;

    for (const key of allowed) {
      if (key in fields && fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }

    params.push(name);
    await this.api.db?.execute?.(
      `UPDATE contracts_v2 SET ${sets.join(", ")} WHERE name = ?`,
      params,
    );
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await this.api.db?.execute?.(
      `UPDATE contracts_v2 SET enabled = ?, updated_at = ? WHERE name = ?`,
      [enabled ? 1 : 0, Date.now(), name],
    );
  }

  async getByName(name: string): Promise<ContractV2Row | null> {
    const rows = await this.api.db?.query<ContractV2Row>(
      `SELECT * FROM contracts_v2 WHERE name = ?`,
      [name],
    );
    return rows?.[0] ?? null;
  }

  async list(filters: ContractListFilters = {}): Promise<ContractV2Row[]> {
    let sql = "SELECT * FROM contracts_v2 WHERE 1=1";
    const params: unknown[] = [];

    if (filters.enabled === true) { sql += " AND enabled = 1"; }
    else if (filters.enabled === false) { sql += " AND enabled = 0"; }
    if (filters.triggerType) { sql += " AND trigger_type = ?"; params.push(filters.triggerType); }
    if (filters.kata) { sql += " AND target_kata = ?"; params.push(filters.kata); }

    const sortMap: Record<string, string> = {
      name: "name ASC",
      created: "created_at DESC",
      next_run: "next_scheduled_at ASC",
    };
    sql += ` ORDER BY ${sortMap[filters.sort ?? "name"] ?? "name ASC"}`;

    if (filters.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

    return (await this.api.db?.query<ContractV2Row>(sql, params)) ?? [];
  }

  async delete(name: string): Promise<void> {
    await this.api.db?.execute?.(`DELETE FROM contracts_v2 WHERE name = ?`, [name]);
  }

  async recordExecution(name: string, taskId: string): Promise<void> {
    await this.api.db?.execute?.(
      `UPDATE contracts_v2 SET
        execution_count = execution_count + 1,
        last_executed_at = ?,
        updated_at = ?
      WHERE name = ?`,
      [Date.now(), Date.now(), name],
    );
  }

  async getHistory(name: string, filters: HistoryFilter = {}): Promise<TaskHistoryRow[]> {
    let sql = `SELECT task_id, status, started_at, completed_at, duration, error
               FROM tasks_v2 WHERE source_contract = ?`;
    const params: unknown[] = [name];

    if (filters.status) { sql += " AND status = ?"; params.push(filters.status); }
    if (filters.since) { sql += " AND started_at >= ?"; params.push(filters.since); }
    if (filters.until) { sql += " AND started_at <= ?"; params.push(filters.until); }
    sql += " ORDER BY created_at DESC";
    if (filters.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

    return (await this.api.db?.query<TaskHistoryRow>(sql, params)) ?? [];
  }

  async getStats(): Promise<{
    total: number;
    enabled: number;
    disabled: number;
    topByCount: Array<{ name: string; execution_count: number }>;
  }> {
    const allRows = await this.api.db?.query<{ name: string; enabled: number; execution_count: number }>(
      `SELECT name, enabled, execution_count FROM contracts_v2`,
    ) ?? [];

    const total = allRows.length;
    const enabled = allRows.filter((r) => r.enabled).length;
    const topByCount = [...allRows]
      .sort((a, b) => b.execution_count - a.execution_count)
      .slice(0, 5);

    return { total, enabled, disabled: total - enabled, topByCount };
  }
}
