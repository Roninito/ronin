/**
 * canvas-editor — serves /canvas (Cytoscape.js render of the derived graph)
 * and its WebSocket bridge at /canvas/ws.
 *
 * The bridge is deliberately thin (design plan §2.1/§12.4): it translates
 * browser messages to real bus primitives 1:1 — no logic, no cache, no
 * state beyond per-socket subscription bookkeeping. All intelligence lives
 * in graph-keeper/graph-linter; this duty is the client of the exact
 * primitives it visualizes.
 */

import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import {
  dramTheme,
  getAdobeCleanFontFaceCSS,
  getThemeCSS,
  getSharedUIPrimitivesCSS,
  getHeaderBarCSS,
  getHeaderHomeIconHTML,
} from "../src/utils/theme.js";

interface BridgeMessage {
  id?: string;
  op: "query" | "subscribe" | "beam" | "tool" | "registered-events";
  target?: string;
  type?: string;
  payload?: unknown;
  timeoutMs?: number;
  events?: string[];
  /** For op:"tool" — the registered tool name, e.g. "contracts.proposeReflex". */
  toolName?: string;
}

const WS_PATH = "/canvas/ws";

export default class CanvasEditorDuty extends BaseDuty {
  static description = "Serves the /canvas topology editor and its WebSocket bridge to the event bus.";

  // Per-socket subscription bookkeeping — event name -> handler, so listeners
  // registered on this.api.events can be cleanly removed on disconnect.
  private socketSubscriptions = new Map<unknown, Array<{ event: string; handler: (data: unknown) => void }>>();

  constructor(api: DutyAPI) {
    super(api);
    this.api.http.registerRoute("/canvas", this.handleCanvasPage.bind(this), {
      title: "Canvas",
      description: "Live topology graph of duties, contracts, and katas",
      icon: "🗺️",
    });
    this.api.http.registerWebSocket?.(WS_PATH, {
      open: (ws) => this.onOpen(ws),
      message: (ws, message) => this.onMessage(ws, message),
      close: (ws) => this.onClose(ws),
    });
    console.log("🖼️  Canvas Editor ready. /canvas");
  }

  async execute(): Promise<void> {
    // No standing work — this duty only responds to HTTP/WS.
  }

  private onOpen(_ws: unknown): void {
    // Nothing to do on connect — the client sends its own first query.
  }

  private onClose(ws: unknown): void {
    const subs = this.socketSubscriptions.get(ws);
    if (subs) {
      for (const { event, handler } of subs) this.api.events.off(event, handler);
      this.socketSubscriptions.delete(ws);
    }
  }

  private async onMessage(ws: any, raw: string | Buffer): Promise<void> {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      ws.send(JSON.stringify({ op: "error", message: "Invalid JSON" }));
      return;
    }

