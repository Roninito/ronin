/**
 * Duty Proposal Storage
 *
 * Persists AI-drafted duty TypeScript (src/duty/propose.ts) that is awaiting
 * human approval — via a chat card (duties/chatty.ts) or the /duties/review
 * dashboard page. Nothing is written to the duties directory until a
 * proposal is approved. Mirrors src/contract/proposal-storage.ts exactly.
 */

import type { DutyAPI } from "../types/index.js";
import { runEngineMigrations } from "../database/migrations.js";

export type DutyProposalStatus = "pending" | "approved" | "refused" | "superseded";

export interface DutyProposalRow {
  id: string;
  chat_id: string | null;
  intent: string;
  duty_name: string;
  code: string;
  preview: string;
  status: DutyProposalStatus;
  supersedes_id: string | null;
  created_at: number;
  decided_at: number | null;
}

export interface DutyProposalRecord {
  id: string;
  chatId?: string;
  intent: string;
  dutyName: string;
  code: string;
  preview: string;
  status: DutyProposalStatus;
  supersedesId?: string;
  createdAt: number;
  decidedAt: number | null;
}

function hydrate(row: DutyProposalRow): DutyProposalRecord {
  return {
    id: row.id,
    chatId: row.chat_id ?? undefined,
    intent: row.intent,
    dutyName: row.duty_name,
    code: row.code,
    preview: row.preview,
    status: row.status,
    supersedesId: row.supersedes_id ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class DutyProposalStorage {
  constructor(private api: DutyAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runEngineMigrations(db);
  }

  async create(input: {
    chatId?: string;
    intent: string;
    dutyName: string;
    code: string;
    preview: string;
    supersedesId?: string;
  }): Promise<DutyProposalRecord> {
    const id = `dprop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();

    await this.api.db?.execute?.(
      `INSERT INTO duty_proposals (
        id, chat_id, intent, duty_name, code, preview, status, supersedes_id, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
      [
        id,
        input.chatId ?? null,
        input.intent,
        input.dutyName,
        input.code,
        input.preview,
        input.supersedesId ?? null,
        now,
      ]
    );

    if (input.supersedesId) {
      await this.decide(input.supersedesId, "superseded");
    }

    return {
      id,
      chatId: input.chatId,
      intent: input.intent,
      dutyName: input.dutyName,
      code: input.code,
      preview: input.preview,
      status: "pending",
      supersedesId: input.supersedesId,
      createdAt: now,
      decidedAt: null,
    };
  }

  async getById(id: string): Promise<DutyProposalRecord | null> {
    const rows = await this.api.db?.query<DutyProposalRow>(
      `SELECT * FROM duty_proposals WHERE id = ?`,
      [id]
    );
    const row = rows?.[0];
    return row ? hydrate(row) : null;
  }

  async listPending(): Promise<DutyProposalRecord[]> {
    const rows = await this.api.db?.query<DutyProposalRow>(
      `SELECT * FROM duty_proposals WHERE status = 'pending' ORDER BY created_at DESC`
    ) ?? [];
    return rows.map(hydrate);
  }

  /**
   * Mark a proposal's outcome. `decidedAt` is only set for terminal human
   * decisions (approved/refused) — a proposal marked `superseded` by a newer
   * revision keeps its original decided_at state (null, since no one acted
   * on it directly). Mirrors ContractProposalStorage.decide exactly.
   *
   * `finalDutyName`: the AI-derived name is a first guess; the human can
   * rename it at approval time (see duties/duty-executor.ts), so the stored
   * record should reflect what the duty is actually called, not the guess.
   */
  async decide(id: string, status: Exclude<DutyProposalStatus, "pending">, finalDutyName?: string): Promise<void> {
    const decidedAt = status === "superseded" ? null : Date.now();
    if (finalDutyName) {
      await this.api.db?.execute?.(
        `UPDATE duty_proposals SET status = ?, decided_at = ?, duty_name = ? WHERE id = ?`,
        [status, decidedAt, finalDutyName, id]
      );
    } else {
      await this.api.db?.execute?.(
        `UPDATE duty_proposals SET status = ?, decided_at = ? WHERE id = ?`,
        [status, decidedAt, id]
      );
    }
  }
}
