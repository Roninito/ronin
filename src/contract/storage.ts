/**
 * Contract Storage & Registry — Phase 7
 *
 * Manages contract persistence and querying
 */

import type { AgentAPI } from "../types/index.js";
import type { Contract, ContractAST, ContractRow } from "./types.js";

/**
 * Contract Storage - database persistence
 */
export class ContractStorage {
  constructor(private api: AgentAPI) {}

  /**
   * Create migration SQL
   */
  static migration = `
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT NOT NULL,
      kata_name TEXT NOT NULL,
      kata_version TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      
      UNIQUE(name, version),
      INDEX idx_active (active),
      INDEX idx_trigger (trigger_type, active),
      INDEX idx_kata (kata_name, kata_version)
    );
  `;

  /**
   * Save contract
   */
  async create(contract: Omit<Contract, "id" | "createdAt" | "updatedAt">): Promise<Contract> {
    const id = this.generateId();
    const now = Date.now();

    const row: ContractRow = {
      id,
      name: contract.name,
      version: contract.version,
      trigger_type: contract.trigger.type,
      trigger_value:
        contract.trigger.type === "cron"
          ? contract.trigger.expression
          : contract.trigger.eventType,
      kata_name: contract.kata.name,
      kata_version: contract.kata.version,
      active: contract.active ? 1 : 0,
      description: contract.description,
      created_at: now,
      updated_at: now,
    };

    await this.api.db?.execute?.(
      `INSERT INTO contracts (
        id, name, version, trigger_type, trigger_value,
        kata_name, kata_version, active, description,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.version,
        row.trigger_type,
        row.trigger_value,
        row.kata_name,
        row.kata_version,
        row.active,
        row.description,
        row.created_at,
        row.updated_at,
      ]
    );

    return this.rowToContract(row);
  }

  /**
   * Get contract by ID
   */
  async getById(id: string): Promise<Contract | null> {
    const rows = await this.api.db?.query<ContractRow>(
      "SELECT * FROM contracts WHERE id = ?",
      [id]
    );

    if (!rows || rows.length === 0) return null;
    return this.rowToContract(rows[0]);
  }

  /**
   * Get all active contracts
   */
  async getActive(): Promise<Contract[]> {
    const rows = await this.api.db?.query<ContractRow>(
      "SELECT * FROM contracts WHERE active = 1 ORDER BY created_at DESC"
    );

    if (!rows) return [];
    return rows.map((row) => this.rowToContract(row));
  }

  /**
   * Get contracts by trigger type
   */
  async getByTrigger(triggerType: "cron" | "event"): Promise<Contract[]> {
    const rows = await this.api.db?.query<ContractRow>(
      "SELECT * FROM contracts WHERE trigger_type = ? AND active = 1",
      [triggerType]
    );

    if (!rows) return [];
    return rows.map((row) => this.rowToContract(row));
  }

  /**
   * Get contracts for a kata
   */
  async getByKata(kataName: string, kataVersion: string): Promise<Contract[]> {
    const rows = await this.api.db?.query<ContractRow>(
      "SELECT * FROM contracts WHERE kata_name = ? AND kata_version = ? ORDER BY created_at DESC",
      [kataName, kataVersion]
    );

    if (!rows) return [];
    return rows.map((row) => this.rowToContract(row));
  }

  /**
   * Update contract
   */
  async update(id: string, updates: Partial<Contract>): Promise<void> {
    const now = Date.now();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.active !== undefined) {
      fields.push("active = ?");
      values.push(updates.active ? 1 : 0);
    }

    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }

    if (fields.length === 0) return;

    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);

    await this.api.db?.execute?.(
      `UPDATE contracts SET ${fields.join(", ")} WHERE id = ?`,
      values
    );
  }

  /**
   * Delete contract
   */
  async delete(id: string): Promise<void> {
    await this.api.db?.execute?.(
      "DELETE FROM contracts WHERE id = ?",
      [id]
    );
  }

  /**
   * Convert row to contract
   */
  private rowToContract(row: ContractRow): Contract {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      trigger:
        row.trigger_type === "cron"
          ? {
              type: "cron",
              expression: row.trigger_value,
            }
          : {
              type: "event",
              eventType: row.trigger_value,
            },
      kata: {
        name: row.kata_name,
        version: row.kata_version,
      },
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      description: row.description,
    };
  }

  /**
   * Generate contract ID
   */
  private generateId(): string {
    return `contract-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

/**
 * Contract Registry - high-level API
 */
export class ContractRegistry {
  private storage: ContractStorage;

  constructor(private api: AgentAPI) {
    this.storage = new ContractStorage(api);
  }

  /**
   * Register a contract from AST
   */
  async register(ast: ContractAST): Promise<Contract> {
    // Verify kata exists (should exist before contract)
    // TODO: verify with KataRegistry

    const contract = await this.storage.create({
      name: ast.name,
      version: ast.version,
      trigger: ast.trigger,
      kata: ast.kata,
      active: true,
      description: `Contract ${ast.name} v${ast.version}`,
    });

    return contract;
  }

  /**
   * Get all active contracts
   */
  async getActive(): Promise<Contract[]> {
    return this.storage.getActive();
  }

  /**
   * Get contracts by trigger type
   */
  async getByTrigger(triggerType: "cron" | "event"): Promise<Contract[]> {
    return this.storage.getByTrigger(triggerType);
  }

  /**
   * Get contract by ID
   */
  async getById(id: string): Promise<Contract | null> {
    return this.storage.getById(id);
  }

  /**
   * Deactivate contract (don't execute)
   */
  async deactivate(id: string): Promise<void> {
    await this.storage.update(id, { active: false });
  }

  /**
   * Activate contract
   */
  async activate(id: string): Promise<void> {
    await this.storage.update(id, { active: true });
  }
}
