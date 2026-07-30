/**
 * ArtifactStore — SQLite-backed persistence for Artifacts.
 * Replaces the flat-file (.atf) approach from the original spec with the
 * same db.query/execute/transaction pattern used by the rest of Ronin
 * (see src/database/migrations.ts, src/memory/Memory.ts).
 */

import type { DutyAPI } from "../types/index.js";
import {
  VALID_TRANSITIONS,
  calculateCompletion,
  type ArtifactFile,
  type ArtifactMetadata,
  type ArtifactState,
  type AssetCategory,
  type AssetRecord,
  type CreateArtifactParams,
  type LogEntry,
  type SchedulingDecision,
} from "./types.js";
import { calculateNextCheckIn, scoreContextRelevance, RELEVANCE_THRESHOLD } from "./scheduler.js";

type Db = DutyAPI["db"];

interface ArtifactRow {
  id: string;
  name: string;
  type: ArtifactMetadata["type"];
  tags: string;
  description: string | null;
  owner: string;
  state: ArtifactState;
  completion_threshold: number;
  estimated_completion: string | null;
  created_at: string;
  updated_at: string;
  scheduling_enabled: number;
  next_check_in: string | null;
  last_updated: string;
  backoff_multiplier: number;
  attempt_count: number;
  max_attempts: number;
}

interface AssetRow {
  category: string;
  target: number;
  collected: number;
  pending: number;
}

interface AssetRecordRow {
  type: AssetRecord["type"];
  filename: string;
  source: string;
  license: string | null;
  downloaded_at: string;
  metadata: string | null;
  stored_path: string | null;
}

interface LogRow {
  timestamp: string;
  skill_id: string;
  action: LogEntry["action"];
  details: string;
}

