/**
 * Artifact injection middleware — the "put artifact in context on mention" behavior.
 *
 * On each run (once, like ontologyInject), inspects the last user message and
 * matches it against active Artifacts (src/artifacts). A match is:
 *   1. Explicit id mention: "@my-game-assets-x1y2z3" (or the bare id)
 *   2. Name mention: the artifact's name appears in the message (case-insensitive)
 *   3. Tag relevance: keyword overlap with the artifact's tags >= RELEVANCE_THRESHOLD
 *
 * On match, unshifts one compact system message describing the artifact's
 * state, progress, and pending categories, and points the model at the
 * artifact_* tools. Silently no-ops if the artifacts tables don't exist yet
 * (artifact-manager duty not loaded) or anything else fails — context
 * injection must never break a chain.
 *
 * Ronin-specific (depends on src/artifacts + DutyAPI.db), so it lives here
 * alongside ontologyResolve rather than in @ronin/sar.
 */

import type { Middleware } from "./MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";
import type { DutyAPI } from "../types/index.js";
import { scoreContextRelevance, RELEVANCE_THRESHOLD } from "../artifacts/scheduler.js";
import { calculateCompletion } from "../artifacts/types.js";
import type { ArtifactState, ArtifactType, AssetCategory } from "../artifacts/types.js";

export interface ArtifactInjectOptions {
  api: DutyAPI;
  /** Max artifacts to inject per run (highest relevance first). Default 1. */
  maxArtifacts?: number;
}

interface ActiveArtifactRow {
  id: string;
  name: string;
  type: ArtifactType;
  tags: string;
  state: ArtifactState;
  completion_threshold: number;
}

interface AssetRow {
  category: string;
  target: number;
  collected: number;
  pending: number;
}

interface Match {
  row: ActiveArtifactRow;
  score: number;
  how: "id" | "name" | "tags";
}

function matchArtifacts(message: string, rows: ActiveArtifactRow[]): Match[] {
  const lower = message.toLowerCase();
  const matches: Match[] = [];

  for (const row of rows) {
    // 1. Explicit id mention (with or without @)
    if (lower.includes(row.id.toLowerCase())) {
      matches.push({ row, score: 1, how: "id" });
      continue;
    }

    // 2. Name mention (only for reasonably distinctive names)
    const name = row.name.toLowerCase().trim();
    if (name.length >= 4 && lower.includes(name)) {
      matches.push({ row, score: 0.9, how: "name" });
      continue;
    }

    // 3. Tag keyword overlap
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags || "[]");
    } catch {
      /* ignore malformed tags */
    }
    const score = scoreContextRelevance(message, tags);
    if (score >= RELEVANCE_THRESHOLD) {
      matches.push({ row, score, how: "tags" });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function renderArtifactContext(
  row: ActiveArtifactRow,
  assets: AssetRow[],
  how: Match["how"]
): string {
  const assetMap: Record<string, AssetCategory> = {};
  for (const a of assets) {
    assetMap[a.category] = { category: a.category, target: a.target, collected: a.collected, pending: a.pending };
  }
  const completion = calculateCompletion(assetMap);
  const pending = assets.filter((a) => a.pending > 0).map((a) => `${a.category} (${a.pending})`);

  const lines = [
    `Artifact context (matched by ${how}): "${row.name}" [id: ${row.id}]`,
    `Type: ${row.type} | State: ${row.state} | Progress: ${completion}% (threshold ${row.completion_threshold}%)`,
    pending.length > 0 ? `Pending: ${pending.join(", ")}` : `No pending categories.`,
    `This conversation appears related to this Artifact. Use artifact_load for full details, ` +
      `artifact_updateProgress / artifact_addAsset / artifact_appendLog to record work, and ` +
      `artifact_getSchedulingStatus before planning follow-up work (it enforces backoff and ` +
      `completion — do not schedule if it says not to). Dashboard: /artifact/${row.id}`,
  ];
  return lines.join("\n");
}

export function createArtifactInjectMiddleware(
  options: ArtifactInjectOptions
): Middleware<ChainContext> {
  const { api, maxArtifacts = 1 } = options;

  return async (ctx, next) => {
    if ((ctx as { _artifactInjected?: boolean })._artifactInjected) {
      await next();
      return;
    }

    try {
      const lastUser = [...ctx.messages].reverse().find((m) => m.role === "user");
      const message = lastUser?.content ?? "";
      if (message.trim().length > 0) {
        const rows = await api.db.query<ActiveArtifactRow>(
          `SELECT id, name, type, tags, state, completion_threshold FROM artifacts WHERE state NOT IN ('COMPLETE', 'ARCHIVED')`
        );

        if (rows.length > 0) {
          const matches = matchArtifacts(message, rows).slice(0, maxArtifacts);
          for (const match of matches) {
            const assets = await api.db.query<AssetRow>(
              `SELECT category, target, collected, pending FROM artifact_assets WHERE artifact_id = ?`,
              [match.row.id]
            );
            ctx.messages.unshift({
              role: "system",
              content: renderArtifactContext(match.row, assets, match.how),
            });
          }
        }
      }
    } catch {
      // Artifacts tables may not exist (artifact-manager not loaded) or db
      // unavailable — never let context injection break the chain.
    }

    (ctx as { _artifactInjected?: boolean })._artifactInjected = true;
    await next();
  };
}
