/**
 * Database Migrations — Tasking Executor
 *
 * Additive schema for multi-executor coding tasks on top of TodoAgent's
 * existing Kanban tables (kanban_boards/columns/cards/dependencies/
 * command_queue — created in duties/tasking.ts's initializeDatabase()).
 * Follows the same idempotent statement-split pattern as
 * src/database/migrations.ts / src/artifacts/migrations.ts.
 */

const ALTER_STATEMENTS = `
ALTER TABLE kanban_command_queue ADD COLUMN executor TEXT DEFAULT 'ronin';
ALTER TABLE kanban_command_queue ADD COLUMN worktree_path TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN task_branch TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN base_branch TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN session_id TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN repo_path TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN source_channel TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN source_user TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN approved INTEGER DEFAULT 1;
ALTER TABLE kanban_command_queue ADD COLUMN from_ref TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN round INTEGER DEFAULT 1;
ALTER TABLE kanban_boards ADD COLUMN default_repo TEXT;
ALTER TABLE kanban_boards ADD COLUMN default_branch TEXT DEFAULT 'main';
`;

export const TASKING_EXECUTOR_MIGRATIONS = `
-- ── Diffs (Review stage). Round columns (from_ref/to_ref/round) are present
-- from day one but only exercised once round-scoped diffs (spec §9.2) land ──

CREATE TABLE IF NOT EXISTS kanban_card_diffs (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL,
  command_id    TEXT NOT NULL,
  session_id    TEXT,
  patch         TEXT NOT NULL,
  files_changed TEXT,
  from_ref      TEXT,
  to_ref        TEXT,
  round         INTEGER DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kanban_card_diffs_card ON kanban_card_diffs(card_id);
CREATE INDEX IF NOT EXISTS idx_kanban_card_diffs_command ON kanban_card_diffs(command_id);

-- ── Live execution feed events ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kanban_command_events (
  id          TEXT PRIMARY KEY,
  command_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kanban_command_events_command ON kanban_command_events(command_id, seq);

-- ── Executor outcomes (data collection only — no routing policy attached) ──

CREATE TABLE IF NOT EXISTS executor_outcomes (
  id            TEXT PRIMARY KEY,
  command_id    TEXT NOT NULL,
  executor      TEXT NOT NULL,
  task_features TEXT NOT NULL,
  outcome       TEXT NOT NULL,
  rounds        INTEGER,
  attempts      INTEGER,
  cost_tokens   INTEGER,
  wall_ms       INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executor_outcomes_executor ON executor_outcomes(executor);
`;

function isBenignSchemaError(message: string | undefined): boolean {
  if (!message) return false;
  return message.includes("already exists") || message.includes("duplicate column name");
}

/**
 * Run ALTER TABLE statements against existing TodoAgent tables. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so re-running is tolerated via the
 * "duplicate column name" error message instead.
 */
async function runAlterStatements(db: any): Promise<void> {
  const statements = ALTER_STATEMENTS.split(";")
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
      if (!isBenignSchemaError(error.message)) {
        console.error("[tasking-migrations] ALTER error:", error.message);
        throw error;
      }
    }
  }
}

/**
 * Run all tasking-executor migrations (new columns + new tables) against a
 * db instance. Compatible with both Bun SQLite (db.exec) and the DutyAPI
 * (db.execute). Call once from TodoAgent.initializeDatabase(), after the
 * existing kanban_* tables are created.
 */
export async function runTaskingExecutorMigrations(db: any): Promise<void> {
  await runAlterStatements(db);

  const statements = TASKING_EXECUTOR_MIGRATIONS.split(";")
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
      if (!isBenignSchemaError(error.message)) {
        console.error("[tasking-migrations] Error:", error.message);
        throw error;
      }
    }
  }
}
