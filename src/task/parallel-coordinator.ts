/**
 * Parallel Task Coordinator: Spawn multiple children concurrently with join semantics
 *
 * Phase 8 Enhancement: Sequential spawning (Phase 7B) → Parallel spawning
 *
 * Example:
 *   phase batch_processing
 *   spawn parallel
 *     spawn kata process.chunk1 v1 -> chunk1_result
 *     spawn kata process.chunk2 v1 -> chunk2_result
 *     spawn kata process.chunk3 v1 -> chunk3_result
 *   join all_completed
 *   next aggregate
 */

import type { Task, TaskEvent } from "./types.js";

export interface ParallelSpawn {
  childName: string; // For tracking: "chunk1", "chunk2", etc.
  kataName: string;
  kataVersion: string;
  outputBinding?: string; // Where to store result: "chunk1_result"
}

export interface ParallelPhaseConfig {
  spawns: ParallelSpawn[];
  joinStrategy: "all" | "any" | "first"; // Wait for all, any, or first to complete
  timeout?: number; // ms to wait before failing
  failureMode: "fail_all" | "fail_first" | "continue"; // On child failure
}

export interface ParallelTaskState {
  activeChildren: Map<string, string>; // childName → taskId
  completedChildren: Set<string>;
  failedChildren: Set<string>;
  startedAt: number;
  joinStrategy: "all" | "any" | "first";
}

/**
 * Manages parallel child spawning and join semantics
 */
export class ParallelCoordinator {
  private parallelStates: Map<string, ParallelTaskState> = new Map();

  /**
   * Spawn multiple children in parallel
   */
  spawnParallel(
    parentTask: Task,
    spawns: ParallelSpawn[],
    joinStrategy: "all" | "any" | "first" = "all"
  ): {
    childTaskIds: string[];
    state: ParallelTaskState;
  } {
    const activeChildren = new Map<string, string>();
    const childTaskIds: string[] = [];

    // Create child task for each spawn
    for (const spawn of spawns) {
      const childTaskId = `${parentTask.id}_${spawn.childName}_${Date.now()}`;
      activeChildren.set(spawn.childName, childTaskId);
      childTaskIds.push(childTaskId);
    }

    // Store parallel state
    const state: ParallelTaskState = {
      activeChildren,
      completedChildren: new Set(),
      failedChildren: new Set(),
      startedAt: Date.now(),
      joinStrategy,
    };

    this.parallelStates.set(parentTask.id, state);

    // Return info needed to create child tasks
    return { childTaskIds, state };
  }

  /**
   * Handle child completion in parallel context
   */
  handleParallelChildCompletion(
    parentTask: Task,
    childName: string,
    result: any
  ): {
    allDone: boolean;
    readyToJoin: boolean;
    joinedResult?: any;
  } {
    const state = this.parallelStates.get(parentTask.id);
    if (!state) {
      throw new Error(`No parallel state for task ${parentTask.id}`);
    }

    state.completedChildren.add(childName);
    state.activeChildren.delete(childName);

    // Store result in parent's variables
    if (!parentTask.variables.parallel_results) {
      parentTask.variables.parallel_results = {};
    }
    parentTask.variables.parallel_results[childName] = result;

    // Check if ready to join based on strategy
    const readyToJoin = this.checkJoinCondition(state, state.joinStrategy);

    // If all done, clean up and aggregate results
    const allDone =
      state.completedChildren.size + state.failedChildren.size ===
      state.activeChildren.size + state.completedChildren.size;

    let joinedResult = undefined;
    if (readyToJoin || allDone) {
      joinedResult = this.aggregateResults(parentTask);
    }

    return { allDone, readyToJoin, joinedResult };
  }

  /**
   * Handle child failure in parallel context
   */
  handleParallelChildFailure(
    parentTask: Task,
    childName: string,
    error: string,
    failureMode: "fail_all" | "fail_first" | "continue"
  ): {
    shouldFailParent: boolean;
    shouldContinue: boolean;
  } {
    const state = this.parallelStates.get(parentTask.id);
    if (!state) {
      throw new Error(`No parallel state for task ${parentTask.id}`);
    }

    state.failedChildren.add(childName);
    state.activeChildren.delete(childName);

    // Store error in parent's variables
    if (!parentTask.variables.parallel_errors) {
      parentTask.variables.parallel_errors = {};
    }
    parentTask.variables.parallel_errors[childName] = error;

    // Decide parent behavior based on failure mode
    let shouldFailParent = false;
    let shouldContinue = true;

    switch (failureMode) {
      case "fail_all":
        // Any child failure fails parent
        shouldFailParent = true;
        shouldContinue = false;
        break;

      case "fail_first":
        // First child failure fails parent
        shouldFailParent = state.failedChildren.size === 1;
        shouldContinue = !shouldFailParent;
        break;

      case "continue":
        // Ignore child failures
        shouldContinue = true;
        shouldFailParent = false;
        break;
    }

    return { shouldFailParent, shouldContinue };
  }

  /**
   * Check if join condition is met
   */
  private checkJoinCondition(
    state: ParallelTaskState,
    strategy: "all" | "any" | "first"
  ): boolean {
    const total = state.activeChildren.size + state.completedChildren.size;

    switch (strategy) {
      case "all":
        // Wait for all children
        return state.activeChildren.size === 0;

      case "any":
        // Any child completes
        return state.completedChildren.size > 0;

      case "first":
        // First child completes
        return state.completedChildren.size >= 1;

      default:
        return false;
    }
  }

  /**
   * Aggregate results from all children
   */
  private aggregateResults(parentTask: Task): any {
    const results = parentTask.variables.parallel_results || {};
    const errors = parentTask.variables.parallel_errors || {};

    return {
      results,
      errors,
      totalChildren: Object.keys(results).length + Object.keys(errors).length,
      successCount: Object.keys(results).length,
      failureCount: Object.keys(errors).length,
      timestamp: Date.now(),
    };
  }

  /**
   * Get current state of parallel execution
   */
  getParallelState(parentTaskId: string): ParallelTaskState | undefined {
    return this.parallelStates.get(parentTaskId);
  }

  /**
   * Clean up parallel state
   */
  cleanupParallelState(parentTaskId: string): void {
    this.parallelStates.delete(parentTaskId);
  }
}

/**
 * Join semantics configuration
 */
export const JoinStrategies = {
  // Wait for all children to complete
  ALL: "all" as const,

  // Continue when any child completes
  ANY: "any" as const,

  // Continue when first child completes
  FIRST: "first" as const,
};

/**
 * Failure handling modes for parallel spawning
 */
export const FailureModes = {
  // Any child failure fails parent
  FAIL_ALL: "fail_all" as const,

  // First child failure fails parent
  FAIL_FIRST: "fail_first" as const,

  // Continue regardless of child failures
  CONTINUE: "continue" as const,
};

/**
 * Helper: Create parallel spawn configuration
 */
export function createParallelSpawn(
  spawns: Array<{
    childName: string;
    kataName: string;
    kataVersion: string;
    outputBinding?: string;
  }>,
  joinStrategy: "all" | "any" | "first" = "all",
  failureMode: "fail_all" | "fail_first" | "continue" = "fail_all"
): ParallelPhaseConfig {
  return {
    spawns,
    joinStrategy,
    failureMode,
  };
}
