import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

/**
 * DB Cleanup Agent
 * Prunes high-churn memory/ontology support data on a schedule.
 */
export default class DbCleanupAgent extends BaseAgent {
  static schedule = "15 3 * * *"; // Daily at 03:15

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    const now = Date.now();
    const days = (n: number): number => now - n * 24 * 60 * 60 * 1000;

    // 1) Remove volatile tool caches
    await this.api.db.execute(
      `DELETE FROM memories WHERE key LIKE 'tool.cache.%'`
    );

    // 2) Keep short-lived tool results for recent debugging only
    await this.api.db.execute(
      `DELETE FROM memories WHERE key LIKE 'tool.result.%' AND updated_at < ?`,
      [days(3)]
    );

    // 3) Keep analytics snapshots for a bounded window
    await this.api.db.execute(
      `DELETE FROM memories WHERE key LIKE 'analytics.%' AND updated_at < ?`,
      [days(14)]
    );

    // 4) Prune stale conversational ontology context
    await this.api.db.execute(
      `DELETE FROM ontology_edges
       WHERE from_id IN (
         SELECT id FROM ontology_nodes
         WHERE type IN ('Conversation','Failure') AND updated_at < ?
       )
       OR to_id IN (
         SELECT id FROM ontology_nodes
         WHERE type IN ('Conversation','Failure') AND updated_at < ?
       )`,
      [days(30), days(30)]
    );

    await this.api.db.execute(
      `DELETE FROM ontology_nodes
       WHERE type IN ('Conversation','Failure') AND updated_at < ?`,
      [days(30)]
    );

    console.log("[db-cleanup] Completed scheduled pruning");
  }
}

