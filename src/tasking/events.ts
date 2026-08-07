/**
 * Live execution feed (spec §9.1): persists ExecutorEvent rows for a command
 * and pushes them to any connected SSE clients in real time.
 *
 * Honest scope note: none of the actual executor call sites are streaming
 * today — api.ai.callTools() and every plugins/*-cli.ts execute() are
 * single-shot promises, not incremental generators. So this delivers
 * coarse-grained lifecycle events (started/done/error) uniformly across all
 * executors, not per-token/per-tool-call streaming. Genuine token-level
 * streaming for the CLI executors would mean switching them from
 * child_process.exec to spawn + incremental stdout parsing (e.g. claude's
 * --output-format stream-json) — a real follow-up, not done here.
 */

import type { DutyAPI } from "../types/index.js";

export type ExecutorEventType = "text" | "tool_call" | "done" | "error";

export interface ExecutorEventPayload {
  type: ExecutorEventType;
  content?: string;
  toolName?: string;
  cost?: { inputTokens?: number; outputTokens?: number; usd?: number };
}

type SSESend = (data: string) => void;

// Per-commandId SSE subscriber sets. In-memory only — a client reconnects
// and replays from kanban_command_events (durable) if the process restarts.
const subscribers = new Map<string, Set<SSESend>>();

export function subscribeToCommand(commandId: string, send: SSESend): () => void {
  let set = subscribers.get(commandId);
  if (!set) {
    set = new Set();
    subscribers.set(commandId, set);
  }
  set.add(send);
  return () => {
    set!.delete(send);
    if (set!.size === 0) subscribers.delete(commandId);
  };
}

function broadcast(commandId: string, seq: number, event: ExecutorEventPayload): void {
  const set = subscribers.get(commandId);
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify({ seq, ...event })}\n\n`;
  for (const send of set) {
    try {
      send(data);
    } catch {
      set.delete(send);
    }
  }
}

/**
 * Persists an event and pushes it to connected clients. One INSERT per
 * event (no batching) — fine at the default maxConcurrent (3); revisit with
 * batched writes if that's raised significantly (see spec §9.1 note).
 */
export async function emitCommandEvent(api: DutyAPI, commandId: string, event: ExecutorEventPayload): Promise<void> {
  const seqRows = await api.db.query<{ maxSeq: number | null }>(
    `SELECT MAX(seq) as maxSeq FROM kanban_command_events WHERE command_id = ?`,
    [commandId]
  );
  const seq = (seqRows[0]?.maxSeq ?? 0) + 1;

  await api.db.execute(
    `INSERT INTO kanban_command_events (id, command_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), commandId, seq, event.type, JSON.stringify(event), Date.now()]
  );

  broadcast(commandId, seq, event);
}

export interface StoredEvent {
  seq: number;
  type: ExecutorEventType;
  payload: string;
  created_at: number;
}

/** Replay events after `afterSeq` for a reconnecting client. */
export async function getEventsSince(api: DutyAPI, commandId: string, afterSeq: number): Promise<StoredEvent[]> {
  return api.db.query<StoredEvent>(
    `SELECT seq, type, payload, created_at FROM kanban_command_events WHERE command_id = ? AND seq > ? ORDER BY seq ASC`,
    [commandId, afterSeq]
  );
}

/** Prune events for commands completed more than `retentionDays` ago. */
export async function pruneOldCommandEvents(api: DutyAPI, retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await api.db.execute(
    `DELETE FROM kanban_command_events WHERE command_id IN (
       SELECT id FROM kanban_command_queue WHERE completed_at IS NOT NULL AND completed_at < ?
     )`,
    [cutoff]
  );
}
