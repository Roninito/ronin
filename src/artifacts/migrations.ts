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
 * Columns added to artifact_asset_records after its original CREATE TABLE
 * shipped. `CREATE TABLE IF NOT EXISTS` is a no-op against a table that
 * already exists, so a column added here later never reaches an install that
 * created the table before this list grew — this backfill is what actually
 * gets it there. Add new columns here (name -> full column-def SQL) rather
 * than only in ARTIFACT_MIGRATIONS above.
 */
const ARTIFACT_ASSET_RECORD_COLUMN_BACKFILL: Record<string, string> = {
  stored_path: "stored_path TEXT",
};

async function getColumnNames(db: any, table: string): Promise<string[]> {
  try {
    if (typeof db.exec === "function" && typeof db.query === "function") {
      return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
    }
    if (typeof db.query === "function") {
      const rows = await db.query(`PRAGMA table_info(${table})`);
      return (rows as Array<{ name: string }>).map((r) => r.name);
    }
  } catch {
    // Table may not exist yet — the CREATE TABLE IF NOT EXISTS pass handles that case.
  }
  return [];
}

async function backfillArtifactAssetRecordColumns(db: any): Promise<void> {
  const existing = await getColumnNames(db, "artifact_asset_records");
  if (existing.length === 0) return; // table doesn't exist yet (fresh install) — CREATE TABLE already has every column

  for (const [column, columnDef] of Object.entries(ARTIFACT_ASSET_RECORD_COLUMN_BACKFILL)) {
    if (existing.includes(column)) continue;
    const statement = `ALTER TABLE artifact_asset_records ADD COLUMN ${columnDef}`;
    try {
      if (typeof db.exec === "function") {
        db.exec(statement);
      } else if (typeof db.execute === "function") {
        await db.execute(statement);
      }
      console.log(`[artifact-migrations] Backfilled missing column: artifact_asset_records.${column}`);
    } catch (error: any) {
      if (!error.message?.includes("duplicate column")) {
        console.error("[artifact-migrations] Backfill error:", error.message);
        throw error;
      }
    }
  }
}

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

  await backfillArtifactAssetRecordColumns(db);
}
