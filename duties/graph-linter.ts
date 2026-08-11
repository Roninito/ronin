/**
 * graph-linter — walks the derived graph and reports structural findings.
 * Never fixes, only flags (ARCHITECTURE.md §6 rule 2: sensors are dumb,
 * logic lives in duties — this one's "logic" is read-only analysis).
 *
 * Sense: graph.updated (from graph-keeper).
 * Analyze: src/graph/lint.ts's rule set, plus a live getRegisteredEvents()
 * diff for W-DRIFT (only this duty has that runtime hook, so it's supplied
 * here, not inside the pure lint module).
 * Respond: one lint.finding per item, one lint.summary, cached for get-findings.
 */

import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { lintGraph, type LintFinding } from "../src/graph/lint.js";

interface QueryPayload {
  requestId: string;
  [key: string]: unknown;
}

export default class GraphLinterDuty extends BaseDuty {
  static description = "Walks the derived graph and reports structural findings. Terse. Never fixes, only flags.";
  static events = { in: ["graph.updated"], out: ["lint.finding", "lint.summary"] };

  private lastFindings: LintFinding[] = [];

  constructor(api: DutyAPI) {
    super(api);
    this.api.events.on("graph.updated", () => {
      this.runLint().catch((err) => console.error("[graph-linter] Lint run failed:", err));
    });
    this.registerQueryHandlers();
    console.log("🔎 Graph Linter ready");
  }

  async execute(): Promise<void> {
    await this.runLint();
  }

  private async runLint(): Promise<void> {
    const graph = await this.api.events.query("graph-keeper", "get-graph", {}, 10000);
    if (!graph) return;

    const registeredEvents = this.api.events.getRegisteredEvents().map((e) => e.event);
    const findings = lintGraph(graph as any, { registeredEvents });
    this.lastFindings = findings;

    for (const finding of findings) {
      this.api.events.emit("lint.finding", finding, "graph-linter");
    }

    const bySeverity = { error: 0, warn: 0, info: 0 };
    for (const f of findings) bySeverity[f.severity]++;
    this.api.events.emit("lint.summary", { total: findings.length, ...bySeverity }, "graph-linter");
  }

  private registerQueryHandlers(): void {
    this.api.events.on("target:graph-linter:get-findings", (payload: unknown) => {
      const { requestId } = payload as QueryPayload;
      this.api.events.reply(requestId, this.lastFindings);
    });
  }
}
