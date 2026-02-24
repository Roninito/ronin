/**
 * Database Migration for Phase 7: Kata + Task Tables
 *
 * Run this migration when initializing the database.
 * Add to your DB initialization script.
 */

export const KATA_MIGRATIONS = `
-- Kata Definitions Table
CREATE TABLE IF NOT EXISTS kata_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source_code TEXT NOT NULL,
  compiled_graph TEXT NOT NULL,
  required_skills TEXT NOT NULL,
  checksum TEXT NOT NULL,
  ontology_node_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kata_name_version 
  ON kata_definitions(name, version);

-- Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kata_name TEXT NOT NULL,
  kata_version TEXT NOT NULL,
  state TEXT NOT NULL,
  current_phase TEXT NOT NULL,
  variables TEXT,
  parent_task_id TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_task_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_task_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_task_kata ON tasks(kata_name, kata_version);
`;

/**
 * Execute migration against a database connection
 */
export async function runKataMigrations(db: any): Promise<void> {
  // Split into individual statements and execute
  const statements = KATA_MIGRATIONS.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch (error) {
      console.error('Migration error:', statement, error);
      throw error;
    }
  }
}
