import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import {
  getAdobeCleanFontFaceCSS,
  getHeaderBarCSS,
  getHeaderHomeIconHTML,
  getThemeCSS,
} from "../src/utils/theme.js";

/**
 * DB Cleanup Agent
 * Prunes high-churn memory/ontology support data on a schedule.
 */
export default class DbCleanupAgent extends BaseAgent {
  static schedule = "15 3 * * *"; // Daily at 03:15

  constructor(api: AgentAPI) {
    super(api);
    this.api.http.registerRoute("/cleanup", this.handleCleanupUI.bind(this));
    this.api.http.registerRoute("/api/cleanup/stats", this.handleStats.bind(this));
    this.api.http.registerRoute("/api/cleanup/run", this.handleRunCleanup.bind(this));
  }

  async execute(): Promise<void> {
    await this.runCleanup();
    console.log("[db-cleanup] Completed scheduled pruning");
  }

  private async getStats(): Promise<{
    memories: number;
    ontology_nodes: number;
    ontology_edges: number;
    tool_cache: number;
    tool_results: number;
    analytics: number;
  }> {
    const rows = await this.api.db.query<{ k: string; c: number }>(
      `SELECT 'memories' k, COUNT(*) c FROM memories
       UNION ALL SELECT 'ontology_nodes', COUNT(*) FROM ontology_nodes
       UNION ALL SELECT 'ontology_edges', COUNT(*) FROM ontology_edges
       UNION ALL SELECT 'tool_cache', COUNT(*) FROM memories WHERE key LIKE 'tool.cache.%'
       UNION ALL SELECT 'tool_results', COUNT(*) FROM memories WHERE key LIKE 'tool.result.%'
       UNION ALL SELECT 'analytics', COUNT(*) FROM memories WHERE key LIKE 'analytics.%'`
    );
    const out = {
      memories: 0,
      ontology_nodes: 0,
      ontology_edges: 0,
      tool_cache: 0,
      tool_results: 0,
      analytics: 0,
    };
    for (const r of rows) {
      (out as Record<string, number>)[r.k] = Number(r.c || 0);
    }
    return out;
  }

  private async runCleanup(retention = { toolResultsDays: 3, analyticsDays: 14, contextDays: 30 }): Promise<Record<string, number>> {
    const now = Date.now();
    const days = (n: number): number => now - n * 24 * 60 * 60 * 1000;

    await this.api.db.execute(`DELETE FROM memories WHERE key LIKE 'tool.cache.%'`);
    const deletedToolCache = await this.api.db.query<{ c: number }>("SELECT changes() as c");

    await this.api.db.execute(
      `DELETE FROM memories WHERE key LIKE 'tool.result.%' AND updated_at < ?`,
      [days(retention.toolResultsDays)]
    );
    const deletedToolResults = await this.api.db.query<{ c: number }>("SELECT changes() as c");

    await this.api.db.execute(
      `DELETE FROM memories WHERE key LIKE 'analytics.%' AND updated_at < ?`,
      [days(retention.analyticsDays)]
    );
    const deletedAnalytics = await this.api.db.query<{ c: number }>("SELECT changes() as c");

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
      [days(retention.contextDays), days(retention.contextDays)]
    );
    const deletedEdges = await this.api.db.query<{ c: number }>("SELECT changes() as c");

    await this.api.db.execute(
      `DELETE FROM ontology_nodes
       WHERE type IN ('Conversation','Failure') AND updated_at < ?`,
      [days(retention.contextDays)]
    );
    const deletedNodes = await this.api.db.query<{ c: number }>("SELECT changes() as c");

    return {
      toolCache: Number(deletedToolCache[0]?.c || 0),
      toolResults: Number(deletedToolResults[0]?.c || 0),
      analytics: Number(deletedAnalytics[0]?.c || 0),
      edges: Number(deletedEdges[0]?.c || 0),
      nodes: Number(deletedNodes[0]?.c || 0),
    };
  }

  private async handleStats(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    return Response.json(await this.getStats());
  }

  private async handleRunCleanup(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const deleted = await this.runCleanup();
    const stats = await this.getStats();
    return Response.json({ success: true, deleted, stats });
  }

  private async handleCleanupUI(): Promise<Response> {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ronin Cleanup</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}
    body { margin: 0; }
    .page { max-width: 900px; margin: 0 auto; padding: 1rem; }
    .card { border: 1px solid #333; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; background: #1f1f1f; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: .75rem; }
    .stat { padding: .75rem; border: 1px solid #333; border-radius: 6px; background: #151515; }
    button { padding: .6rem .9rem; border-radius: 6px; border: 1px solid #444; background: #2b2b2b; color: #eee; cursor: pointer; }
    pre { white-space: pre-wrap; background: #121212; border: 1px solid #333; padding: .75rem; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="header">${getHeaderHomeIconHTML()}<h1>🧹 Ronin Cleanup</h1></div>
  <div class="page">
    <div class="card">
      <h3>Current DB Stats</h3>
      <div id="stats" class="stats"></div>
      <div style="margin-top:.75rem"><button onclick="refreshStats()">Refresh Stats</button></div>
    </div>
    <div class="card">
      <h3>Run Cleanup Now</h3>
      <p>Prunes tool cache/results, analytics memory, and stale Conversation/Failure ontology context.</p>
      <button onclick="runCleanup()">Run Cleanup</button>
      <pre id="result">No cleanup run yet.</pre>
    </div>
  </div>
  <script>
    function renderStats(s){
      const entries = [
        ['memories', s.memories], ['ontology_nodes', s.ontology_nodes], ['ontology_edges', s.ontology_edges],
        ['tool_cache', s.tool_cache], ['tool_results', s.tool_results], ['analytics', s.analytics]
      ];
      document.getElementById('stats').innerHTML = entries.map(([k,v]) => '<div class="stat"><strong>'+k+'</strong><div>'+v+'</div></div>').join('');
    }
    async function refreshStats(){
      const r = await fetch('/api/cleanup/stats');
      const s = await r.json();
      renderStats(s);
    }
    async function runCleanup(){
      const r = await fetch('/api/cleanup/run', { method: 'POST' });
      const data = await r.json();
      document.getElementById('result').textContent = JSON.stringify(data, null, 2);
      if (data.stats) renderStats(data.stats);
    }
    refreshStats();
  </script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
}
