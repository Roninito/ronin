/**
 * Task Storage V2 — enhanced schema with task_id, source tracking, and phase-level results
 */

import type { AgentAPI } from "../types/index.js";
import type { TaskV2Row, TaskPhaseRow, TaskV2Status, TaskListFilters, PhaseStatus } from "../techniques/types.js";
import { runTechniqueMigrations } from "../techniques/migrations.js";

let _taskCounter = 0;

function generateTaskId(): string {
  _taskCounter++;
  const rand = Math.random().toString(36).slice(2, 7);
  return `tsk_${rand}${_taskCounter}`;
}

export class TaskStorageV2 {
  constructor(private api: AgentAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runTechniqueMigrations(db);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async createTask(opts: {
    sourceContract?: string;
    sourceKata: string;
    sourceKataVersion?: string;
  }): Promise<TaskV2Row> {
    const now = Date.now();
    const taskId = generateTaskId();
    const row: Partial<TaskV2Row> = {
      task_id: taskId,
      source_contract: opts.sourceContract ?? null,
      source_kata: opts.sourceKata,
      source_kata_version: opts.sourceKataVersion ?? "v1",
      status: "pending",
      created_at: now,
      updated_at: now,
    };

    await this.api.db?.execute?.(
      `INSERT INTO tasks_v2 (task_id, source_contract, source_kata, source_kata_version,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      [row.task_id, row.source_contract, row.source_kata, row.source_kata_version, now, now],
    );

    return row as TaskV2Row;
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskV2Status,
    extras?: {
      output?: unknown;
      error?: string;
      errorPhase?: string;
      startedAt?: number;
      completedAt?: number;
      duration?: number;
    },
  ): Promise<void> {
    const sets: string[] = ["status = ?", "updated_at = ?"];
    const params: unknown[] = [status, Date.now()];

    if (extras?.output !== undefined) { sets.push("output = ?"); params.push(JSON.stringify(extras.output)); }
    if (extras?.error !== undefined) { sets.push("error = ?"); params.push(extras.error); }
    if (extras?.errorPhase !== undefined) { sets.push("error_phase = ?"); params.push(extras.errorPhase); }
    if (extras?.startedAt !== undefined) { sets.push("started_at = ?"); params.push(extras.startedAt); }
    if (extras?.completedAt !== undefined) { sets.push("completed_at = ?"); params.push(extras.completedAt); }
    if (extras?.duration !== undefined) { sets.push("duration = ?"); params.push(extras.duration); }

    params.push(taskId);
    await this.api.db?.execute?.(
      `UPDATE tasks_v2 SET ${sets.join(", ")} WHERE task_id = ?`,
      params,
    );
  }

  async getTask(taskId: string): Promise<TaskV2Row | null> {
    const rows = await this.api.db?.query<TaskV2Row>(
      `SELECT * FROM tasks_v2 WHERE task_id = ?`,
      [taskId],
    );
    return rows?.[0] ?? null;
  }

  async listTasks(filters: TaskListFilters = {}): Promise<TaskV2Row[]> {
    let sql = "SELECT * FROM tasks_v2 WHERE 1=1";
    const params: unknown[] = [];

    if (filters.status) { sql += " AND status = ?"; params.push(filters.status); }
    if (filters.kata) { sql += " AND source_kata = ?"; params.push(filters.kata); }
    if (filters.contract) { sql += " AND source_contract = ?"; params.push(filters.contract); }

    sql += " ORDER BY created_at DESC";
    if (filters.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

    return (await this.api.db?.query<TaskV2Row>(sql, params)) ?? [];
  }

  // ── Task Phases ────────────────────────────────────────────────────────────

  async startPhase(taskId: string, phaseName: string, phaseType?: string, opts?: {
    techniqueName?: string;
    skillName?: string;
    toolName?: string;
  }): Promise<void> {
    await this.api.db?.execute?.(
      `INSERT INTO task_phases (task_id, phase_name, phase_type, status, started_at,
        technique_name, skill_name, tool_name)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      [
        taskId,
        phaseName,
        phaseType ?? null,
        Date.now(),
        opts?.techniqueName ?? null,
        opts?.skillName ?? null,
        opts?.toolName ?? null,
      ],
    );
  }

  async completePhase(taskId: string, phaseName: string, output?: unknown): Promise<void> {
    const rows = await this.api.db?.query<{ started_at: number | null }>(
      `SELECT started_at FROM task_phases WHERE task_id = ? AND phase_name = ? ORDER BY id DESC LIMIT 1`,
      [taskId, phaseName],
    );
    const startedAt = rows?.[0]?.started_at;
    const duration = startedAt ? Date.now() - startedAt : null;

    await this.api.db?.execute?.(
      `UPDATE task_phases SET status = 'completed', completed_at = ?, duration = ?, output = ?
       WHERE task_id = ? AND phase_name = ?`,
      [Date.now(), duration, output !== undefined ? JSON.stringify(output) : null, taskId, phaseName],
    );
  }

  async failPhase(taskId: string, phaseName: string, error: string): Promise<void> {
    const rows = await this.api.db?.query<{ started_at: number | null }>(
      `SELECT started_at FROM task_phases WHERE task_id = ? AND phase_name = ? ORDER BY id DESC LIMIT 1`,
      [taskId, phaseName],
    );
    const startedAt = rows?.[0]?.started_at;
    const duration = startedAt ? Date.now() - startedAt : null;

    await this.api.db?.execute?.(
      `UPDATE task_phases SET status = 'failed', completed_at = ?, duration = ?, error = ?
       WHERE task_id = ? AND phase_name = ?`,
      [Date.now(), duration, error, taskId, phaseName],
    );
  }

  async getPhases(taskId: string): Promise<TaskPhaseRow[]> {
    return (await this.api.db?.query<TaskPhaseRow>(
      `SELECT * FROM task_phases WHERE task_id = ? ORDER BY id ASC`,
      [taskId],
    )) ?? [];
  }
}
