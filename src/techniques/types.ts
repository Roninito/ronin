/**
 * Types for Techniques, enhanced Katas, enhanced Contracts, and Tasks v2
 */

// ── Techniques ────────────────────────────────────────────────────────────────

/** A step in a composite technique */
export interface TechniqueStep {
  name: string;
  description?: string;
  runType: "skill" | "tool";
  runName: string;
  /** Optional ability to invoke on the skill */
  ability?: string;
  /** Parameters — may include variable refs like "input.channelId" */
  params: Record<string, unknown>;
  /** Variable name to store this step's output */
  output: string;
}

/** Return mapping for a composite technique */
export type ReturnMapping = Record<string, unknown>;

/** Parsed AST for a composite technique */
export interface CompositeTechniqueAST {
  type: "composite";
  steps: TechniqueStep[];
  returnMapping: ReturnMapping;
}

/** Parsed AST for a custom technique */
export interface CustomTechniqueAST {
  type: "custom";
  handlerPath: string;
}

export type TechniqueAST = CompositeTechniqueAST | CustomTechniqueAST;

/** Schema field definition */
export interface SchemaField {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  items?: SchemaField;
  properties?: Record<string, SchemaField>;
}

export type SchemaDefinition = Record<string, SchemaField>;

/** Dependency declaration */
export interface TechniqueDependency {
  kind: "skill" | "tool";
  name: string;
}

/** Full parsed technique definition (from DSL) */
export interface TechniqueDefinition {
  name: string;
  version: string;
  description: string;
  category?: string;
  tags?: string[];
  type: "composite" | "custom";
  requires: TechniqueDependency[];
  inputSchema: SchemaDefinition;
  outputSchema: SchemaDefinition;
  ast: TechniqueAST;
  /** Raw DSL source */
  source: string;
}

/** Database row for a technique */
export interface TechniqueRow {
  id: number;
  name: string;
  version: string;
  description: string;
  category: string | null;
  tags: string | null; // JSON array
  type: string;
  definition: string; // DSL source
  input_schema: string | null; // JSON
  output_schema: string | null; // JSON
  created_at: number;
  updated_at: number;
  author: string | null;
  deprecated: number; // 0 or 1
  replacement_technique: string | null;
  usage_count: number;
  last_used_at: number | null;
  average_duration: number | null;
}

/** Filters for listing techniques */
export interface TechniqueListFilters {
  category?: string;
  tag?: string;
  type?: "composite" | "custom";
  deprecated?: boolean;
  sort?: "name" | "created" | "usage";
  limit?: number;
}

// ── Katas v2 ──────────────────────────────────────────────────────────────────

/** Dependency declaration for a kata */
export interface KataDependency {
  kind: "technique" | "skill" | "tool";
  name: string;
}

/** Database row for katas (v2 schema) */
export interface KataRowV2 {
  id: number;
  name: string;
  version: string;
  description: string;
  category: string | null;
  tags: string | null; // JSON array
  definition: string; // DSL source
  input_schema: string | null; // JSON
  output_schema: string | null; // JSON
  created_at: number;
  updated_at: number;
  author: string | null;
  deprecated: number; // 0 or 1
  replacement_kata: string | null;
  usage_count: number;
  last_used_at: number | null;
  average_duration: number | null;
}

/** Filters for listing katas */
export interface KataListFilters {
  category?: string;
  tag?: string;
  deprecated?: boolean;
  sort?: "name" | "created" | "usage";
  limit?: number;
}

// ── Contracts v2 ──────────────────────────────────────────────────────────────

export type TriggerType = "cron" | "event" | "webhook" | "manual";
export type FailureAction = "retry" | "alert" | "ignore";
export type BackoffType = "linear" | "exponential";

export interface CronTriggerConfig {
  type: "cron";
  expression: string;
  timezone?: string;
  description?: string;
}

export interface EventTriggerConfig {
  type: "event";
  eventType: string;
  description?: string;
}

export interface WebhookTriggerConfig {
  type: "webhook";
  path: string;
  method?: string;
  auth?: string;
  description?: string;
}

export interface ManualTriggerConfig {
  type: "manual";
}

export type TriggerConfig =
  | CronTriggerConfig
  | EventTriggerConfig
  | WebhookTriggerConfig
  | ManualTriggerConfig;

export interface RetryConfig {
  maxAttempts: number;
  backoff: BackoffType;
  initialDelay: number; // ms
  maxDelay: number; // ms
  alertEmail?: string;
}

export interface AlertConfig {
  alertEmail: string;
}

export type FailureConfig = RetryConfig | AlertConfig | Record<string, never>;

/** Full contract definition */
export interface ContractV2Definition {
  name: string;
  version: string;
  description?: string;
  targetKata: string;
  targetKataVersion: string;
  parameters: Record<string, unknown>;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  onFailureAction: FailureAction;
  onFailureConfig?: FailureConfig;
  enabled: boolean;
  author?: string;
}

/** Database row for contracts v2 */
export interface ContractV2Row {
  id: number;
  name: string;
  version: string;
  description: string | null;
  target_kata: string;
  target_kata_version: string;
  parameters: string | null; // JSON
  trigger_type: string;
  trigger_config: string; // JSON
  on_failure_action: string;
  on_failure_config: string | null; // JSON
  enabled: number; // 0 or 1
  created_at: number;
  updated_at: number;
  author: string | null;
  last_executed_at: number | null;
  next_scheduled_at: number | null;
  execution_count: number;
}

/** Filters for listing contracts */
export interface ContractListFilters {
  enabled?: boolean;
  triggerType?: TriggerType;
  kata?: string;
  sort?: "name" | "created" | "next_run";
  limit?: number;
}

// ── Tasks v2 ──────────────────────────────────────────────────────────────────

export type TaskV2Status = "pending" | "running" | "completed" | "failed" | "canceled";

/** Database row for tasks v2 */
export interface TaskV2Row {
  id: number;
  task_id: string; // tsk_abc123
  source_contract: string | null;
  source_kata: string;
  source_kata_version: string;
  status: TaskV2Status;
  started_at: number | null;
  completed_at: number | null;
  duration: number | null;
  output: string | null; // JSON
  error: string | null;
  error_phase: string | null;
  created_at: number;
  updated_at: number;
}

export type PhaseStatus = "pending" | "running" | "completed" | "failed";

/** Database row for task phases */
export interface TaskPhaseRow {
  id: number;
  task_id: string;
  phase_name: string;
  phase_type: string | null; // 'sequential' | 'parallel'
  status: PhaseStatus;
  started_at: number | null;
  completed_at: number | null;
  duration: number | null;
  technique_name: string | null;
  skill_name: string | null;
  tool_name: string | null;
  output: string | null; // JSON
  error: string | null;
}

/** Filters for listing tasks */
export interface TaskListFilters {
  status?: TaskV2Status;
  kata?: string;
  contract?: string;
  limit?: number;
}
