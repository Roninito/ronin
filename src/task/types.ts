/**
 * Task Engine Types — Phase 7
 *
 * Defines the runtime execution model: tasks, states, and results.
 *
 * Task lifecycle: pending → running → [waiting] → completed
 *                                   ↘ failed
 *                                   ↘ canceled
 */

import type { CompiledKata, Phase } from "./kata/types.js";

/**
 * Task State — deterministic state machine
 */
export type TaskState =
  | "pending"             // Created, waiting to start
  | "running"             // Currently executing a phase
  | "waiting"             // Waiting for child task to complete
  | "waiting_for_event"   // Waiting for external event (Phase 10)
  | "completed"           // All phases completed successfully
  | "failed"              // Phase execution failed
  | "canceled";           // Manually canceled

/**
 * Result of phase execution
 */
export interface TaskResult {
  success: boolean;
  output?: unknown; // Phase output (skill result or spawn info)
  error?: string; // Error message if failed
  nextPhase?: string; // Next phase to run
}

/**
 * Single Task — runtime execution unit
 */
export interface Task {
  id: string; // Unique ID (e.g., "task_8821")
  kataName: string; // "finance.audit"
  kataVersion: string; // "v2"
  state: TaskState; // Current state
  currentPhase: string; // Current phase name
  variables: Record<string, unknown>; // Phase outputs/context
  parentTaskId?: string; // For child tasks (Phase 3)
  error?: string; // Error message if failed
  startedAt?: number; // Unix timestamp
  completedAt?: number; // Unix timestamp
  createdAt: number; // Unix timestamp
}

/**
 * Task storage row (database representation)
 */
export interface TaskRow {
  id: string;
  kata_name: string;
  kata_version: string;
  state: TaskState;
  current_phase: string;
  variables: string; // JSON string
  parent_task_id?: string;
  error?: string;
  started_at?: number;
  completed_at?: number;
  created_at: number;
}

/**
 * Context passed to skill executor
 */
export interface TaskContext {
  taskId: string;
  kataName: string;
  kataVersion: string;
  currentPhase: string;
  variables: Record<string, unknown>; // Accumulated phase outputs
}

/**
 * State transition rule
 */
export interface StateTransition {
  from: TaskState;
  to: TaskState;
  predicate?: (task: Task) => boolean; // Optional condition
}

/**
 * Task event emitted via api.events
 */
export interface TaskEvent {
  type: string; // e.g., "task.created", "task.state_changed", "task.completed"
  taskId: string;
  kataName: string;
  kataVersion: string;
  state?: TaskState; // Current state
  previousState?: TaskState;
  error?: string;
  timestamp: number; // Unix timestamp
}
