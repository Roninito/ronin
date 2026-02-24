/**
 * Task Engine — Phase 7
 *
 * Implements the task state machine and execution loop
 * Handles phase transitions, state changes, and event emission
 *
 * State Machine:
 *   pending → running → [waiting] → completed
 *                    ↘ failed
 *                    ↘ canceled
 */

import type { AgentAPI } from "../types/index.js";
import { TaskStorage, KataStorage } from "./storage.js";
import type { Task, TaskState, TaskEvent } from "./types.js";
import { KataRegistry } from "../kata/registry.js";

/**
 * Task Engine — state machine + orchestration
 */
export class TaskEngine {
  private taskStorage: TaskStorage;
  private kataStorage: KataStorage;
  private registry: KataRegistry;

  constructor(private api: AgentAPI) {
    this.taskStorage = new TaskStorage(api);
    this.kataStorage = new KataStorage(api);
    this.registry = new KataRegistry(api);
  }

  /**
   * Spawn a new task for a kata
   */
  async spawn(kataName: string, kataVersion: string): Promise<Task> {
    // Verify kata exists
    const kata = await this.registry.get(kataName, kataVersion);
    if (!kata) {
      throw new Error(
        `Kata '${kataName}' version '${kataVersion}' not found`
      );
    }

    // Create task
    const task = await this.taskStorage.create({
      kataName,
      kataVersion,
      state: "pending",
      currentPhase: kata.initial,
      variables: {},
    });

    // Emit event
    this.emit({
      type: "task.created",
      taskId: task.id,
      kataName,
      kataVersion,
      state: "pending",
      timestamp: Date.now(),
    });

    return task;
  }

  /**
   * Start a task (transition from pending → running)
   */
  async start(taskId: string): Promise<void> {
    const task = await this.taskStorage.getById(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }

    if (task.state !== "pending") {
      throw new Error(
        `Cannot start task in state '${task.state}' (must be 'pending')`
      );
    }

    // Mark started
    task.startedAt = Date.now();
    await this.taskStorage.updateState(taskId, "running", task.currentPhase);

    this.emit({
      type: "task.state_changed",
      taskId,
      kataName: task.kataName,
      kataVersion: task.kataVersion,
      state: "running",
      previousState: "pending",
      timestamp: Date.now(),
    });
  }

  /**
   * Transition to next phase
   */
  async nextPhase(taskId: string): Promise<void> {
    const task = await this.taskStorage.getById(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    const kata = await this.registry.get(task.kataName, task.kataVersion);
    if (!kata) {
      throw new Error(`Kata '${task.kataName}' version '${task.kataVersion}' not found`);
    }

    const currentPhase = kata.phases[task.currentPhase];
    if (!currentPhase || !currentPhase.next) {
      throw new Error(
        `Phase '${task.currentPhase}' has no next phase`
      );
    }

    const nextPhaseName = currentPhase.next;
    await this.taskStorage.updateState(taskId, "running", nextPhaseName);

    this.emit({
      type: "task.phase_changed",
      taskId,
      kataName: task.kataName,
      kataVersion: task.kataVersion,
      state: "running",
      timestamp: Date.now(),
    });
  }

  /**
   * Mark task as completed
   */
  async complete(taskId: string): Promise<void> {
    const task = await this.taskStorage.getById(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    await this.taskStorage.markCompleted(taskId);

    this.emit({
      type: "task.completed",
      taskId,
      kataName: task.kataName,
      kataVersion: task.kataVersion,
      state: "completed",
      previousState: task.state,
      timestamp: Date.now(),
    });
  }

  /**
   * Mark task as failed with error
   */
  async fail(taskId: string, error: string): Promise<void> {
    const task = await this.taskStorage.getById(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    await this.taskStorage.markFailed(taskId, error);

    this.emit({
      type: "task.failed",
      taskId,
      kataName: task.kataName,
      kataVersion: task.kataVersion,
      state: "failed",
      previousState: task.state,
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.taskStorage.getById(taskId);
  }

  /**
   * Get all pending tasks
   */
  async getPending(): Promise<Task[]> {
    return this.taskStorage.getPending();
  }

  /**
   * Get all tasks for a kata
   */
  async getTasksByKata(kataName: string, kataVersion: string): Promise<Task[]> {
    return this.taskStorage.getByKata(kataName, kataVersion);
  }

  /**
   * Update task variables (phase outputs)
   */
  async updateVariables(
    taskId: string,
    variables: Record<string, unknown>
  ): Promise<void> {
    await this.taskStorage.updateVariables(taskId, variables);
  }

  /**
   * Get current phase definition
   */
  async getCurrentPhase(taskId: string) {
    const task = await this.taskStorage.getById(taskId);
    if (!task) return null;

    const kata = await this.registry.get(task.kataName, task.kataVersion);
    if (!kata) return null;

    return kata.phases[task.currentPhase];
  }

  /**
   * Set task state directly (used for waiting_for_event)
   */
  async setTaskState(taskId: string, state: TaskState): Promise<void> {
    await this.taskStorage.updateById(taskId, { state });
    
    this.emit({
      type: `task.state_changed`,
      taskId,
      kataName: "",
      kataVersion: "",
      state,
      timestamp: Date.now(),
    });
  }

  /**
   * Private: Emit task event via api.events
   */
  private emit(event: TaskEvent): void {
    this.api.events?.emit(
      event.type,
      event,
      "task-engine"
    );
  }
}
