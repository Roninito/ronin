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
 *   - ChildTaskCoordinator (child spawning)
 *   - Event bus (coordination)
 */

import type { AgentAPI } from "../types/index.js";
import { TaskEngine } from "./engine.js";
import { SkillAdapter } from "../skills/adapter.js";
import { ChildTaskCoordinator } from "./child-coordinator.js";
import type { Task } from "./types.js";

/**
 * Executor — main orchestration loop
 */
export class TaskExecutor {
  private engine: TaskEngine;
  private adapter: SkillAdapter;
  private childCoordinator: ChildTaskCoordinator;

  constructor(private api: AgentAPI) {
    this.engine = new TaskEngine(api);
    this.adapter = new SkillAdapter(api);
    this.childCoordinator = new ChildTaskCoordinator(api);
  }

  /**
   * Execute a phase for a task
   *
   * Handles:
   *   - run skill: executes via SkillAdapter
   *   - spawn kata: creates child task via ChildTaskCoordinator
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

      // Skip execution if waiting for child or event
      if (task.state === "waiting" || task.state === "waiting_for_event") {
        return;
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
      } else if (phase.action.type === "wait") {
        // Set up event listener and exit (don't process terminal yet)
        await this.executeWaitPhase(taskId, phase.action.eventName, phase.action.timeout);
        return; // Don't process phase terminal, task is waiting
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

  /**
   * Execute wait phase - subscribe to event and wait
   */
  private async executeWaitPhase(
    taskId: string,
    eventName: string,
    timeout?: number
  ): Promise<void> {
    // Set task state to waiting_for_event
    await this.engine.setTaskState(taskId, "waiting_for_event");

    // Create handler that will be called when event arrives
    const handler = async (event: unknown) => {
      try {
        // Get task to verify it's still waiting
        const currentTask = await this.engine.getTask(taskId);
        if (!currentTask || currentTask.state !== "waiting_for_event") {
          return;
        }

        // Store event data in task variables
        currentTask.variables = {
          ...currentTask.variables,
          event_received: event,
          event_timestamp: Date.now(),
          event_name: eventName,
        };

        // Move to next phase
        const phase = currentTask.kata.phases[currentTask.currentPhase];
        if (phase.next) {
          await this.engine.nextPhase(taskId);
        } else {
          await this.engine.complete(taskId);
        }
      } catch (e) {
        await this.engine.fail(
          taskId,
          `Error handling event: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    };

    // Subscribe to event
    this.api.events?.on(eventName, handler);

    // Set timeout if specified
    if (timeout && timeout > 0) {
      setTimeout(async () => {
        try {
          const currentTask = await this.engine.getTask(taskId);
          if (currentTask && currentTask.state === "waiting_for_event") {
            await this.engine.fail(
              taskId,
              `Timeout waiting for event '${eventName}' after ${timeout} seconds`
            );
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }, timeout * 1000);
    }
  }
}
