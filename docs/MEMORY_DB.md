# Ronin Memory Database (ronin.db)

`ronin.db` is the core memory database used by Ronin's `MemoryStore`. It lives in the project root by default and stores shared state and history for agents.

## What It Stores

- **memories**: key/value data with optional text and metadata
- **conversations**: per-agent conversation history (role, content, metadata)
- **agent_state**: per-agent persisted state blobs

## Schema (created automatically)

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  value TEXT NOT NULL,
  text TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_name TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_state (
  agent_name TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  metadata TEXT,
  updated_at INTEGER NOT NULL
);
```

## Notes

- `ronin.db` is separate from Fishy data files, which live under `~/.ronin/data`.
- You can change the database file path via `--db-path` when running the CLI.
