/**
 * Database Migrations — Artifacts
 *
 * Persistent, cross-chat project containers (see docs on the Artifacts feature).
 * Uses idempotent CREATE TABLE IF NOT EXISTS, following the pattern in
 * src/database/migrations.ts (ENGINE_MIGRATIONS / runEngineMigrations).
 */

export const ARTIFACT_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  owner TEXT NOT NULL DEFAULT 'ronin',
  state TEXT NOT NULL DEFAULT 'INITIALIZED',
  completion_threshold INTEGER NOT NULL DEFAULT 85,
  estimated_completion TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  scheduling_enabled INTEGER NOT NULL DEFAULT 1,
  next_check_in TEXT,
  last_updated TEXT NOT NULL,
  backoff_multiplier REAL NOT NULL DEFAULT 1.5,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3
);

CREATE INDEX IF NOT EXISTS idx_artifacts_state ON artifacts(state);
CREATE INDEX IF NOT EXISTS idx_artifacts_next_check_in ON artifacts(next_check_in);

CREATE TABLE IF NOT EXISTS artifact_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL,
  category TEXT NOT NULL,
  target INTEGER NOT NULL DEFAULT 0,
  collected INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  UNIQUE(artifact_id, category)
);

CREATE INDEX IF NOT EXISTS idx_artifact_assets_artifact ON artifact_assets(artifact_id);

CREATE TABLE IF NOT EXISTS artifact_asset_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  source TEXT NOT NULL,
  license TEXT,
  downloaded_at TEXT NOT NULL,
  metadata TEXT,
  stored_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_artifact_asset_records_artifact ON artifact_asset_records(artifact_id);

CREATE TABLE IF NOT EXISTS artifact_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_logs_artifact ON artifact_logs(artifact_id, timestamp);
`;

/**
 * Run all artifact migrations against a db instance.
 * Compatible with both Bun SQLite (db.exec) and the DutyAPI (db.execute).
 */
export async function runArtifactMigrations(db: any): Promise<void> {
  const statements = ARTIFACT_MIGRATIONS.split(";")
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
        console.error("[artifact-migrations] Error:", error.message);
        throw error;
      }
    }
  }
}
