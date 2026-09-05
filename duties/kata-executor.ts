/**
 * Kata Executor Agent — Phase 7
 *
 * Manual kata spawning and execution
 * Provides API for users to:
 * - Register new katas
 * - Spawn task instances
 * - Monitor task progress
 * - Retrieve task results
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { TaskExecutor } from "../src/task/executor.js";
import { TaskEngine } from "../src/task/engine.js";
import { KataRegistry } from "../src/kata/registry.js";
import { useMiddlewareStack } from "../src/chains/templates.js";

export default class KataExecutorAgent extends BaseDuty {
  // Named taskExecutor (not executor) — BaseDuty already declares a protected
  // `executor: Executor | null` field for its own SAR chain machinery; this is an
  // unrelated task-kata executor and must not shadow it.
  private taskExecutor: TaskExecutor;
  private engine: TaskEngine;
  private registry: KataRegistry;

  constructor(api: DutyAPI) {
    super(api);
    this.taskExecutor = new TaskExecutor(api);
    this.engine = new TaskEngine(api);
    this.registry = new KataRegistry(api);

    // Register event handlers in constructor (event-driven agent — execute() is not called at startup)
    this.api.events?.on("task.spawn_requested", async (payload: any) => {
      try {
        await this.handleSpawnRequest(payload);
      } catch (error) {
        console.error(`[kata-executor] Spawn request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    this.api.events?.on("kata.execute", async (payload: any) => {
      try {
        await this.handleExecuteRequest(payload);
      } catch (error) {
        console.error(`[kata-executor] Execute request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    console.log("⚔️  Kata Executor ready. Listening for task.spawn_requested and kata.execute");
  }

  async execute(): Promise<void> {
    // Event-driven — handlers registered in constructor
  }

  /**
   * Handle task spawn request
   */
  private async handleSpawnRequest(payload: {
    kataName: string;
    kataVersion: string;
    initialVariables?: Record<string, unknown>;
  }): Promise<void> {
    const task = await this.engine.spawn(payload.kataName, payload.kataVersion);

    // Set initial variables if provided
    if (payload.initialVariables) {
      await this.engine.updateVariables(task.id, payload.initialVariables);
    }

    console.log(`[kata-executor] Spawned task '${task.id}' for kata '${payload.kataName}' v${payload.kataVersion}`);

    // Emit event
    this.api.events?.emit(
      "kata.task_spawned",
      {
        type: "kata.task_spawned",
        taskId: task.id,
        kataName: task.kataName,
        kataVersion: task.kataVersion,
        timestamp: Date.now(),
      },
      "kata-executor"
    );
  }

  /**
   * Handle manual execution request (spawn + start)
   */
  private async handleExecuteRequest(payload: {
    kataName: string;
    kataVersion: string;
    initialVariables?: Record<string, unknown>;
  }): Promise<void> {
    const task = await this.engine.spawn(payload.kataName, payload.kataVersion);

    // Set initial variables
    if (payload.initialVariables) {
      await this.engine.updateVariables(task.id, payload.initialVariables);
    }

    // Start immediately
    await this.taskExecutor.executePhase(task.id);

    console.log(`[kata-executor] Executed initial phase of task '${task.id}' for kata '${payload.kataName}' v${payload.kataVersion}`);

    this.api.events?.emit(
      "kata.task_executed",
      {
        type: "kata.task_executed",
        taskId: task.id,
        kataName: task.kataName,
        kataVersion: task.kataVersion,
        timestamp: Date.now(),
      },
      "kata-executor"
    );
  }
}
