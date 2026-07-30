/**
 * Backoff math for artifact scheduling.
 * Pure functions — no I/O — so they're easy to unit test independently of ArtifactStore.
 */

const BASE_DELAY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Exponential backoff delay before the next check-in is allowed.
 * attemptCount=0 -> 1h, 1 -> 1.5h, 2 -> 2.25h, ... (multiplier=1.5)
 */
export function calculateBackoff(attemptCount: number, multiplier: number): number {
  return BASE_DELAY_MS * Math.pow(multiplier, Math.max(0, attemptCount));
}

export function calculateNextCheckIn(attemptCount: number, multiplier: number, from: number = Date.now()): string {
  return new Date(from + calculateBackoff(attemptCount, multiplier)).toISOString();
}

/**
 * Simple keyword-overlap relevance score between new context and an artifact's tags.
 * Returns 0-1. Mirrors the spec's heuristic — swap for an embedding-based score later if needed.
 */
export function scoreContextRelevance(context: string, tags: string[]): number {
  if (tags.length === 0) return 0;
  const contextWords = context.toLowerCase().split(/\W+/).filter(Boolean);
  if (contextWords.length === 0) return 0;
  const lowerTags = tags.map((t) => t.toLowerCase());
  const matchCount = contextWords.filter((w) => lowerTags.some((t) => t.includes(w) || w.includes(t))).length;
  return Math.min(1, matchCount / lowerTags.length);
}

export const RELEVANCE_THRESHOLD = 0.6;
