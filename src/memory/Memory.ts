import { Database } from "bun:sqlite";
import type { Memory, MemoryRow } from "./types.js";
import { applyPerformancePragmas } from "../database/pragmas.js";

export class MemoryStore {
  private db: Database;
  /** False if FTS5 setup failed (older SQLite build) — search() falls back to LIKE. */
  private ftsAvailable = true;

  constructor(dbPath: string = "ronin.db") {
    this.db = new Database(dbPath);
    applyPerformancePragmas(this.db, dbPath);
    this.initializeSchema();
  }

  private async runWithBusyRetry(run: () => void, maxAttempts = 4): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        run();
        return;
      } catch (error) {
        const err = error as { code?: string; errno?: number; message?: string };
        const busy = err.code === "SQLITE_BUSY" || err.errno === 5 || String(err.message || "").includes("database is locked");
        if (!busy || attempt === maxAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
      }
    }
  }

  private initializeSchema(): void {
    // Memories table - stores key-value pairs with optional text and metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE,
        value TEXT NOT NULL,
        text TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Conversations table - stores conversation history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        duty_name TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Duty state table - stores duty execution state
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS duty_state (
        duty_name TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        metadata TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_duty ON conversations(duty_name);
      CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
    `);

    // Migration: Rename agent_name → duty_name (if old columns exist)
    this.migrateAgentToDuty();

    this.initializeFts();
  }

  /**
   * search() used to be `WHERE text LIKE '%query%' OR value LIKE '%query%'`
   * — a leading-wildcard LIKE can't use an index, so it full-table-scanned
   * both columns (the unclamped `value`, which can hold large JSON blobs)
   * on every call, including from the always-available local.memory.search
   * chat tool. FTS5 replaces that with a real inverted index, kept in sync
   * via triggers rather than rebuilt per query.
   */
  private initializeFts(): void {
    try {
      const alreadyExists = (this.db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
      ).all() as Array<{ name: string }>).length > 0;

      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          text, value,
          content='memories',
          content_rowid='rowid',
          tokenize='porter unicode61'
        );
      `);

      if (!alreadyExists) {
        // Backfill rows that existed before the FTS index did — only needed once,
        // guarded by alreadyExists so re-inserting on every startup never happens
        // (which would violate FTS5's rowid uniqueness).
        this.db.exec(`INSERT INTO memories_fts(rowid, text, value) SELECT rowid, text, value FROM memories;`);
      }

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, text, value) VALUES (new.rowid, new.text, new.value);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, value) VALUES('delete', old.rowid, old.text, old.value);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, value) VALUES('delete', old.rowid, old.text, old.value);
          INSERT INTO memories_fts(rowid, text, value) VALUES (new.rowid, new.text, new.value);
        END;
      `);
    } catch (error) {
      // FTS5 unavailable in this SQLite build — fall back to the old LIKE scan
      // rather than fail the whole memory system over a search optimization.
      this.ftsAvailable = false;
      console.warn(`[MemoryStore] FTS5 unavailable, falling back to LIKE search: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Turn free text into a safe FTS5 MATCH query: each token individually
   *  phrase-quoted (implicit AND between them), so user input can never
   *  inject FTS5 query syntax (unbalanced quotes, NEAR/AND/OR, column
   *  filters, etc.) — matches the old search's "all these words" intent. */
  private toFtsQuery(query: string): string {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
  }

  /**
   * Migrate old agent_name columns to duty_name
   */
  private migrateAgentToDuty(): void {
    try {
      // Check if conversations table has agent_name column
      const tableInfo = this.db.query("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
      const hasAgentName = tableInfo.some((col) => col.name === "agent_name");
      
      if (hasAgentName) {
        // SQLite doesn't support DROP COLUMN, so we recreate the table
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS conversations_new (
            id TEXT PRIMARY KEY,
            duty_name TEXT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at INTEGER NOT NULL
          )
        `);
        
        this.db.exec(`
          INSERT INTO conversations_new (id, duty_name, role, content, metadata, created_at)
          SELECT id, agent_name, role, content, metadata, created_at FROM conversations
        `);
        
        this.db.exec(`DROP TABLE conversations`);
        this.db.exec(`ALTER TABLE conversations_new RENAME TO conversations`);
        
        // Recreate index
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_duty ON conversations(duty_name)`);
      }
    } catch {
      // Migration failed - table might not have data yet, that's OK
    }

    try {
      // Check if agent_state table exists (old name for duty_state)
      const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_state'").all() as Array<{ name: string }>;
      
      if (tables.length > 0) {
        // Migrate agent_state → duty_state
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS duty_state_new (
            duty_name TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            metadata TEXT,
            updated_at INTEGER NOT NULL
          )
        `);
        
        this.db.exec(`
          INSERT INTO duty_state_new (duty_name, state, metadata, updated_at)
          SELECT agent_name, state, metadata, updated_at FROM agent_state
        `);
        
        this.db.exec(`DROP TABLE agent_state`);
        this.db.exec(`DROP TABLE IF EXISTS duty_state`);
        this.db.exec(`ALTER TABLE duty_state_new RENAME TO duty_state`);
      }
    } catch {
      // Migration failed - that's OK
    }
  }

  /**
   * Store a key-value pair in memory
   */
  async store(key: string, value: unknown): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const valueJson = JSON.stringify(value);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, key, value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    await this.runWithBusyRetry(() => {
      stmt.run(id, key, valueJson, now, now);
    });
  }

  /**
   * Retrieve a value by key
   */
  async retrieve(key: string): Promise<unknown> {
    const stmt = this.db.prepare(`
      SELECT value FROM memories WHERE key = ?
    `);

    const row = stmt.get(key) as { value: string } | undefined;
    if (!row) {
      return null;
    }

    return JSON.parse(row.value);
  }

  /**
   * Search memories by text content. Uses the FTS5 index (relevance-ranked,
   * real tokenized matching) when available, falling back to the original
   * LIKE scan only if FTS5 setup failed at startup.
   */
  async search(query: string, limit: number = 10): Promise<Memory[]> {
    if (!query.trim()) return [];

    let rows: MemoryRow[];
    if (this.ftsAvailable) {
      const ftsQuery = this.toFtsQuery(query);
      if (!ftsQuery) return [];
      const stmt = this.db.prepare(`
        SELECT m.id, m.key, substr(m.value, 1, 4000) AS value, m.text, m.metadata, m.created_at, m.updated_at
        FROM memories_fts f
        JOIN memories m ON m.rowid = f.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      try {
        rows = stmt.all(ftsQuery, limit) as MemoryRow[];
      } catch {
        // Malformed-enough query to still trip FTS5 despite quoting (e.g. a
        // lone `"`), or the index is out of sync — fail open to LIKE rather
        // than surface a search error to the caller.
        rows = this.searchByLike(query, limit);
      }
    } else {
      rows = this.searchByLike(query, limit);
    }

    return rows.map((row) => ({
      id: row.id,
      key: row.key || undefined,
      // Keep search lightweight: return preview string instead of parsing full JSON payloads
      value: row.value,
      text: row.text || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  private searchByLike(query: string, limit: number): MemoryRow[] {
    const stmt = this.db.prepare(`
      SELECT id, key, substr(value, 1, 4000) AS value, text, metadata, created_at, updated_at
      FROM memories
      WHERE text LIKE ? OR value LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const searchPattern = `%${query}%`;
    return stmt.all(searchPattern, searchPattern, limit) as MemoryRow[];
  }

  /**
   * Add context text to memory
   */
  async addContext(text: string, metadata?: Record<string, unknown>): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, value, text, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    await this.runWithBusyRetry(() => {
      stmt.run(id, JSON.stringify({ text }), text, metadataJson, now, now);
    });
    return id;
  }

  /**
   * Get recent memories
   */
  async getRecent(limit: number = 10): Promise<Memory[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as MemoryRow[];
    return rows.map(this.rowToMemory);
  }

  /**
   * Get memories by metadata
   */
  async getByMetadata(metadata: Record<string, unknown>): Promise<Memory[]> {
    // For simplicity, we'll search for metadata as JSON string
    // This could be optimized with a JSON column type if needed
    const metadataJson = JSON.stringify(metadata);
    const searchPattern = `%${metadataJson}%`;

    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE metadata LIKE ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(searchPattern) as MemoryRow[];
    return rows.map(this.rowToMemory);
  }

  /**
   * Add conversation entry
   */
  async addConversation(
    dutyName: string,
    role: "system" | "user" | "assistant",
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, duty_name, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    await this.runWithBusyRetry(() => {
      stmt.run(id, dutyName, role, content, metadataJson, now);
    });
    return id;
  }

  /**
   * Get conversation history for a duty
   */
  async getConversations(dutyName: string, limit: number = 50): Promise<Array<{
    role: string;
    content: string;
    createdAt: Date;
  }>> {
    const stmt = this.db.prepare(`
      SELECT role, content, created_at
      FROM conversations
      WHERE duty_name = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(dutyName, limit) as Array<{
      role: string;
      content: string;
      created_at: number;
    }>;

    return rows.map(row => ({
      role: row.role,
      content: row.content,
      createdAt: new Date(row.created_at),
    })).reverse(); // Reverse to get chronological order
  }

  /**
   * Store duty state
   */
  async setDutyState(dutyName: string, state: unknown, metadata?: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    const stateJson = JSON.stringify(state);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO duty_state (duty_name, state, metadata, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    await this.runWithBusyRetry(() => {
      stmt.run(dutyName, stateJson, metadataJson, now);
    });
  }

  /**
   * Get duty state
   */
  async getDutyState(dutyName: string): Promise<unknown> {
    const stmt = this.db.prepare(`
      SELECT state FROM duty_state WHERE duty_name = ?
    `);

    const row = stmt.get(dutyName) as { state: string } | undefined;
    if (!row) {
      return null;
    }

    return JSON.parse(row.state);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Convert database row to Memory object
   */
  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      key: row.key || undefined,
      value: JSON.parse(row.value),
      text: row.text || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
