/**
 * Task Storage Layer — Phase 7
 *
 * Handles persistence of tasks to database.
 * Provides query and update methods for task state management.
 */

import type { AgentAPI } from "../types/index.js";
import type { Task, TaskRow, TaskState } from "./types.js";

/**
 * Task Storage — database persistence layer
 */
export class TaskStorage {
  constructor(private api: AgentAPI) {}

  /**
   * Save a new task to database
   */
  async create(task: Omit<Task, "id" | "createdAt">): Promise<Task> {
    const id = this.generateTaskId();
    const now = Date.now();

    const stored: Task = {
      ...task,
      id,
      createdAt: now,
    };

    const row: TaskRow = {
      id: stored.id,
      kata_name: stored.kataName,
      kata_version: stored.kataVersion,
      state: stored.state,
      current_phase: stored.currentPhase,
      variables: JSON.stringify(stored.variables),
      parent_task_id: stored.parentTaskId,
      error: stored.error,
      started_at: stored.startedAt,
      completed_at: stored.completedAt,
      created_at: stored.createdAt,
    };

    await this.api.db?.execute?.(
      `INSERT INTO tasks (
        id, kata_name, kata_version, state, current_phase,
        variables, parent_task_id, error, started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.kata_name,
        row.kata_version,
        row.state,
        row.current_phase,
        row.variables,
        row.parent_task_id,
        row.error,
        row.started_at,
        row.completed_at,
        row.created_at,
      ]
    );

    return stored;
  }

  /**
   * Get task by ID
   */
  async getById(taskId: string): Promise<Task | null> {
    const rows = await this.api.db?.query<TaskRow>(
      "SELECT * FROM tasks WHERE id = ?",
      [taskId]
    );

    if (!rows || rows.length === 0) return null;

    return this.rowToTask(rows[0]);
  }

  /**
   * Update task state and current phase
   */
  async updateState(
    taskId: string,
    state: TaskState,
    currentPhase: string
  ): Promise<void> {
    await this.api.db?.execute?.(
      "UPDATE tasks SET state = ?, current_phase = ? WHERE id = ?",
      [state, currentPhase, taskId]
    );
  }

  /**
   * Update task variables (phase outputs)
   */
  async updateVariables(
    taskId: string,
    variables: Record<string, unknown>
  ): Promise<void> {
    await this.api.db?.execute?.(
      "UPDATE tasks SET variables = ? WHERE id = ?",
      [JSON.stringify(variables), taskId]
    );
  }

  /**
   * Mark task as completed
   */
  async markCompleted(taskId: string): Promise<void> {
    const now = Date.now();
    await this.api.db?.execute?.(
      "UPDATE tasks SET state = ?, completed_at = ? WHERE id = ?",
      ["completed", now, taskId]
    );
  }

  /**
   * Mark task as failed with error message
   */
  async markFailed(taskId: string, error: string): Promise<void> {
    const now = Date.now();
    await this.api.db?.execute?.(
      "UPDATE tasks SET state = ?, error = ?, completed_at = ? WHERE id = ?",
      ["failed", error, now, taskId]
    );
  }

  /**
   * Get all pending tasks (ready to execute)
   */
  async getPending(): Promise<Task[]> {
    const rows = await this.api.db?.query<TaskRow>(
      "SELECT * FROM tasks WHERE state = ? ORDER BY created_at ASC",
      ["pending"]
    );

    if (!rows) return [];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Get all tasks for a specific kata version
   */
  async getByKata(kataName: string, kataVersion: string): Promise<Task[]> {
    const rows = await this.api.db?.query<TaskRow>(
      "SELECT * FROM tasks WHERE kata_name = ? AND kata_version = ? ORDER BY created_at DESC",
      [kataName, kataVersion]
    );

    if (!rows) return [];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Get all child tasks for a parent task
   */
  async getChildren(parentTaskId: string): Promise<Task[]> {
    const rows = await this.api.db?.query<TaskRow>(
      "SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC",
      [parentTaskId]
    );

    if (!rows) return [];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Private: Convert database row to Task object
   */
  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      kataName: row.kata_name,
      kataVersion: row.kata_version,
      state: row.state,
      currentPhase: row.current_phase,
      variables: row.variables ? JSON.parse(row.variables) : {},
      parentTaskId: row.parent_task_id,
      error: row.error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `task_${timestamp}${random}`;
  }
}

/**
 * Kata Storage — database persistence for kata definitions
 */
export class KataStorage {
  constructor(private api: AgentAPI) {}

  /**
   * Save a compiled kata definition
   */
  async save(
    id: string,
    name: string,
    version: string,
    sourceCode: string,
    compiled: any,
    checksum: string
  ): Promise<void> {
    const now = Date.now();

    await this.api.db?.execute?.(
      `INSERT OR REPLACE INTO kata_definitions (
        id, name, version, source_code, compiled_graph,
        required_skills, checksum, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        version,
        sourceCode,
        JSON.stringify(compiled),
        JSON.stringify(compiled.requiredSkills || []),
        checksum,
        now,
        now,
      ]
    );
  }

  /**
   * Get kata by name and version
   */
  async getByVersion(name: string, version: string): Promise<any | null> {
    const rows = await this.api.db?.query<any>(
      "SELECT * FROM kata_definitions WHERE name = ? AND version = ?",
      [name, version]
    );

    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      sourceCode: row.source_code,
      compiledGraph: JSON.parse(row.compiled_graph),
      requiredSkills: JSON.parse(row.required_skills),
      checksum: row.checksum,
      ontologyNodeId: row.ontology_node_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all versions of a kata
   */
  async getVersions(name: string): Promise<any[]> {
    const rows = await this.api.db?.query<any>(
      "SELECT * FROM kata_definitions WHERE name = ? ORDER BY version DESC",
      [name]
    );

    if (!rows) return [];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      sourceCode: row.source_code,
      compiledGraph: JSON.parse(row.compiled_graph),
      requiredSkills: JSON.parse(row.required_skills),
      checksum: row.checksum,
      ontologyNodeId: row.ontology_node_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Check if kata exists
   */
  async exists(name: string, version: string): Promise<boolean> {
    const rows = await this.api.db?.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM kata_definitions WHERE name = ? AND version = ?",
      [name, version]
    );

    if (!rows || rows.length === 0) return false;
    return rows[0].count > 0;
  }
}
