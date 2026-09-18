/**
 * Task Executor
 *
 * Replaces duties/kata-executor.ts (2026-09-17, Kata removal) — spawns and
 * immediately runs a task off a Contract's inline phase graph, instead of a
 * separately-versioned Kata artifact. Listens for the same two trigger
 * events with a lighter payload: `task.spawn_requested`/`contract.execute`
 * now carry `{contractName, initialVariables?}` rather than
 * `{kataName, kataVersion, ...}`.
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { ContractTaskEngine } from "../src/task/contract-task-engine.js";
import { ContractTaskExecutor } from "../src/task/contract-task-executor.js";

interface SpawnPayload {
  contractName: string;
  initialVariables?: Record<string, unknown>;
}

export default class TaskExecutorDuty extends BaseDuty {
  private engine: ContractTaskEngine;
  private taskExecutor: ContractTaskExecutor;

  constructor(api: DutyAPI) {
    super(api);
    this.engine = new ContractTaskEngine(api);
    this.taskExecutor = new ContractTaskExecutor(api);

    // Event-driven agent — execute() is not called at startup.
    this.api.events?.on("task.spawn_requested", async (payload: unknown) => {
      try {
        await this.handleSpawnRequest(payload as SpawnPayload);
      } catch (error) {
        console.error(`[task-executor] Spawn request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    this.api.events?.on("contract.execute", async (payload: unknown) => {
      try {
        await this.handleExecuteRequest(payload as SpawnPayload);
      } catch (error) {
        console.error(`[task-executor] Execute request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    console.log("⚔️  Task Executor ready. Listening for task.spawn_requested and contract.execute");
  }

  async execute(): Promise<void> {
    // Event-driven — handlers registered in constructor.
  }

  /** Spawn a task, but don't run it yet (a poll tick or `contract.execute` starts it). */
  private async handleSpawnRequest(payload: SpawnPayload): Promise<void> {
    const task = await this.engine.spawn(payload.contractName, payload.initialVariables);
    console.log(`[task-executor] Spawned task '${task.task_id}' for contract '${payload.contractName}'`);
  }

  /** Spawn a task and run its phases immediately (cron/event triggers and `ronin contract test`). */
  private async handleExecuteRequest(payload: SpawnPayload): Promise<void> {
    const task = await this.engine.spawn(payload.contractName, payload.initialVariables);
    await this.taskExecutor.executePhase(task.task_id);
    console.log(`[task-executor] Executed task '${task.task_id}' for contract '${payload.contractName}'`);
  }
}
