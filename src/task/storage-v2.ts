/**
 * Task Storage V2 — enhanced schema with task_id, source tracking, and phase-level results
 */

import type { DutyAPI } from "../types/index.js";
import type { TaskV2Row, TaskPhaseRow, TaskV2Status, TaskListFilters, PhaseStatus } from "../types/shared.js";
import { runEngineMigrations } from "../database/migrations.js";

let _taskCounter = 0;

function generateTaskId(): string {
  _taskCounter++;
  const rand = Math.random().toString(36).slice(2, 7);
  return `tsk_${rand}${_taskCounter}`;
}

export class TaskStorageV2 {
  constructor(private api: DutyAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runEngineMigrations(db);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async createTask(opts: {
    sourceContract?: string;
    /** Vestigial: kept only to satisfy the NOT NULL `source_kata`/`source_kata_version`
     *  columns now that Kata itself is gone — populate with the contract name / "v1". */
    sourceKata: string;
    sourceKataVersion?: string;
    currentPhase?: string;
  }): Promise<TaskV2Row> {
    const now = Date.now();
    const taskId = generateTaskId();
    const row: Partial<TaskV2Row> = {
      task_id: taskId,
      source_contract: opts.sourceContract ?? null,
      source_kata: opts.sourceKata,
      source_kata_version: opts.sourceKataVersion ?? "v1",
      status: "pending",
      current_phase: opts.currentPhase ?? null,
      created_at: now,
      updated_at: now,
    };

    await this.api.db?.execute?.(
      `INSERT INTO tasks_v2 (task_id, source_contract, source_kata, source_kata_version,
        status, current_phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [row.task_id, row.source_contract, row.source_kata, row.source_kata_version, row.current_phase, now, now],
    );

    return row as TaskV2Row;
  }

  async setCurrentPhase(taskId: string, phaseName: string): Promise<void> {
    await this.api.db?.execute?.(
      `UPDATE tasks_v2 SET current_phase = ?, updated_at = ? WHERE task_id = ?`,
      [phaseName, Date.now(), taskId],
    );
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskV2Status,
    extras?: {
      output?: unknown;
      variables?: unknown;
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
    if (extras?.variables !== undefined) { sets.push("variables = ?"); params.push(JSON.stringify(extras.variables)); }
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
    if (filters.contract) { sql += " AND source_contract = ?"; params.push(filters.contract); }

    sql += " ORDER BY created_at DESC";
    if (filters.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

    return (await this.api.db?.query<TaskV2Row>(sql, params)) ?? [];
  }

  // ── Task Phases ────────────────────────────────────────────────────────────

  async startPhase(taskId: string, phaseName: string, phaseType?: string, opts?: {
    skillName?: string;
    toolName?: string;
  }): Promise<void> {
    // Note: this previously also inserted a `technique_name` value into a
    // column that `task_phases` has never actually had (see migrations.ts) —
    // the INSERT would have thrown the moment anything real called this.
    // Dropped rather than added the column back: "technique" was Kata-era
    // vestigial naming for a layer (Techniques) that was never built.
    await this.api.db?.execute?.(
      `INSERT INTO task_phases (task_id, phase_name, phase_type, status, started_at,
        skill_name, tool_name)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      [
        taskId,
        phaseName,
        phaseType ?? null,
        Date.now(),
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
