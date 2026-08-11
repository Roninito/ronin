/**
 * Workflow Proposal Storage
 *
 * Persists AI-drafted workflows (src/workflow/propose.ts) that are awaiting
 * human approval via a chat card (duties/chatty.ts) or the /workflows
 * dashboard. Nothing under workflows/ is touched until a proposal is
 * approved — mirrors src/contract/proposal-storage.ts exactly, swapping the
 * compiled-contract payload for a plain markdown `content` string.
 */

import type { DutyAPI } from "../types/index.js";
import { runEngineMigrations } from "../database/migrations.js";

export type WorkflowProposalStatus = "pending" | "approved" | "refused" | "superseded";

export interface WorkflowProposalRow {
  id: string;
  chat_id: string | null;
  intent: string;
  name: string;
  content: string;
  preview: string;
  status: WorkflowProposalStatus;
  supersedes_id: string | null;
  created_at: number;
  decided_at: number | null;
}

export interface WorkflowProposalRecord {
  id: string;
  chatId?: string;
  intent: string;
  name: string;
  content: string;
  preview: string;
  status: WorkflowProposalStatus;
  supersedesId?: string;
  createdAt: number;
  decidedAt: number | null;
}

function hydrate(row: WorkflowProposalRow): WorkflowProposalRecord {
  return {
    id: row.id,
    chatId: row.chat_id ?? undefined,
    intent: row.intent,
    name: row.name,
    content: row.content,
    preview: row.preview,
    status: row.status,
    supersedesId: row.supersedes_id ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export class WorkflowProposalStorage {
  constructor(private api: DutyAPI) {}

  async init(): Promise<void> {
    const db = (this.api as any).db;
    if (db) await runEngineMigrations(db);
  }

  async create(input: {
    chatId?: string;
    intent: string;
    name: string;
    content: string;
    preview: string;
    supersedesId?: string;
  }): Promise<WorkflowProposalRecord> {
    const id = `wprop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();

    await this.api.db?.execute?.(
      `INSERT INTO workflow_proposals (
        id, chat_id, intent, name, content, preview, status, supersedes_id, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
      [
        id,
        input.chatId ?? null,
        input.intent,
        input.name,
        input.content,
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
      name: input.name,
      content: input.content,
      preview: input.preview,
      status: "pending",
      supersedesId: input.supersedesId,
      createdAt: now,
      decidedAt: null,
    };
  }

  async getById(id: string): Promise<WorkflowProposalRecord | null> {
    const rows = await this.api.db?.query<WorkflowProposalRow>(
      `SELECT * FROM workflow_proposals WHERE id = ?`,
      [id]
    );
    const row = rows?.[0];
    return row ? hydrate(row) : null;
  }

  async listPending(): Promise<WorkflowProposalRecord[]> {
    const rows = await this.api.db?.query<WorkflowProposalRow>(
      `SELECT * FROM workflow_proposals WHERE status = 'pending' ORDER BY created_at DESC`
    ) ?? [];
    return rows.map(hydrate);
  }

  /** Same terminal-decision semantics as ContractProposalStorage.decide. */
  async decide(id: string, status: Exclude<WorkflowProposalStatus, "pending">): Promise<void> {
    const decidedAt = status === "superseded" ? null : Date.now();
    await this.api.db?.execute?.(
      `UPDATE workflow_proposals SET status = ?, decided_at = ? WHERE id = ?`,
      [status, decidedAt, id]
    );
  }
}