    try {
      if (msg.op === "query") {
        if (!msg.target || !msg.type) throw new Error("query requires target and type");
        const result = await this.api.events.query(msg.target, msg.type, msg.payload ?? {}, msg.timeoutMs ?? 5000);
        ws.send(JSON.stringify({ op: "query_result", id: msg.id, result }));
        return;
      }

      if (msg.op === "beam") {
        if (!msg.target || !msg.type) throw new Error("beam requires target and type");
        this.api.events.beam(msg.target, msg.type, msg.payload ?? {});
        ws.send(JSON.stringify({ op: "beam_ack", id: msg.id }));
        return;
      }

      if (msg.op === "tool") {
        if (!msg.toolName) throw new Error("tool requires toolName");
        const result = await this.api.tools.execute(msg.toolName, (msg.payload as Record<string, any>) ?? {});
        ws.send(JSON.stringify({ op: "tool_result", id: msg.id, result }));
        return;
      }

      if (msg.op === "registered-events") {
        const events = this.api.events.getRegisteredEvents().map((e) => e.event);
        ws.send(JSON.stringify({ op: "registered_events_result", id: msg.id, events }));
        return;
      }

      if (msg.op === "subscribe") {
        const events = msg.events ?? [];
        const subs = this.socketSubscriptions.get(ws) ?? [];
        for (const event of events) {
          const handler = (data: unknown) => {
            try {
              ws.send(JSON.stringify({ op: "event", event, data }));
            } catch {
              /* socket likely closed; close handler will clean up */
            }
          };
          this.api.events.on(event, handler);
          subs.push({ event, handler });
        }
        this.socketSubscriptions.set(ws, subs);
        ws.send(JSON.stringify({ op: "subscribed", id: msg.id, events }));
        return;
      }

      throw new Error(`Unknown op: ${(msg as any).op}`);
    } catch (error) {
      ws.send(
        JSON.stringify({
          op: "error",
          id: msg.id,
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  private async handleCanvasPage(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas - Ronin</title>
  <script src="https://unpkg.com/cytoscape@3.30.0/dist/cytoscape.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(dramTheme)}
    ${getSharedUIPrimitivesCSS(dramTheme, { variant: "dram" })}
    ${getHeaderBarCSS(dramTheme)}

    body { padding: 0; margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    /* FORGE FUI accents: amber = events, cyan = tools/skills, gold = cron/sensors */
    :root {
      --forge-amber: #E8A33D;
      --forge-cyan: #4DD0E1;
      --forge-gold: #C9A24B;
      --forge-danger: #E05252;
    }

    #canvas-shell { flex: 1; position: relative; min-height: 0; }
    #cy { width: 100%; height: 100%; background: ${dramTheme.colors.background}; }

    #status-bar {
      position: absolute; top: 12px; left: 12px; z-index: 10;
      background: ${dramTheme.colors.backgroundSecondary};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      padding: ${dramTheme.spacing.sm} ${dramTheme.spacing.md};
      font-size: 0.75rem;
      color: ${dramTheme.colors.textSecondary};
      display: flex;
      gap: ${dramTheme.spacing.md};
    }
    #status-bar .offline { color: var(--forge-danger); }

    #lint-tray {
      position: absolute; bottom: 12px; right: 12px; z-index: 10;
      max-width: 360px; max-height: 40vh; overflow-y: auto;
      background: ${dramTheme.colors.backgroundSecondary};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      padding: ${dramTheme.spacing.sm};
      font-size: 0.72rem;
    }
    #lint-tray .finding { padding: 4px 6px; border-bottom: 1px solid ${dramTheme.colors.border}; }
    #lint-tray .finding:last-child { border-bottom: none; }
    #lint-tray .finding.error { color: var(--forge-danger); }
    #lint-tray .finding.warn { color: var(--forge-amber); }
    #lint-tray .finding.info { color: ${dramTheme.colors.textSecondary}; }
    #lint-tray .empty { color: ${dramTheme.colors.textTertiary}; padding: 4px 6px; }

    .legend {
      position: absolute; top: 12px; right: 12px; z-index: 10;
      background: ${dramTheme.colors.backgroundSecondary};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      padding: ${dramTheme.spacing.sm} ${dramTheme.spacing.md};
      font-size: 0.7rem;
      color: ${dramTheme.colors.textSecondary};
      display: flex; flex-direction: column; gap: 4px;
    }
    .legend .row { display: flex; align-items: center; gap: 6px; }
    .legend .swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

    #toolbar {
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 10;
      display: flex; gap: ${dramTheme.spacing.sm};
    }
    #toolbar button {
      background: ${dramTheme.colors.backgroundSecondary};
      border: 1px solid ${dramTheme.colors.border};
      color: ${dramTheme.colors.textPrimary};
      border-radius: ${dramTheme.borderRadius.sm};
      padding: 6px 12px;
      font-size: 0.75rem;
      cursor: pointer;
    }
    #toolbar button:hover { border-color: var(--forge-amber); }

    .panel {
      position: absolute; top: 56px; left: 50%; transform: translateX(-50%); z-index: 20;
      width: min(480px, 90vw);
      background: ${dramTheme.colors.backgroundSecondary};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      padding: ${dramTheme.spacing.md};
      display: none;
    }
    .panel.open { display: block; }
    .panel h3 { margin: 0 0 ${dramTheme.spacing.sm}; font-size: 0.85rem; color: ${dramTheme.colors.textPrimary}; }
    .panel textarea {
      width: 100%; min-height: 64px; resize: vertical;
      background: ${dramTheme.colors.background};
      border: 1px solid ${dramTheme.colors.border};
      color: ${dramTheme.colors.textPrimary};
      border-radius: ${dramTheme.borderRadius.sm};
      padding: 6px 8px; font-size: 0.8rem; font-family: inherit;
      box-sizing: border-box;
    }
    .panel .actions { display: flex; gap: ${dramTheme.spacing.sm}; margin-top: ${dramTheme.spacing.sm}; }
    .panel .actions button {
      flex: 1; padding: 6px; border-radius: ${dramTheme.borderRadius.sm}; border: 1px solid ${dramTheme.colors.border};
      background: transparent; color: ${dramTheme.colors.textPrimary}; cursor: pointer; font-size: 0.78rem;
    }
    .panel .actions button.primary { border-color: var(--forge-amber); color: var(--forge-amber); }
    .panel .actions button.allow { border-color: ${dramTheme.colors.success}; color: ${dramTheme.colors.success}; }
    .panel .actions button.refuse { border-color: var(--forge-danger); color: var(--forge-danger); }
    .panel .preview { font-size: 0.78rem; color: ${dramTheme.colors.textSecondary}; margin-top: ${dramTheme.spacing.sm}; line-height: 1.5; }
    .panel .status { font-size: 0.72rem; color: ${dramTheme.colors.textTertiary}; margin-top: 6px; }

    #toolbar button.active { border-color: var(--forge-cyan); color: var(--forge-cyan); }

    #exec-feed {
      position: absolute; bottom: 12px; left: 12px; z-index: 10;
      width: 300px; max-height: 30vh; overflow-y: auto;
      background: ${dramTheme.colors.backgroundSecondary};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      padding: ${dramTheme.spacing.sm};
      font-size: 0.7rem;
      display: none;
    }
    #exec-feed.open { display: block; }
    #exec-feed .row { padding: 3px 4px; border-bottom: 1px solid ${dramTheme.colors.border}; color: ${dramTheme.colors.textSecondary}; display: flex; justify-content: space-between; gap: 6px; }
    #exec-feed .row:last-child { border-bottom: none; }
    #exec-feed .row .type { color: var(--forge-amber); font-family: monospace; }
    #exec-feed .row .time { color: ${dramTheme.colors.textTertiary}; flex-shrink: 0; }
    #exec-feed h4 { margin: 0 0 6px; font-size: 0.72rem; color: ${dramTheme.colors.textPrimary}; }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>🗺️ Canvas</h1>
    <div class="header-meta"><span id="header-status">connecting…</span></div>
  </div>

  <div id="canvas-shell">
    <div id="cy"></div>
    <div id="status-bar">
      <span id="node-count">0 nodes</span>
      <span id="edge-count">0 edges</span>
      <span id="conn-status" class="offline">offline</span>
    </div>
    <div class="legend">
      <div class="row"><span class="swatch" style="background:var(--forge-cyan)"></span> duty</div>
      <div class="row"><span class="swatch" style="background:var(--forge-gold)"></span> contract / sensor</div>
      <div class="row"><span class="swatch" style="background:#9B7EDE"></span> kata</div>
      <div class="row"><span class="swatch" style="background:var(--forge-amber)"></span> broadcast / beam / query edge</div>
      <div class="row"><span class="swatch" style="background:var(--forge-danger)"></span> dangling target</div>
    </div>
    <div id="lint-tray"><div class="empty">No lint findings yet.</div></div>

    <div id="toolbar">
      <button id="btn-propose-contract">+ Propose contract</button>
      <button id="btn-propose-duty">+ Propose duty</button>
      <button id="btn-execution">Execution: off</button>
      <button id="btn-simulate">▶ Simulate</button>
    </div>

    <div id="simulate-panel" class="panel">
      <h3>Simulate event propagation (dry-run)</h3>
      <p style="font-size:0.72rem;color:${dramTheme.colors.textTertiary};margin:0 0 8px;">
        Pure registry walk from the current graph — no tools run, no AI calls, nothing actually fires.
        Shows reachability, not real conditional logic.
      </p>
      <input id="simulate-event-name" type="text" placeholder="event name, e.g. finance.audit.completed"
        style="width:100%;box-sizing:border-box;background:${dramTheme.colors.background};border:1px solid ${dramTheme.colors.border};color:${dramTheme.colors.textPrimary};border-radius:${dramTheme.borderRadius.sm};padding:6px 8px;font-size:0.8rem;">
      <div class="actions">
        <button class="primary" id="simulate-run-btn">Run</button>
        <button id="simulate-cancel-btn">Close</button>
      </div>
      <div id="simulate-results" style="margin-top:8px;font-size:0.75rem;max-height:240px;overflow-y:auto;"></div>
    </div>

    <div id="exec-feed">
      <h4>Recent events (live)</h4>
      <div id="exec-feed-body"><div style="color:${dramTheme.colors.textTertiary}">No events captured yet.</div></div>
    </div>

    <div id="contract-panel" class="panel">
      <h3>Propose a contract (reflex)</h3>
      <textarea id="contract-intent" placeholder="e.g. when trust drops below 40, do a quiet handoff, then notify me"></textarea>
      <div class="actions">
        <button class="primary" id="contract-draft-btn">Draft</button>
        <button id="contract-cancel-btn">Cancel</button>
      </div>
      <div class="preview" id="contract-preview" style="display:none"></div>
      <div class="actions" id="contract-decide-actions" style="display:none">
        <button class="allow" id="contract-allow-btn">Allow</button>
        <button class="refuse" id="contract-refuse-btn">Refuse</button>
      </div>
      <div class="status" id="contract-status"></div>
    </div>

    <div id="duty-panel" class="panel">
      <h3>Propose a duty</h3>
      <textarea id="duty-intent" placeholder="e.g. watches #design threads on Discord and keeps a running GDD"></textarea>
      <div class="actions">
        <button class="primary" id="duty-draft-btn">Draft</button>
        <button id="duty-cancel-btn">Cancel</button>
      </div>
      <div class="preview" id="duty-preview" style="display:none"></div>
      <details id="duty-code-details" style="display:none">
        <summary>View generated code</summary>
        <pre id="duty-code" style="max-height:240px;overflow:auto;font-size:0.7rem;white-space:pre-wrap;"></pre>
      </details>
      <div class="actions" id="duty-decide-actions" style="display:none">
        <button class="allow" id="duty-allow-btn">Allow</button>
        <button class="refuse" id="duty-refuse-btn">Refuse</button>
      </div>
      <div class="status" id="duty-status"></div>
    </div>
  </div>

  <script>
    const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${WS_PATH}';
    let ws;
    let reqCounter = 0;
    const pending = new Map();

    function send(msg) {
      const id = 'req-' + (reqCounter++);
      msg.id = id;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(msg));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('bridge timeout'));
          }
        }, (msg.timeoutMs || 5000) + 2000);
      });
    }

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        document.getElementById('conn-status').textContent = 'online';
        document.getElementById('conn-status').className = '';
        document.getElementById('header-status').textContent = 'live';
        loadGraph();
        ws.send(JSON.stringify({ op: 'subscribe', events: ['graph.updated', 'lint.finding', 'lint.summary'] }));
      };
      ws.onclose = () => {
        document.getElementById('conn-status').textContent = 'offline';
        document.getElementById('conn-status').className = 'offline';
        document.getElementById('header-status').textContent = 'disconnected — retrying…';
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.op === 'query_result' || msg.op === 'tool_result' || msg.op === 'beam_ack' || msg.op === 'subscribed' || msg.op === 'registered_events_result' || msg.op === 'error') {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            if (msg.op === 'error') p.reject(new Error(msg.message));
            else p.resolve(msg.result !== undefined ? msg.result : msg.events !== undefined ? msg.events : msg);
          }
          return;
        }
        if (msg.op === 'event' && msg.event === 'graph.updated') {
          loadGraph();
        }
        if (msg.op === 'event' && msg.event === 'lint.finding') {
          addLintFinding(msg.data);
        }
      };
    }

    const findings = [];
    function addLintFinding(f) {
      findings.unshift(f);
      if (findings.length > 50) findings.length = 50;
      renderLintTray();
    }
    function renderLintTray() {
      const tray = document.getElementById('lint-tray');
      if (findings.length === 0) { tray.innerHTML = '<div class="empty">No lint findings yet.</div>'; return; }
      tray.innerHTML = findings.map(f =>
        '<div class="finding ' + f.severity + '"><strong>' + f.code + '</strong> — ' + escapeHtml(f.message) + '</div>'
      ).join('');
    }
    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    let cy;
    function colorForKind(kind) {
      if (kind === 'duty') return 'var(--forge-cyan)';
      if (kind === 'contract' || kind === 'sensor') return 'var(--forge-gold)';
      if (kind === 'kata') return '#9B7EDE';
      if (kind === 'phantom') return 'var(--forge-danger)';
      return '#888';
    }
    function colorForEdgeKind(kind, dangling) {
      if (dangling) return 'var(--forge-danger)';
      if (kind === 'contract-run') return 'var(--forge-gold)';
      return 'var(--forge-amber)';
    }

    async function loadGraph(force) {
      let graph;
      try {
        graph = await send({ op: 'query', target: 'graph-keeper', type: 'get-graph', payload: { force: !!force }, timeoutMs: 30000 });
      } catch (e) {
        document.getElementById('header-status').textContent = 'graph-keeper unreachable — Ronin may be offline';
        return;
      }
      if (!graph) return;

      document.getElementById('node-count').textContent = graph.nodes.length + ' nodes';
      document.getElementById('edge-count').textContent = graph.edges.length + ' edges';
      document.getElementById('header-status').textContent = 'live — ' + new Date(graph.derivedAt).toLocaleTimeString();

      // Cytoscape requires every edge's source/target to reference a real
      // node in the same elements array — but a dangling edge (E-BEAM-TARGET /
      // E-CONTRACT-TARGET) points at an id that, by definition, doesn't exist
      // as a real node. Synthesize a small phantom node for each unique
      // dangling target so the edge has somewhere to point (rather than
      // Cytoscape throwing/dropping it) — the missing-target signal is one of
      // the most useful things this canvas can show, not something to hide.
      const realNodeIds = new Set(graph.nodes.map(n => n.id));
      const phantomIds = new Set();
      for (const e of graph.edges) {
        if (e.danglingTarget && !realNodeIds.has(e.targetNodeId)) phantomIds.add(e.targetNodeId);
      }

      const elements = [
        ...graph.nodes.map(n => ({
          data: { id: n.id, label: n.name, kind: n.kind, ghost: n.ghost },
          classes: (n.ghost ? 'ghost ' : '') + n.kind,
        })),
        ...[...phantomIds].map(id => ({
          data: { id, label: id.split(':').slice(1).join(':') + ' (missing)', kind: 'phantom' },
          classes: 'phantom',
        })),
        ...graph.edges.map(e => ({
          data: {
            id: e.id, source: e.sourceNodeId, target: e.targetNodeId, kind: e.kind, dangling: e.danglingTarget,
            eventName: e.eventName, eventType: e.eventType,
          },
          classes: (e.danglingTarget ? 'dangling ' : '') + e.kind,
        })),
      ];

      if (!cy) {
        cy = cytoscape({
          container: document.getElementById('cy'),
          elements,
          style: [
            { selector: 'node', style: {
                'background-color': (el) => colorForKind(el.data('kind')),
                'label': 'data(label)',
                'color': '${dramTheme.colors.textPrimary}',
                'font-size': '9px',
                'text-valign': 'bottom',
                'text-margin-y': 4,
                'width': 24, 'height': 24,
              } },
            { selector: 'node.ghost', style: { 'border-width': 2, 'border-style': 'dashed', 'border-color': '#fff', 'opacity': 0.55 } },
            { selector: 'node.sensor', style: { width: 12, height: 12 } },
            { selector: 'node.phantom', style: { shape: 'diamond', width: 10, height: 10, 'border-width': 1, 'border-style': 'dashed', 'border-color': 'var(--forge-danger)', 'font-style': 'italic' } },
            { selector: 'node.simulated', style: { 'border-width': 3, 'border-color': 'var(--forge-cyan)' } },
            { selector: 'edge', style: {
                'width': 1.5,
                'line-color': (el) => colorForEdgeKind(el.data('kind'), el.data('dangling')),
                'target-arrow-color': (el) => colorForEdgeKind(el.data('kind'), el.data('dangling')),
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'opacity': 0.85,
              } },
            { selector: 'edge.beam', style: { width: 2.5 } },
            { selector: 'edge.query', style: { 'line-style': 'dashed' } },
            { selector: 'edge.dangling', style: { 'line-style': 'dashed' } },
            { selector: 'edge.live', style: { 'line-color': 'var(--forge-cyan)', 'target-arrow-color': 'var(--forge-cyan)' } },
            { selector: 'edge.hot', style: { width: 4, opacity: 1 } },
          ],
          layout: { name: 'cose', animate: false, padding: 40 },
        });
      } else {
        cy.json({ elements });
        cy.layout({ name: 'cose', animate: false, padding: 40 }).run();
      }
    }

    // --- Propose Contract panel ---------------------------------------
    let pendingContractProposal = null;

    document.getElementById('btn-propose-contract').onclick = () => {
      document.getElementById('contract-panel').classList.add('open');
    };
    document.getElementById('contract-cancel-btn').onclick = () => {
      document.getElementById('contract-panel').classList.remove('open');
      resetContractPanel();
    };
    function resetContractPanel() {
      pendingContractProposal = null;
      document.getElementById('contract-preview').style.display = 'none';
      document.getElementById('contract-decide-actions').style.display = 'none';
      document.getElementById('contract-status').textContent = '';
      document.getElementById('contract-intent').value = '';
    }

    document.getElementById('contract-draft-btn').onclick = async () => {
      const intent = document.getElementById('contract-intent').value.trim();
      if (!intent) return;
      document.getElementById('contract-status').textContent = 'Drafting…';
      try {
        const result = await send({ op: 'tool', toolName: 'contracts.proposeReflex', payload: { intent }, timeoutMs: 30000 });
        if (!result || result.success === false) {
          document.getElementById('contract-status').textContent = 'Failed: ' + (result && result.error || 'unknown error');
          return;
        }
        pendingContractProposal = result.data;
        document.getElementById('contract-preview').textContent = result.data.preview;
        document.getElementById('contract-preview').style.display = 'block';
        document.getElementById('contract-decide-actions').style.display = 'flex';
        document.getElementById('contract-status').textContent = 'Drafted — showing as a ghost node on canvas.';
        loadGraph(true);
      } catch (e) {
        document.getElementById('contract-status').textContent = 'Failed: ' + e.message;
      }
    };

    async function decideContractProposal(action) {
      if (!pendingContractProposal) return;
      document.getElementById('contract-status').textContent = action === 'approve' ? 'Approving…' : 'Refusing…';
      try {
        const res = await fetch('/api/contracts/proposals/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pendingContractProposal.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          document.getElementById('contract-status').textContent = action === 'approve' ? 'Approved.' : 'Refused.';
          document.getElementById('contract-panel').classList.remove('open');
          resetContractPanel();
          loadGraph(true);
        } else {
          document.getElementById('contract-status').textContent = 'Failed: ' + (body.message || res.statusText);
        }
      } catch (e) {
        document.getElementById('contract-status').textContent = 'Failed: network error';
      }
    }
    document.getElementById('contract-allow-btn').onclick = () => decideContractProposal('approve');
    document.getElementById('contract-refuse-btn').onclick = () => decideContractProposal('refuse');

    // --- Propose Duty panel -------------------------------------------
    let pendingDutyProposal = null;

    document.getElementById('btn-propose-duty').onclick = () => {
      document.getElementById('duty-panel').classList.add('open');
    };
    document.getElementById('duty-cancel-btn').onclick = () => {
      document.getElementById('duty-panel').classList.remove('open');
      resetDutyPanel();
    };
    function resetDutyPanel() {
      pendingDutyProposal = null;
      document.getElementById('duty-preview').style.display = 'none';
      document.getElementById('duty-code-details').style.display = 'none';
      document.getElementById('duty-decide-actions').style.display = 'none';
      document.getElementById('duty-status').textContent = '';
      document.getElementById('duty-intent').value = '';
    }

    document.getElementById('duty-draft-btn').onclick = async () => {
      const intent = document.getElementById('duty-intent').value.trim();
      if (!intent) return;
      document.getElementById('duty-status').textContent = 'Drafting…';
      try {
        const result = await send({ op: 'tool', toolName: 'duties.proposeDuty', payload: { intent }, timeoutMs: 60000 });
        if (!result || result.success === false) {
          document.getElementById('duty-status').textContent = 'Failed: ' + (result && result.error || 'unknown error');
          return;
        }
        pendingDutyProposal = result.data;
        document.getElementById('duty-preview').textContent = result.data.preview;
        document.getElementById('duty-preview').style.display = 'block';
        document.getElementById('duty-code').textContent = result.data.code;
        document.getElementById('duty-code-details').style.display = 'block';
        document.getElementById('duty-decide-actions').style.display = 'flex';
        document.getElementById('duty-status').textContent = 'Drafted — showing as a ghost node on canvas.';
        loadGraph(true);
      } catch (e) {
        document.getElementById('duty-status').textContent = 'Failed: ' + e.message;
      }
    };

    async function decideDutyProposal(action) {
      if (!pendingDutyProposal) return;
      document.getElementById('duty-status').textContent = action === 'approve' ? 'Approving…' : 'Refusing…';
      try {
        const res = await fetch('/api/duties/proposals/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pendingDutyProposal.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          document.getElementById('duty-status').textContent = action === 'approve'
            ? 'Approved — live within moments once HotReloadService picks up the file.'
            : 'Refused.';
          document.getElementById('duty-panel').classList.remove('open');
          resetDutyPanel();
          loadGraph(true);
        } else {
          document.getElementById('duty-status').textContent = 'Failed: ' + (body.message || res.statusText);
        }
      } catch (e) {
        document.getElementById('duty-status').textContent = 'Failed: network error';
      }
    }
    document.getElementById('duty-allow-btn').onclick = () => decideDutyProposal('approve');
    document.getElementById('duty-refuse-btn').onclick = () => decideDutyProposal('refuse');

    // --- Execution overlay ---------------------------------------------
    // Scoped per the design plan: live registered-handler + recent-volume
    // (via the real /timeline/api/events route), no traceId replay — that
    // concept doesn't exist in event-monitor today.
    let executionOn = false;
    let executionPollTimer = null;

    document.getElementById('btn-execution').onclick = () => {
      executionOn = !executionOn;
      const btn = document.getElementById('btn-execution');
      btn.textContent = 'Execution: ' + (executionOn ? 'on' : 'off');
      btn.classList.toggle('active', executionOn);
      document.getElementById('exec-feed').classList.toggle('open', executionOn);
      if (executionOn) {
        refreshExecutionOverlay();
        executionPollTimer = setInterval(refreshExecutionOverlay, 5000);
      } else {
        clearInterval(executionPollTimer);
        clearEdgeHeat();
      }
    };

    function clearEdgeHeat() {
      if (!cy) return;
      cy.edges().forEach((el) => el.removeClass('hot').removeClass('live'));
    }

    function edgeEventName(edgeData) {
      // broadcast edges carry eventName; beam/query edges carry eventType.
      return edgeData.eventName || edgeData.eventType;
    }

    async function refreshExecutionOverlay() {
      if (!cy) return;
      let registered = [];
      try {
        registered = await send({ op: 'registered-events', timeoutMs: 5000 });
      } catch (e) { /* non-fatal — overlay just shows volume without live-handler highlighting */ }
      const registeredSet = new Set(registered || []);

      let recentEvents = [];
      try {
        const res = await fetch('/timeline/api/events?limit=100');
        const body = await res.json();
        recentEvents = body.events || [];
      } catch (e) { /* event-monitor may not be reachable — overlay degrades gracefully */ }

      const counts = {};
      for (const ev of recentEvents) counts[ev.type] = (counts[ev.type] || 0) + 1;

      cy.edges().forEach((el) => {
        const data = el.data();
        // Cytoscape's .data() only carries what we sent in loadGraph — for
        // edge kind-specific fields (eventName/eventType) we stored them
        // under those exact keys when composing elements, so read them here.
        const name = data.eventName || data.eventType;
        el.removeClass('hot').removeClass('live');
        if (name && counts[name]) el.addClass('hot');
        if (name && registeredSet.has(name)) el.addClass('live');
      });

      renderExecFeed(recentEvents.slice(0, 15));
    }

    function renderExecFeed(events) {
      const body = document.getElementById('exec-feed-body');
      if (!events || events.length === 0) {
        body.innerHTML = '<div style="color:${dramTheme.colors.textTertiary}">No events captured yet.</div>';
        return;
      }
      body.innerHTML = events.map(e =>
        '<div class="row"><span class="type">' + escapeHtml(e.type) + '</span><span class="time">' +
        new Date(e.timestamp).toLocaleTimeString() + '</span></div>'
      ).join('');
    }

    // --- Simulated dry-run -----------------------------------------------
    document.getElementById('btn-simulate').onclick = () => {
      document.getElementById('simulate-panel').classList.add('open');
    };
    document.getElementById('simulate-cancel-btn').onclick = () => {
      document.getElementById('simulate-panel').classList.remove('open');
      clearSimulationHighlight();
    };

    function clearSimulationHighlight() {
      if (!cy) return;
      cy.elements().removeClass('simulated');
    }

    document.getElementById('simulate-run-btn').onclick = async () => {
      const eventName = document.getElementById('simulate-event-name').value.trim();
      const resultsEl = document.getElementById('simulate-results');
      if (!eventName) return;
      resultsEl.textContent = 'Running…';
      clearSimulationHighlight();
      try {
        const result = await send({ op: 'query', target: 'graph-keeper', type: 'simulate-event', payload: { eventName }, timeoutMs: 10000 });
        if (!result || result.steps.length === 0) {
          resultsEl.innerHTML = '<em>Nothing consumes "' + escapeHtml(eventName) + '" — dead end.</em>';
          return;
        }
        resultsEl.innerHTML = result.steps.map((s) =>
          '<div style="padding:3px 0;border-bottom:1px solid ${dramTheme.colors.border}">' +
          '<span style="color:${dramTheme.colors.textTertiary}">depth ' + s.depth + '</span> — ' +
          '<strong>' + escapeHtml(s.dutyName) + '</strong> (via ' + escapeHtml(s.triggeredByEvent) + ')' +
          (s.emits.length ? ' → emits ' + s.emits.map(escapeHtml).join(', ') : '') +
          '</div>'
        ).join('') + (result.cyclesStoppedAt.length
          ? '<div style="margin-top:6px;color:var(--forge-amber)">Cycle detected, stopped at: ' + result.cyclesStoppedAt.map(escapeHtml).join(', ') + '</div>'
          : '');

        if (cy) {
          for (const step of result.steps) {
            const el = cy.getElementById(step.dutyId);
            if (el) el.addClass('simulated');
          }
        }
      } catch (e) {
        resultsEl.textContent = 'Failed: ' + e.message;
      }
    };

    connect();
  </script>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
}
