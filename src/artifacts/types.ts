/**
 * Artifacts — persistent, cross-chat project containers.
 * Types shared by the store, scheduler, tools, and index-html renderer.
 */

export type ArtifactState =
  | "INITIALIZED"
  | "ACTIVE"
  | "PROCESSING"
  | "REVIEW"
  | "COMPLETE"
  | "ARCHIVED";

export type ArtifactType =
  | "game_assets"
  | "research"
  | "prototype"
  | "pipeline"
  | "library"
  | "documentation";

export type AssetRecordType = "model" | "texture" | "document" | "research" | "code" | "reference";

export type LogAction = "GATHERED" | "CONVERTED" | "VALIDATED" | "ERROR";

export const VALID_TRANSITIONS: Record<ArtifactState, ArtifactState[]> = {
  INITIALIZED: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["PROCESSING", "REVIEW", "COMPLETE", "ARCHIVED"],
  PROCESSING: ["ACTIVE", "REVIEW", "COMPLETE", "ARCHIVED"],
  REVIEW: ["ACTIVE", "PROCESSING", "COMPLETE", "ARCHIVED"],
  COMPLETE: ["ACTIVE", "ARCHIVED"], // re-opening is allowed
  ARCHIVED: [],
};

export interface AssetCategory {
  category: string;
  target: number;
  collected: number;
  pending: number;
}

export interface AssetRecord {
  type: AssetRecordType;
  filename: string;
  source: string;
  license?: string;
  downloadedAt: string;
  metadata?: Record<string, unknown>;
  /**
   * Basename of a file Ronin manages under this artifact's own assets
   * directory (see src/artifacts/storage.ts). When set, the asset is
   * served at /api/artifact/<id>/asset/<storedPath>. Absent for records
   * that merely cite an external source (e.g. a research URL) with no
   * locally stored file.
   */
  storedPath?: string;
}

export interface LogEntry {
  timestamp: string;
  skillId: string;
  action: LogAction;
  details: string;
}

export interface SchedulingState {
  enabled: boolean;
  nextCheckIn: string | null;
  lastUpdated: string;
  backoffMultiplier: number;
  maxAttempts: number;
  attemptCount: number;
}

export interface ArtifactMetadata {
  id: string;
  name: string;
  created: string;
  updated: string;
  owner: string;

  type: ArtifactType;
  tags: string[];
  description?: string;
  estimatedCompletion?: string;

  state: ArtifactState;
  completionThreshold: number;

  assets: Record<string, AssetCategory>;
  scheduling: SchedulingState;
}

export interface ArtifactFile {
  metadata: ArtifactMetadata;
  assetRecords: AssetRecord[];
  logs: LogEntry[];
}

export interface SchedulingDecision {
  shouldSchedule: boolean;
  pendingCategories: string[];
  reason: string;
  nextCheckIn?: string;
}

export interface CreateArtifactParams {
  name: string;
  type: ArtifactType;
  description?: string;
  tags?: string[];
  estimatedCompletion?: string;
  completionThreshold?: number;
  owner?: string;
  assets?: Array<{ category: string; target: number }>;
}

export function calculateCompletion(assets: Record<string, AssetCategory>): number {
  const categories = Object.values(assets);
  if (categories.length === 0) return 0;
  const ratios = categories.map((c) => (c.target > 0 ? Math.min(1, c.collected / c.target) : 1));
  const avg = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
  return Math.round(avg * 100);
}
