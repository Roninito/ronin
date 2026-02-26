/**
 * Database Migrations — Techniques, enhanced Katas, Contracts, Tasks
 *
 * New tables are additive — existing kata_definitions, tasks, and contracts
 * tables are left intact for backward compatibility.
 *
 * Usage: call runTechniqueMigrations(db) during app initialization.
 */

export const TECHNIQUE_MIGRATIONS = `
-- ── Techniques ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS techniques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL DEFAULT 'v1',
  description TEXT NOT NULL,
  category TEXT,
  tags TEXT,
  type TEXT NOT NULL,
  definition TEXT NOT NULL,
  input_schema TEXT,
  output_schema TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  author TEXT,
  deprecated INTEGER NOT NULL DEFAULT 0,
  replacement_technique TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  average_duration INTEGER
);

CREATE INDEX IF NOT EXISTS idx_techniques_category ON techniques(category);
CREATE INDEX IF NOT EXISTS idx_techniques_deprecated ON techniques(deprecated);

CREATE TABLE IF NOT EXISTS technique_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technique_name TEXT NOT NULL,
  depends_on_tool TEXT,
  depends_on_skill TEXT,
  UNIQUE(technique_name, depends_on_tool, depends_on_skill)
);

CREATE INDEX IF NOT EXISTS idx_technique_deps ON technique_dependencies(technique_name);

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
  depends_on_technique TEXT,
  depends_on_skill TEXT,
  depends_on_tool TEXT,
  UNIQUE(kata_name, depends_on_technique, depends_on_skill, depends_on_tool)
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
  technique_name TEXT,
  skill_name TEXT,
  tool_name TEXT,
  output TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_phases_task ON task_phases(task_id);
CREATE INDEX IF NOT EXISTS idx_task_phases_status ON task_phases(status);
`;

/**
 * Run all technique/kata/contract/task migrations against a db instance.
 * Compatible with both Bun SQLite (db.exec) and the AgentAPI (db.execute).
 */
export async function runTechniqueMigrations(db: any): Promise<void> {
  const statements = TECHNIQUE_MIGRATIONS.split(";")
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
      // Skip "already exists" errors (SQLite returns these for IF NOT EXISTS on some paths)
      if (!error.message?.includes("already exists")) {
        console.error("[technique-migrations] Error:", error.message);
        throw error;
      }
    }
  }
}
