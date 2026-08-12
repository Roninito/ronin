/**
 * Contract Proposal Storage
 *
 * Persists AI-drafted contracts (src/contract/propose.ts) that are awaiting
 * human approval — via a chat card (duties/chatty.ts) or the dashboard
 * /contracts review page. Nothing in ContractStorageV2 is touched until a
 * proposal is approved.
 */

import type { DutyAPI } from "../types/index.js";
import { runEngineMigrations } from "../database/migrations.js";
import type { ContractV2Definition } from "../types/shared.js";

export type ProposalStatus = "pending" | "approved" | "refused" | "superseded";

export interface ContractProposalRow {
  id: string;
  chat_id: string | null;
  intent: string;
  contract_json: string;
  kata_dsl: string | null;
  preview: string;
  status: ProposalStatus;
  supersedes_id: string | null;
  created_at: number;
  decided_at: number | null;
}

export interface ContractProposalRecord {
  id: string;
  chatId?: string;
  intent: string;
  contract: ContractV2Definition;
  kataDsl?: string;
  preview: string;
  status: ProposalStatus;
  supersedesId?: string;
  createdAt: number;
  decidedAt: number | null;
}

function hydrate(row: ContractProposalRow): ContractProposalRecord {
  return {
    id: row.id,
    chatId: row.chat_id ?? undefined,
    intent: row.intent,
    contract: JSON.parse(row.contract_json) as ContractV2Definition,
    kataDsl: row.kata_dsl ?? undefined,
    preview: row.preview,
    status: row.status,
    supersedesId: row.supersedes_id ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class ContractProposalStorage {
  constructor(private api: DutyAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runEngineMigrations(db);
  }

  async create(input: {
    chatId?: string;
    intent: string;
    contract: ContractV2Definition;
    kataDsl?: string;
    preview: string;
    supersedesId?: string;
  }): Promise<ContractProposalRecord> {
    const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();

    await this.api.db?.execute?.(
      `INSERT INTO contract_proposals (
        id, chat_id, intent, contract_json, kata_dsl, preview, status, supersedes_id, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
      [
        id,
        input.chatId ?? null,
        input.intent,
        JSON.stringify(input.contract),
        input.kataDsl ?? null,
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
      contract: input.contract,
      kataDsl: input.kataDsl,
      preview: input.preview,
      status: "pending",
      supersedesId: input.supersedesId,
      createdAt: now,
      decidedAt: null,
    };
  }

  async getById(id: string): Promise<ContractProposalRecord | null> {
    const rows = await this.api.db?.query<ContractProposalRow>(
      `SELECT * FROM contract_proposals WHERE id = ?`,
      [id]
    );
    const row = rows?.[0];
    return row ? hydrate(row) : null;
  }

  async listPending(): Promise<ContractProposalRecord[]> {
    const rows = await this.api.db?.query<ContractProposalRow>(
      `SELECT * FROM contract_proposals WHERE status = 'pending' ORDER BY created_at DESC`
    ) ?? [];
    return rows.map(hydrate);
  }

  /**
   * Mark a proposal's outcome. `decidedAt` is only set for terminal human
   * decisions (approved/refused) — a proposal marked `superseded` by a newer
   * revision keeps its original `decided_at` state (null, since no one acted
   * on it directly).
   */
  /**
   * `finalName`: the AI-derived name is a first guess; the human can rename
   * it at approval time (see duties/contract-executor.ts). When set, this
   * patches contract_json's embedded name too, so a re-read of a decided
   * row reflects what the contract is actually called.
   */
  async decide(id: string, status: Exclude<ProposalStatus, "pending">, finalName?: string): Promise<void> {
    const decidedAt = status === "superseded" ? null : Date.now();
    if (finalName) {
      const existing = await this.getById(id);
      const contractJson = existing ? JSON.stringify({ ...existing.contract, name: finalName }) : undefined;
      if (contractJson) {
        await this.api.db?.execute?.(
          `UPDATE contract_proposals SET status = ?, decided_at = ?, contract_json = ? WHERE id = ?`,
          [status, decidedAt, contractJson, id]
        );
        return;
      }
    }
    await this.api.db?.execute?.(
      `UPDATE contract_proposals SET status = ?, decided_at = ? WHERE id = ?`,
      [status, decidedAt, id]
    );
  }
}
