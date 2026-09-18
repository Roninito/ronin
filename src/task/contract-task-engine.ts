/**
 * Contract Task Engine
 *
 * Replaces src/task/engine.ts's role (2026-09-17) — spawns and advances a
 * task directly off a Contract's inline phase graph instead of looking one
 * up in a separate Kata registry. Built on TaskStorageV2 (src/task/storage-v2.ts),
 * which was already fully generic and simply never wired to anything real.
 *
 * Emits contract.task_* events rather than reusing the old "task." / "kata."
 * event names — those belonged to the subsystem this replaces, and nothing
 * else in the codebase listens for the old names once the cutover (Phase 6) lands.
 */

import type { DutyAPI } from "../types/index.js";
import { TaskStorageV2 } from "./storage-v2.js";
import { ContractStorageV2 } from "../contract/storage-v2.js";
import type { TaskV2Row, TaskV2Status, ContractPhase } from "../types/shared.js";

export interface PhaseGraph {
  initialPhase: string;
  phases: Record<string, ContractPhase>;
}

export class ContractTaskEngine {
  private taskStorage: TaskStorageV2;
  private contractStorage: ContractStorageV2;

  constructor(private api: DutyAPI) {
    this.taskStorage = new TaskStorageV2(api);
    this.contractStorage = new ContractStorageV2(api);
    this.taskStorage.init().catch((e: Error) => console.error("[contract-task-engine] task DB init failed:", e.message));
    this.contractStorage.init().catch((e: Error) => console.error("[contract-task-engine] contract DB init failed:", e.message));
  }

  /** Spawn a new task for a contract's phase graph. */
  async spawn(contractName: string, initialVariables?: Record<string, unknown>): Promise<TaskV2Row> {
    const graph = await this.getPhaseGraph(contractName);
    if (!graph) throw new Error(`Contract '${contractName}' not found`);

    const task = await this.taskStorage.createTask({
      sourceContract: contractName,
      // Vestigial NOT NULL columns left over from the Kata-registry era —
      // see TaskStorageV2.createTask's doc comment.
      sourceKata: contractName,
      currentPhase: graph.initialPhase,
    });

    if (initialVariables && Object.keys(initialVariables).length > 0) {
      await this.setVariables(task.task_id, initialVariables);
    }

    this.emit("contract.task_spawned", { taskId: task.task_id, contractName });
    return task;
  }

  /** Load a contract's phase graph (parses the `phases` JSON column). */
  async getPhaseGraph(contractName: string): Promise<PhaseGraph | null> {
    const contract = await this.contractStorage.getByName(contractName);
    if (!contract) return null;
    let phases: Record<string, ContractPhase> = {};
    try {
      phases = JSON.parse(contract.phases);
    } catch {
      console.error(`[contract-task-engine] Contract '${contractName}' has invalid phases JSON`);
    }
    return { initialPhase: contract.initial_phase, phases };
  }

  async getTask(taskId: string): Promise<TaskV2Row | null> {
    return this.taskStorage.getTask(taskId);
  }

  async getTasksByStatus(status: TaskV2Status): Promise<TaskV2Row[]> {
    return this.taskStorage.listTasks({ status });
  }

  async getVariables(taskId: string): Promise<Record<string, unknown>> {
    const task = await this.taskStorage.getTask(taskId);
    if (!task?.variables) return {};
    try {
      return JSON.parse(task.variables);
    } catch {
      return {};
    }
  }

  async setVariables(taskId: string, variables: Record<string, unknown>): Promise<void> {
    const task = await this.taskStorage.getTask(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    await this.taskStorage.updateTaskStatus(taskId, task.status, { variables });
  }

  /** Advance to a named phase (does not run it — the executor does that). */
  async advance(taskId: string, nextPhase: string): Promise<void> {
    await this.taskStorage.setCurrentPhase(taskId, nextPhase);
    await this.taskStorage.updateTaskStatus(taskId, "running");
    const task = await this.taskStorage.getTask(taskId);
    this.emit("contract.task_phase_changed", { taskId, phase: nextPhase, contractName: task?.source_contract ?? null });
  }

  async complete(taskId: string): Promise<void> {
    await this.taskStorage.updateTaskStatus(taskId, "completed", { completedAt: Date.now() });
    const task = await this.taskStorage.getTask(taskId);
    this.emit("contract.task_completed", { taskId, contractName: task?.source_contract ?? null });
  }

  async fail(taskId: string, error: string, phaseName?: string): Promise<void> {
    await this.taskStorage.updateTaskStatus(taskId, "failed", {
      error,
      errorPhase: phaseName,
      completedAt: Date.now(),
    });
    const task = await this.taskStorage.getTask(taskId);
    this.emit("contract.task_failed", { taskId, contractName: task?.source_contract ?? null, error });
  }

  async waitForEvent(taskId: string): Promise<void> {
    await this.taskStorage.updateTaskStatus(taskId, "waiting_for_event");
  }

  private emit(type: string, payload: unknown): void {
    this.api.events?.emit(type, payload, "contract-task-engine");
  }
}
