/**
 * Child Task Coordination — Phase 7B
 *
 * Handles multi-level task execution:
 * - Parent task spawns child task
 * - Parent enters "waiting" state
 * - Child executes independently
 * - When child completes: parent resumes
 * - If child fails: parent fails or retries (configurable)
 *
 * Example:
 *   phase setup
 *     spawn kata project.init v1 -> init_task
 *     next configure
 *
 * Execution:
 *   Parent is running in "setup" phase
 *   → spawn creates child task
 *   → Parent enters "waiting" state
 *   → Child executes independently
 *   → When child completes/fails → Parent hears event
 *   → Parent resumes in "configure" phase (or fails)
 */

import type { AgentAPI } from "../types/index.js";
import { TaskEngine } from "./engine.js";
import type { Task } from "./types.js";

/**
 * Child Task Coordinator - handles parent/child relationships
 */
export class ChildTaskCoordinator {
  private engine: TaskEngine;

  constructor(private api: AgentAPI) {
    this.engine = new TaskEngine(api);

    // Listen for child task completion
    this.api.events?.on("task.completed", (payload: any) => {
      this.handleChildCompletion(payload);
    });

    // Listen for child task failures
    this.api.events?.on("task.failed", (payload: any) => {
      this.handleChildFailure(payload);
    });
  }

  /**
   * Spawn a child task from parent
   */
  async spawnChild(
    parentTaskId: string,
    childKataName: string,
    childKataVersion: string
  ): Promise<Task> {
    // Verify parent exists and is in valid state
    const parent = await this.engine.getTask(parentTaskId);
    if (!parent) {
      throw new Error(`Parent task '${parentTaskId}' not found`);
    }

    if (parent.state !== "running") {
      throw new Error(
        `Parent task '${parentTaskId}' must be running to spawn child (current: ${parent.state})`
      );
    }

    // Create child task
    const child = await this.engine.spawn(childKataName, childKataVersion);

    // Update child with parent reference
    await this.api.db?.execute?.(
      "UPDATE tasks SET parent_task_id = ? WHERE id = ?",
      [parentTaskId, child.id]
    );

    // Update parent to waiting state
    await this.api.db?.execute?.(
      "UPDATE tasks SET state = ? WHERE id = ?",
      ["waiting", parentTaskId]
    );

    // Emit event
    this.api.events?.emit(
      "task.child_spawned",
      {
        type: "task.child_spawned",
        parentTaskId,
        childTaskId: child.id,
        childKataName,
        childKataVersion,
        timestamp: Date.now(),
      },
      "child-task-coordinator"
    );

    this.api.logger?.info(
      `Spawned child task '${child.id}' for parent '${parentTaskId}'`
    );

    return child;
  }

