import { Database } from "bun:sqlite";
import type { Transaction } from "../types/api.js";

export class DatabaseAPI {
  private db: Database;

  constructor(dbPath: string = "ronin.db") {
    this.db = new Database(dbPath);
  }

  /**
   * Execute a SELECT query
   */
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Execute a non-SELECT query (INSERT, UPDATE, DELETE, etc.)
   */
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN TRANSACTION");
    try {
      const tx: Transaction = {
        query: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
          const stmt = this.db.prepare(sql);
          return stmt.all(...params) as T[];
        },
        execute: async (sql: string, params: unknown[] = []): Promise<void> => {
          const stmt = this.db.prepare(sql);
          stmt.run(...params);
        },
      };

      const result = await fn(tx);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Get the underlying database instance
   */
  getDatabase(): Database {
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