function sanitizeId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "artifact"}-${suffix}`;
}

function rowToMetadata(row: ArtifactRow, assets: AssetRow[]): ArtifactMetadata {
  const assetMap: Record<string, AssetCategory> = {};
  for (const a of assets) {
    assetMap[a.category] = { category: a.category, target: a.target, collected: a.collected, pending: a.pending };
  }
  return {
    id: row.id,
    name: row.name,
    created: row.created_at,
    updated: row.updated_at,
    owner: row.owner,
    type: row.type,
    tags: JSON.parse(row.tags || "[]"),
    description: row.description ?? undefined,
    estimatedCompletion: row.estimated_completion ?? undefined,
    state: row.state,
    completionThreshold: row.completion_threshold,
    assets: assetMap,
    scheduling: {
      enabled: !!row.scheduling_enabled,
      nextCheckIn: row.next_check_in,
      lastUpdated: row.last_updated,
      backoffMultiplier: row.backoff_multiplier,
      maxAttempts: row.max_attempts,
      attemptCount: row.attempt_count,
    },
  };
}

export class ArtifactStore {
  private db: Db;

  constructor(api: DutyAPI) {
    this.db = api.db;
  }

  async create(params: CreateArtifactParams): Promise<ArtifactMetadata> {
    const id = sanitizeId(params.name);
    const now = new Date().toISOString();
    const tags = params.tags ?? [];

    await this.db.execute(
      `INSERT INTO artifacts (
        id, name, type, tags, description, owner, state, completion_threshold,
        estimated_completion, created_at, updated_at,
        scheduling_enabled, next_check_in, last_updated, backoff_multiplier, attempt_count, max_attempts
      ) VALUES (?, ?, ?, ?, ?, ?, 'INITIALIZED', ?, ?, ?, ?, 1, ?, ?, 1.5, 0, 3)`,
      [
        id,
        params.name,
        params.type,
        JSON.stringify(tags),
        params.description ?? null,
        params.owner ?? "ronin",
        params.completionThreshold ?? 85,
        params.estimatedCompletion ?? null,
        now,
        now,
        now, // next_check_in: eligible immediately
        now,
      ]
    );

    for (const asset of params.assets ?? []) {
      await this.db.execute(
        `INSERT INTO artifact_assets (artifact_id, category, target, collected, pending) VALUES (?, ?, ?, 0, ?)`,
        [id, asset.category, asset.target, asset.target]
      );
    }

    const created = await this.load(id);
    if (!created) throw new Error(`Failed to load artifact after create: ${id}`);
    return created.metadata;
  }

  async load(id: string): Promise<ArtifactFile | null> {
    const rows = await this.db.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = ?`, [id]);
    const row = rows[0];
    if (!row) return null;

    const assets = await this.db.query<AssetRow>(
      `SELECT category, target, collected, pending FROM artifact_assets WHERE artifact_id = ?`,
      [id]
    );
    const assetRecordRows = await this.db.query<AssetRecordRow>(
      `SELECT type, filename, source, license, downloaded_at, metadata, stored_path FROM artifact_asset_records WHERE artifact_id = ? ORDER BY downloaded_at DESC`,
      [id]
    );
    const logRows = await this.db.query<LogRow>(
      `SELECT timestamp, skill_id, action, details FROM artifact_logs WHERE artifact_id = ? ORDER BY timestamp DESC LIMIT 50`,
      [id]
    );

    return {
      metadata: rowToMetadata(row, assets),
      assetRecords: assetRecordRows.map((r) => ({
        type: r.type,
        filename: r.filename,
        source: r.source,
        license: r.license ?? undefined,
        downloadedAt: r.downloaded_at,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        storedPath: r.stored_path ?? undefined,
      })),
      logs: logRows.map((r) => ({ timestamp: r.timestamp, skillId: r.skill_id, action: r.action, details: r.details })),
    };
  }

  async listActive(): Promise<ArtifactMetadata[]> {
    const rows = await this.db.query<ArtifactRow>(
      `SELECT * FROM artifacts WHERE state NOT IN ('COMPLETE', 'ARCHIVED') ORDER BY updated_at DESC`
    );
    const out: ArtifactMetadata[] = [];
    for (const row of rows) {
      const assets = await this.db.query<AssetRow>(
        `SELECT category, target, collected, pending FROM artifact_assets WHERE artifact_id = ?`,
        [row.id]
      );
      out.push(rowToMetadata(row, assets));
    }
    return out;
  }

  async listAll(): Promise<ArtifactMetadata[]> {
    const rows = await this.db.query<ArtifactRow>(`SELECT * FROM artifacts ORDER BY updated_at DESC`);
    const out: ArtifactMetadata[] = [];
    for (const row of rows) {
      const assets = await this.db.query<AssetRow>(
        `SELECT category, target, collected, pending FROM artifact_assets WHERE artifact_id = ?`,
        [row.id]
      );
      out.push(rowToMetadata(row, assets));
    }
    return out;
  }

  async updateProgress(
    id: string,
    category: string,
    updates: { collected?: number; pending?: number; target?: number }
  ): Promise<void> {
    const existing = await this.db.query<AssetRow>(
      `SELECT category, target, collected, pending FROM artifact_assets WHERE artifact_id = ? AND category = ?`,
      [id, category]
    );

    if (existing[0]) {
      const merged = { ...existing[0], ...updates };
      await this.db.execute(
        `UPDATE artifact_assets SET target = ?, collected = ?, pending = ? WHERE artifact_id = ? AND category = ?`,
        [merged.target, merged.collected, merged.pending, id, category]
      );
    } else {
      await this.db.execute(
        `INSERT INTO artifact_assets (artifact_id, category, target, collected, pending) VALUES (?, ?, ?, ?, ?)`,
        [id, category, updates.target ?? 0, updates.collected ?? 0, updates.pending ?? 0]
      );
    }

    await this.touch(id);
  }

  async addAsset(id: string, asset: AssetRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO artifact_asset_records (artifact_id, type, filename, source, license, downloaded_at, metadata, stored_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        asset.type,
        asset.filename,
        asset.source,
        asset.license ?? null,
        asset.downloadedAt,
        asset.metadata ? JSON.stringify(asset.metadata) : null,
        asset.storedPath ?? null,
      ]
    );
    await this.touch(id);
  }

  async appendLog(id: string, entry: LogEntry): Promise<void> {
    await this.db.execute(
      `INSERT INTO artifact_logs (artifact_id, timestamp, skill_id, action, details) VALUES (?, ?, ?, ?, ?)`,
      [id, entry.timestamp, entry.skillId, entry.action, entry.details]
    );
    await this.touch(id);
  }

  async transitionState(id: string, newState: ArtifactState): Promise<ArtifactMetadata> {
    const file = await this.load(id);
    if (!file) throw new Error(`Artifact not found: ${id}`);
    const oldState = file.metadata.state;

    if (oldState !== newState && !VALID_TRANSITIONS[oldState].includes(newState)) {
      throw new Error(`Invalid artifact state transition: ${oldState} -> ${newState}`);
    }

    const now = new Date().toISOString();
    const schedulingEnabled = newState === "COMPLETE" || newState === "ARCHIVED" ? 0 : 1;

    await this.db.execute(`UPDATE artifacts SET state = ?, updated_at = ?, scheduling_enabled = ? WHERE id = ?`, [
      newState,
      now,
      schedulingEnabled,
      id,
    ]);

    const updated = await this.load(id);
    return updated!.metadata;
  }

  /**
   * Decide whether an artifact is due for more work, honoring completion state,
   * exponential backoff, max attempts, and (if newContext given) relevance.
   * On a positive decision, advances the backoff counters — mirrors the spec's
   * evaluateSchedule, minus the imagined "duty dispatch" (see plan's gap note).
   */
  async evaluateSchedule(id: string, newContext?: string): Promise<SchedulingDecision> {
    const file = await this.load(id);
    if (!file) throw new Error(`Artifact not found: ${id}`);
    const meta = file.metadata;
    const now = Date.now();

    if (meta.state === "COMPLETE" || meta.state === "ARCHIVED") {
      return { shouldSchedule: false, pendingCategories: [], reason: `Artifact is ${meta.state.toLowerCase()}; no scheduling` };
    }

    if (meta.state === "PROCESSING") {
      return { shouldSchedule: false, pendingCategories: [], reason: "Already processing; wait for completion" };
    }

    if (!meta.scheduling.enabled) {
      return { shouldSchedule: false, pendingCategories: [], reason: "Scheduling disabled for this artifact" };
    }

    if (meta.scheduling.nextCheckIn && now < new Date(meta.scheduling.nextCheckIn).getTime()) {
      return {
        shouldSchedule: false,
        pendingCategories: [],
        reason: `Backoff active; next check at ${meta.scheduling.nextCheckIn}`,
        nextCheckIn: meta.scheduling.nextCheckIn,
      };
    }

    if (meta.scheduling.attemptCount >= meta.scheduling.maxAttempts) {
      return { shouldSchedule: false, pendingCategories: [], reason: "Max scheduling attempts reached; needs manual intervention" };
    }

    if (newContext) {
      const relevance = scoreContextRelevance(newContext, meta.tags);
      if (relevance < RELEVANCE_THRESHOLD) {
        return { shouldSchedule: false, pendingCategories: [], reason: `Context relevance too low (${relevance.toFixed(2)})` };
      }
    }

    const pendingCategories = Object.values(meta.assets)
      .filter((a) => a.pending > 0)
      .map((a) => a.category);

    const nextAttempt = meta.scheduling.attemptCount + 1;
    const nextCheckIn = calculateNextCheckIn(nextAttempt, meta.scheduling.backoffMultiplier, now);

    await this.db.execute(
      `UPDATE artifacts SET attempt_count = ?, next_check_in = ?, last_updated = ? WHERE id = ?`,
      [nextAttempt, nextCheckIn, new Date(now).toISOString(), id]
    );

    return {
      shouldSchedule: true,
      pendingCategories,
      reason: pendingCategories.length > 0 ? `${pendingCategories.length} categories pending` : "Scheduled check-in",
      nextCheckIn,
    };
  }

  private async touch(id: string): Promise<void> {
    await this.db.execute(`UPDATE artifacts SET updated_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
  }
}

export { calculateCompletion };