  /**
   * Handle child task completion
   */
  private async handleChildCompletion(payload: {
    taskId: string;
    kataName: string;
    kataVersion: string;
    timestamp: number;
  }): Promise<void> {
    try {
      // Get child task
      const child = await this.engine.getTask(payload.taskId);
      if (!child || !child.parentTaskId) return; // Not a child or no parent

      // Get parent task
      const parent = await this.engine.getTask(child.parentTaskId);
      if (!parent) {
        this.api.logger?.error(
          `Parent task '${child.parentTaskId}' not found for child '${payload.taskId}'`
        );
        return;
      }

      // Parent should be in waiting state
      if (parent.state !== "waiting") {
        this.api.logger?.warn(
          `Parent task '${parent.id}' in state '${parent.state}' (expected 'waiting')`
        );
        return;
      }

      // Resume parent: transition to next phase
      await this.resumeParent(parent.id, child);

      this.api.events?.emit(
        "task.child_completed",
        {
          type: "task.child_completed",
          parentTaskId: parent.id,
          childTaskId: child.id,
          timestamp: Date.now(),
        },
        "child-task-coordinator"
      );

      this.api.logger?.info(
        `Child task '${child.id}' completed, resuming parent '${parent.id}'`
      );
    } catch (error) {
      this.api.logger?.error(
        `Error handling child completion: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle child task failure
   */
  private async handleChildFailure(payload: {
    taskId: string;
    error: string;
    timestamp: number;
  }): Promise<void> {
    try {
      const child = await this.engine.getTask(payload.taskId);
      if (!child || !child.parentTaskId) return;

      const parent = await this.engine.getTask(child.parentTaskId);
      if (!parent) return;

      if (parent.state !== "waiting") return;

      // Get retry policy for parent
      const policy = await this.getRetryPolicy(parent);

      // Check if should retry
      if (policy.shouldRetry(parent, child)) {
        await this.retryChild(parent.id, child);
      } else {
        // Propagate failure to parent
        await this.engine.fail(
          parent.id,
          `Child task '${child.id}' failed: ${payload.error}`
        );

        this.api.events?.emit(
          "task.child_failed",
          {
            type: "task.child_failed",
            parentTaskId: parent.id,
            childTaskId: child.id,
            error: payload.error,
            timestamp: Date.now(),
          },
          "child-task-coordinator"
        );

        this.api.logger?.info(
          `Child task '${child.id}' failed, parent '${parent.id}' marked failed`
        );
      }
    } catch (error) {
      this.api.logger?.error(
        `Error handling child failure: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Resume parent after child completes
   */
  private async resumeParent(parentId: string, child: Task): Promise<void> {
    // Merge child variables into parent
    const parent = await this.engine.getTask(parentId);
    if (!parent) return;

    const mergedVariables = {
      ...parent.variables,
      // Store child output under phase action binding name
      // e.g., spawn kata project.init v1 -> init_task
      // becomes: variables.init_task = { child result }
    };

    await this.engine.updateVariables(parentId, mergedVariables);

    // Transition parent to next phase
    await this.engine.nextPhase(parentId);
  }

  /**
   * Retry child task execution
   */
  private async retryChild(parentId: string, originalChild: Task): Promise<void> {
    const parent = await this.engine.getTask(parentId);
    if (!parent) return;

    // Create new child task (same kata)
    const newChild = await this.engine.spawn(
      originalChild.kataName,
      originalChild.kataVersion
    );

    // Link to parent
    await this.api.db?.execute?.(
      "UPDATE tasks SET parent_task_id = ? WHERE id = ?",
      [parentId, newChild.id]
    );

    this.api.logger?.info(
      `Retrying child task for parent '${parentId}': ${newChild.id}`
    );
  }

  /**
   * Get retry policy for task
   */
  private async getRetryPolicy(
    task: Task
  ): Promise<{
    shouldRetry: (parent: Task, child: Task) => boolean;
    getBackoff: (attempt: number) => number;
  }> {
    // Default: no retries
    return {
      shouldRetry: () => false,
      getBackoff: (attempt) => Math.pow(2, attempt) * 1000, // exponential backoff
    };
  }
}

/**
 * Retry Policy - configurable failure handling
 */
export interface RetryPolicy {
  maxRetries: number; // How many times to retry
  backoff: "fixed" | "exponential" | "linear"; // Backoff strategy
  baseDelay: number; // Base delay in milliseconds
  maxDelay: number; // Max delay cap
}

/**
 * Default retry policies
 */
export const DefaultRetryPolicies = {
  // No retries
  noRetry: {
    maxRetries: 0,
    backoff: "fixed",
    baseDelay: 0,
    maxDelay: 0,
  } as RetryPolicy,

  // 3 retries with exponential backoff
  moderate: {
    maxRetries: 3,
    backoff: "exponential",
    baseDelay: 1000, // 1 second
    maxDelay: 60000, // 1 minute
  } as RetryPolicy,

  // 5 retries with aggressive backoff
  aggressive: {
    maxRetries: 5,
    backoff: "exponential",
    baseDelay: 500, // 500ms
    maxDelay: 300000, // 5 minutes
  } as RetryPolicy,
};
