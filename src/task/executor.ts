/**
 * Task Executor — Phase 7
 *
 * Orchestrates task execution:
 * 1. Get task & current phase
 * 2. Execute phase action (run skill or spawn child kata)
 * 3. Handle phase transitions
 * 4. Emit events
 *
 * Interfaces with:
 *   - TaskEngine (state management)
 *   - SkillAdapter (skill execution)
 *   - Event bus (coordination)
 */

import type { AgentAPI } from "../types/index.js";
import { TaskEngine } from "./engine.js";
import { SkillAdapter } from "../skills/adapter.js";
import type { Task } from "./types.js";

/**
 * Executor — main orchestration loop
 */
export class TaskExecutor {
  private engine: TaskEngine;
  private adapter: SkillAdapter;

  constructor(private api: AgentAPI) {
    this.engine = new TaskEngine(api);
    this.adapter = new SkillAdapter(api);
  }

  /**
   * Execute a phase for a task
   *
   * Handles:
   *   - run skill: executes via SkillAdapter
   *   - spawn kata: creates child task
   *   - phase transitions: calls engine.nextPhase()
   *   - completion: calls engine.complete()
   *   - errors: calls engine.fail()
   */
  async executePhase(taskId: string): Promise<void> {
    try {
      // Get task & current phase
      const task = await this.engine.getTask(taskId);
      if (!task) {
        throw new Error(`Task '${taskId}' not found`);
      }

      const phase = await this.engine.getCurrentPhase(taskId);
      if (!phase) {
        throw new Error(
          `Phase '${task.currentPhase}' not found in kata '${task.kataName}'`
        );
      }

      // Start if pending
      if (task.state === "pending") {
        await this.engine.start(taskId);
      }

      // Execute phase action
      if (phase.action.type === "run") {
        await this.executeSkillPhase(taskId, phase.action.skill);
      } else if (phase.action.type === "spawn") {
        await this.spawnChildPhase(
          taskId,
          phase.action.kata,
          phase.action.version
        );
      }

      // Handle phase terminal
      if (phase.terminal === "complete") {
        await this.engine.complete(taskId);
      } else if (phase.terminal === "fail") {
        await this.engine.fail(taskId, `Phase '${phase.name}' explicitly failed`);
      } else if (phase.next) {
        // Transition to next phase
        await this.engine.nextPhase(taskId);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        await this.engine.fail(taskId, `Execution failed: ${errorMsg}`);
      } catch (failError) {
        console.error(`Failed to mark task as failed: ${failError}`);
      }
      throw error;
    }
  }

  /**
   * Execute "run skill" phase action
   */
  private async executeSkillPhase(
    taskId: string,
    skillName: string
  ): Promise<void> {
    const task = await this.engine.getTask(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }

    // Validate skill exists
    if (!this.adapter.validateSkillExists(skillName)) {
      throw new Error(`Skill '${skillName}' not registered`);
    }

    // Execute via adapter
    const result = await this.adapter.executeSkillWithTimeout(
      skillName,
      task.variables,
      {
        taskId,
        currentPhase: task.currentPhase,
        variables: task.variables,
      }
    );

    // Store result in task variables
    await this.engine.updateVariables(taskId, {
      ...task.variables,
      [skillName]: result,
    });
  }

  /**
   * Execute "spawn kata" phase action (Phase 3 feature)
   * For now, just log that child spawning will be implemented
   */
  private async spawnChildPhase(
    taskId: string,
    kataName: string,
    kataVersion: string
  ): Promise<void> {
    // Phase 3 feature: child task spawning, parent waiting
    // For now: log placeholder
    this.api.events?.emit(
      "task.child_spawn_requested",
      {
        type: "task.child_spawn_requested",
        parentTaskId: taskId,
        childKataName: kataName,
        childKataVersion: kataVersion,
        timestamp: Date.now(),
      },
      "task-executor"
    );

    // TODO Phase 3: Create child task, set parent to waiting, etc.
    throw new Error(
      `Child task spawning (Phase 3) not yet implemented. Requested: '${kataName}' v${kataVersion}`
    );
  }

  /**
   * Poll and execute all pending tasks
   */
  async pollAndExecute(): Promise<void> {
    const pending = await this.engine.getPending();

    for (const task of pending) {
      try {
        await this.executePhase(task.id);
      } catch (error) {
        console.error(
          `Error executing task '${task.id}': ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Get executor engine (for manual control)
   */
  getEngine(): TaskEngine {
    return this.engine;
  }

  /**
   * Get skill adapter (for testing)
   */
  getAdapter(): SkillAdapter {
    return this.adapter;
  }
}
