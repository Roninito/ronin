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

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { TaskExecutor } from "../src/task/executor.js";
import { KataRegistry } from "../src/kata/registry.js";
import { useMiddlewareStack } from "../src/chains/templates.js";

export default class KataExecutorAgent extends BaseAgent {
  private executor: TaskExecutor;
  private registry: KataRegistry;

  constructor(api: AgentAPI) {
    super(api);
    this.executor = new TaskExecutor(api);
    this.registry = new KataRegistry(api);
  }

  async execute(): Promise<void> {
    // Listen for task spawn requests
    this.api.events?.on("task.spawn_requested", async (payload: any) => {
      try {
        await this.handleSpawnRequest(payload);
      } catch (error) {
        this.logger.error(
          `Spawn request failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    // Listen for manual execution requests
    this.api.events?.on("kata.execute", async (payload: any) => {
      try {
        await this.handleExecuteRequest(payload);
      } catch (error) {
        this.logger.error(
          `Execute request failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  /**
   * Handle task spawn request
   */
  private async handleSpawnRequest(payload: {
    kataName: string;
    kataVersion: string;
    initialVariables?: Record<string, unknown>;
  }): Promise<void> {
    const engine = this.executor.getEngine();

    // Spawn task
    const task = await engine.spawn(payload.kataName, payload.kataVersion);

    // Set initial variables if provided
    if (payload.initialVariables) {
      await engine.updateVariables(task.id, payload.initialVariables);
    }

    this.logger.info(
      `Spawned task '${task.id}' for kata '${payload.kataName}' v${payload.kataVersion}`
    );

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
    const engine = this.executor.getEngine();

    // Spawn task
    const task = await engine.spawn(payload.kataName, payload.kataVersion);

    // Set initial variables
    if (payload.initialVariables) {
      await engine.updateVariables(task.id, payload.initialVariables);
    }

    // Start immediately
    await this.executor.executePhase(task.id);

    this.logger.info(
      `Executed initial phase of task '${task.id}' for kata '${payload.kataName}' v${payload.kataVersion}`
    );

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
