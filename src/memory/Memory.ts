import { Database } from "bun:sqlite";
import type { Memory, MemoryRow } from "./types.js";

export class MemoryStore {
  private db: Database;

  constructor(dbPath: string = "ronin.db") {
    this.db = new Database(dbPath);
    this.initializeSchema();
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
        agent_name TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Agent state table - stores agent execution state
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_state (
        agent_name TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        metadata TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_name);
      CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
    `);
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

    stmt.run(id, key, valueJson, now, now);
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
   * Search memories by text content (SQL LIKE query)
   */
  async search(query: string, limit: number = 10): Promise<Memory[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE text LIKE ? OR value LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const searchPattern = `%${query}%`;
    const rows = stmt.all(searchPattern, searchPattern, limit) as MemoryRow[];
    return rows.map(this.rowToMemory);
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

    stmt.run(id, JSON.stringify({ text }), text, metadataJson, now, now);
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
    agentName: string,
    role: "system" | "user" | "assistant",
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, agent_name, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, agentName, role, content, metadataJson, now);
    return id;
  }

  /**
   * Get conversation history for an agent
   */
  async getConversations(agentName: string, limit: number = 50): Promise<Array<{
    role: string;
    content: string;
    createdAt: Date;
  }>> {
    const stmt = this.db.prepare(`
      SELECT role, content, created_at
      FROM conversations
      WHERE agent_name = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(agentName, limit) as Array<{
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
   * Store agent state
   */
  async setAgentState(agentName: string, state: unknown, metadata?: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    const stateJson = JSON.stringify(state);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_state (agent_name, state, metadata, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(agentName, stateJson, metadataJson, now);
  }

  /**
   * Get agent state
   */
  async getAgentState(agentName: string): Promise<unknown> {
    const stmt = this.db.prepare(`
      SELECT state FROM agent_state WHERE agent_name = ?
    `);

    const row = stmt.get(agentName) as { state: string } | undefined;
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

