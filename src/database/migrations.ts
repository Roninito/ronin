/**
 * Database Migrations — Engine Tables (Katas, Contracts, Tasks)
 *
 * Creates the v2 schema tables for the execution engine.
 * Uses idempotent CREATE TABLE IF NOT EXISTS for safety.
 */

export const ENGINE_MIGRATIONS = `
-- ── Katas (v2 — richer schema alongside existing kata_definitions) ───────────

CREATE TABLE IF NOT EXISTS katas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL DEFAULT 'v1',
  description TEXT NOT NULL,
  category TEXT,
  tags TEXT,
  definition TEXT NOT NULL,
  input_schema TEXT,
  output_schema TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  author TEXT,
  deprecated INTEGER NOT NULL DEFAULT 0,
  replacement_kata TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  average_duration INTEGER
);

CREATE INDEX IF NOT EXISTS idx_katas_category ON katas(category);
CREATE INDEX IF NOT EXISTS idx_katas_deprecated ON katas(deprecated);

CREATE TABLE IF NOT EXISTS kata_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kata_name TEXT NOT NULL,
  depends_on_skill TEXT,
  depends_on_tool TEXT,
  UNIQUE(kata_name, depends_on_skill, depends_on_tool)
);

CREATE INDEX IF NOT EXISTS idx_kata_deps ON kata_dependencies(kata_name);

-- ── Contracts (v2 — enhanced schema, new table) ──────────────────────────────

CREATE TABLE IF NOT EXISTS contracts_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL DEFAULT 'v1',
  description TEXT,
  target_kata TEXT NOT NULL,
  target_kata_version TEXT NOT NULL DEFAULT 'v1',
  parameters TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  on_failure_action TEXT NOT NULL DEFAULT 'ignore',
  on_failure_config TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  author TEXT,
  last_executed_at INTEGER,
  next_scheduled_at INTEGER,
  execution_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_contracts_v2_enabled ON contracts_v2(enabled);
CREATE INDEX IF NOT EXISTS idx_contracts_v2_next_run ON contracts_v2(next_scheduled_at);
CREATE INDEX IF NOT EXISTS idx_contracts_v2_target ON contracts_v2(target_kata);

-- ── Contract Proposals (AI-drafted contracts awaiting approval) ──────────────

CREATE TABLE IF NOT EXISTS contract_proposals (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  intent TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  kata_dsl TEXT,
  preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  supersedes_id TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_contract_proposals_status ON contract_proposals(status);
CREATE INDEX IF NOT EXISTS idx_contract_proposals_chat ON contract_proposals(chat_id);

-- ── Workflow Proposals (AI-drafted workflow markdown awaiting approval) ──────

CREATE TABLE IF NOT EXISTS workflow_proposals (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  intent TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  supersedes_id TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_workflow_proposals_status ON workflow_proposals(status);
CREATE INDEX IF NOT EXISTS idx_workflow_proposals_chat ON workflow_proposals(chat_id);

-- ── Duty Proposals (AI-drafted duty TypeScript awaiting approval) ────────────

CREATE TABLE IF NOT EXISTS duty_proposals (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  intent TEXT NOT NULL,
  duty_name TEXT NOT NULL,
  code TEXT NOT NULL,
  preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  supersedes_id TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_duty_proposals_status ON duty_proposals(status);
CREATE INDEX IF NOT EXISTS idx_duty_proposals_chat ON duty_proposals(chat_id);

-- ── Graph snapshots (canvas editor's derived topology graph) ─────────────────
-- Single-row store: graph-keeper fully re-derives and overwrites on every
-- trigger rather than diffing incrementally (see design plan §3 step 2).

CREATE TABLE IF NOT EXISTS graph_snapshots (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  graph_json TEXT NOT NULL,
  derived_at INTEGER NOT NULL
);

-- ── Tasks (v2 — enhanced schema with task_id and source tracking) ────────────

CREATE TABLE IF NOT EXISTS tasks_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  source_contract TEXT,
  source_kata TEXT NOT NULL,
  source_kata_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  completed_at INTEGER,
  duration INTEGER,
  output TEXT,
  error TEXT,
  error_phase TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_v2_status ON tasks_v2(status);
CREATE INDEX IF NOT EXISTS idx_tasks_v2_source_kata ON tasks_v2(source_kata);
CREATE INDEX IF NOT EXISTS idx_tasks_v2_source_contract ON tasks_v2(source_contract);
CREATE INDEX IF NOT EXISTS idx_tasks_v2_created ON tasks_v2(created_at);

-- ── Task Phases ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  phase_name TEXT NOT NULL,
  phase_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  completed_at INTEGER,
  duration INTEGER,
  skill_name TEXT,
  tool_name TEXT,
  output TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_phases_task ON task_phases(task_id);
CREATE INDEX IF NOT EXISTS idx_task_phases_status ON task_phases(status);
`;

/**
 * Run all engine migrations against a db instance.
 * Compatible with both Bun SQLite (db.exec) and the DutyAPI (db.execute).
 */
export async function runEngineMigrations(db: any): Promise<void> {
  const statements = ENGINE_MIGRATIONS.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    try {
      if (typeof db.exec === "function") {
        db.exec(statement);
      } else if (typeof db.execute === "function") {
        await db.execute(statement);
      }
    } catch (error: any) {
      if (!error.message?.includes("already exists")) {
        console.error("[engine-migrations] Error:", error.message);
        throw error;
      }
    }
  }
}