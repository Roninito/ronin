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

    #main-row { flex: 1; display: flex; min-height: 0; }
    #canvas-shell { flex: 1; position: relative; min-height: 0; }
    #cy { width: 100%; height: 100%; background: ${dramTheme.colors.background}; }

    #palette {
      width: 260px; flex-shrink: 0; display: flex; flex-direction: column;
      background: ${dramTheme.colors.backgroundSecondary};
      border-right: 1px solid ${dramTheme.colors.border};
      overflow: hidden;
    }
    #palette-search-wrap { padding: ${dramTheme.spacing.sm}; border-bottom: 1px solid ${dramTheme.colors.border}; }
    #palette-search {
      width: 100%; box-sizing: border-box;
      background: ${dramTheme.colors.background};
      border: 1px solid ${dramTheme.colors.border};
      color: ${dramTheme.colors.textPrimary};
      border-radius: ${dramTheme.borderRadius.sm};
      padding: 6px 8px; font-size: 0.78rem;
    }
    #palette-pinned { border-bottom: 1px solid ${dramTheme.colors.border}; }
    #palette-list { flex: 1; overflow-y: auto; }
    .palette-group-label {
      padding: 8px 12px 4px; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: ${dramTheme.colors.textTertiary};
    }
    .palette-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px; font-size: 0.78rem; color: ${dramTheme.colors.textSecondary};
      cursor: grab; user-select: none;
    }
    .palette-item:hover { background: ${dramTheme.colors.backgroundTertiary}; color: ${dramTheme.colors.textPrimary}; }
    .palette-item.placed { opacity: 0.4; }
    .palette-item.placed:hover { opacity: 0.7; }
    .palette-item .p-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
    .palette-item.palette-action { color: var(--forge-amber); font-weight: 600; cursor: pointer; }
    .palette-item.palette-action:hover { background: ${dramTheme.colors.backgroundTertiary}; }
    .palette-empty { padding: 12px; font-size: 0.75rem; color: ${dramTheme.colors.textTertiary}; }

    #canvas-hint {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      color: ${dramTheme.colors.textTertiary}; font-size: 0.85rem; text-align: center;
      pointer-events: none; max-width: 320px; line-height: 1.6;
    }

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
    .panel textarea, .panel input[type="text"] {
      width: 100%; resize: vertical;
      background: ${dramTheme.colors.background};
      border: 1px solid ${dramTheme.colors.border};
      color: ${dramTheme.colors.textPrimary};
      border-radius: ${dramTheme.borderRadius.sm};
      padding: 6px 8px; font-size: 0.8rem; font-family: inherit;
      box-sizing: border-box;
    }
    .panel textarea { min-height: 64px; }
    .panel .name-field-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: ${dramTheme.colors.textTertiary}; margin: 8px 0 4px; }
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
    #toolbar button:disabled { opacity: 0.4; cursor: default; }
    #toolbar button:disabled:hover { border-color: ${dramTheme.colors.border}; }

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

    #tooltip {
      position: fixed; z-index: 100; pointer-events: none;
      max-width: 340px;
      background: ${dramTheme.colors.backgroundSecondary};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      padding: 10px 12px;
      font-size: 0.75rem;
      color: ${dramTheme.colors.textSecondary};
      display: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    #tooltip.open { display: block; }
    #tooltip .tt-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    #tooltip .tt-swatch { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
    #tooltip .tt-title { color: ${dramTheme.colors.textPrimary}; font-weight: 600; font-size: 0.8rem; }
    #tooltip .tt-kind { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: ${dramTheme.colors.textTertiary}; }
    #tooltip .tt-desc { font-style: italic; margin-bottom: 6px; }
    #tooltip .tt-section { margin-top: 6px; }
    #tooltip .tt-label { color: ${dramTheme.colors.textTertiary}; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; }
    #tooltip .tt-port-row { display: flex; align-items: center; gap: 5px; margin: 2px 0; }
    #tooltip .tt-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    #tooltip .tt-empty { color: ${dramTheme.colors.textTertiary}; font-style: italic; }
    #tooltip .tt-warn { color: var(--forge-danger); }

    #code-panel {
      position: absolute; top: 0; right: 0; bottom: 0; z-index: 15;
      width: 420px; max-width: 45vw;
      background: ${dramTheme.colors.backgroundSecondary};
      border-left: 1px solid ${dramTheme.colors.border};
      box-shadow: -4px 0 16px rgba(0,0,0,0.35);
      display: none;
      flex-direction: column;
    }
    #code-panel.open { display: flex; }
    #code-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: ${dramTheme.spacing.sm} ${dramTheme.spacing.md};
      border-bottom: 1px solid ${dramTheme.colors.border};
      font-size: 0.8rem; color: ${dramTheme.colors.textPrimary}; font-weight: 600;
    }
    #code-panel-close {
      background: none; border: none; color: ${dramTheme.colors.textTertiary};
      font-size: 1.1rem; cursor: pointer; line-height: 1; padding: 2px 6px;
    }
    #code-panel-close:hover { color: ${dramTheme.colors.textPrimary}; }
    #code-panel-body { flex: 1; overflow: auto; padding: ${dramTheme.spacing.md}; }
    #code-panel-body pre {
      margin: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.75rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
      color: ${dramTheme.colors.textSecondary};
    }
    #code-panel-note {
      font-size: 0.7rem; color: var(--forge-amber); margin-bottom: ${dramTheme.spacing.sm};
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>🗺️ Canvas</h1>
    <div class="header-meta"><span id="header-status">connecting…</span></div>
  </div>

  <div id="main-row">
  <div id="palette">
    <div id="palette-search-wrap">
      <input id="palette-search" type="text" placeholder="Search duties, contracts, katas…">
    </div>
    <div id="palette-pinned">
      <div class="palette-item palette-action" id="palette-new-duty">+ New duty</div>
      <div class="palette-item palette-action" id="palette-new-contract">+ New contract</div>
    </div>
    <div id="palette-list"><div class="palette-empty">Loading…</div></div>
  </div>

  <div id="canvas-shell">
    <div id="cy"></div>
    <div id="canvas-hint">Drag a duty or contract in from the left to start.<br>Nodes you place bring their real connections with them.</div>
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
      <button id="btn-expand" disabled>🔗 Expand connections</button>
      <button id="btn-clear-canvas">Clear canvas</button>
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

    <div id="tooltip"></div>

    <div id="code-panel">
      <div id="code-panel-header">
        <span id="code-panel-title">—</span>
        <button id="code-panel-close" title="Close">×</button>
      </div>
      <div id="code-panel-body"><div class="palette-empty">Select a node to view its source.</div></div>
    </div>

    <div id="contract-panel" class="panel">
      <h3>Propose a contract (reflex)</h3>
      <textarea id="contract-intent" placeholder="e.g. when trust drops below 40, do a quiet handoff, then notify me"></textarea>
      <div class="actions">
        <button class="primary" id="contract-draft-btn">Draft</button>
        <button id="contract-cancel-btn">Cancel</button>
      </div>
      <div class="preview" id="contract-preview" style="display:none"></div>
      <div id="contract-name-wrap" style="display:none">
        <div class="name-field-label">Name (editable before you approve)</div>
        <input id="contract-name-field" type="text">
      </div>
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
      <div id="duty-name-wrap" style="display:none">
        <div class="name-field-label">Name (editable before you approve)</div>
        <input id="duty-name-field" type="text">
      </div>
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
  </div>

  <script>
    // Cytoscape renders to <canvas>, not the DOM — its style engine parses
    // color strings itself and has no concept of CSS custom properties, so
    // var(--forge-*) is silently invalid wherever it's used as a Cytoscape
    // style value (mappers or static selectors). Literal hex, mirroring the
    // :root values above, is required for anything Cytoscape draws.
    const FORGE_AMBER = '#E8A33D';
    const FORGE_CYAN = '#4DD0E1';
    const FORGE_GOLD = '#C9A24B';
    const FORGE_DANGER = '#E05252';
    const FORGE_KATA = '#9B7EDE';

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
        refreshGraphData();
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
          refreshGraphData();
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
    let lastGraph = null; // full node/edge objects from the last successful refreshGraphData(), for tooltip detail and palette listing
    let nodesById = new Map();
    let edgesById = new Map();
    // Only nodes the user has explicitly dragged/clicked into the canvas are
    // ever rendered — everything else is just an entry in the left palette.
    // This directly answers "we end up with an unreadable web": nothing
    // appears until you ask for it, and its real edges come with it.
    let placedIds = new Set();

    const LAYOUT_STORAGE_KEY = 'ronin-canvas-layout-v1';

    function colorForKind(kind) {
      if (kind === 'duty') return FORGE_CYAN;
      if (kind === 'contract' || kind === 'sensor') return FORGE_GOLD;
      if (kind === 'kata') return FORGE_KATA;
      if (kind === 'phantom') return FORGE_DANGER;
      return '#888';
    }
    function colorForEdgeKind(kind, dangling) {
      if (dangling) return FORGE_DANGER;
      if (kind === 'contract-run') return FORGE_GOLD;
      return FORGE_AMBER;
    }

    // Sensor node ids are derived deterministically from the owning duty/
    // contract name (see src/graph/derive.ts) — placing a duty or contract
    // silently brings its own sensor along, the same way its ports do.
    function sensorIdsFor(nodeId) {
      const idx = nodeId.indexOf(':');
      const kind = nodeId.slice(0, idx);
      const name = nodeId.slice(idx + 1);
      if (kind === 'duty') return ['sensor:cron:' + name, 'sensor:watch:' + name, 'sensor:webhook:' + name];
      if (kind === 'contract') return ['sensor:cron:' + name];
      return [];
    }

    function saveLayout() {
      try {
        const positions = {};
        if (cy) cy.nodes().not('.phantom').forEach((n) => { positions[n.id()] = n.position(); });
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ placed: [...placedIds], positions }));
      } catch (e) { /* localStorage unavailable — layout just won't persist across reloads */ }
    }
    function loadLayout() {
      try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        return raw ? JSON.parse(raw) : { placed: [], positions: {} };
      } catch (e) {
        return { placed: [], positions: {} };
      }
    }

    let restoredOnce = false;

    async function refreshGraphData(force) {
      let graph;
      try {
        graph = await send({ op: 'query', target: 'graph-keeper', type: 'get-graph', payload: { force: !!force }, timeoutMs: 30000 });
      } catch (e) {
        document.getElementById('header-status').textContent = 'graph-keeper unreachable — Ronin may be offline';
        return;
      }
      if (!graph) return;

      lastGraph = graph;
      nodesById = new Map(graph.nodes.map(n => [n.id, n]));
      edgesById = new Map(graph.edges.map(e => [e.id, e]));
      document.getElementById('header-status').textContent = 'live — ' + new Date(graph.derivedAt).toLocaleTimeString();

      if (!restoredOnce) {
        restoredOnce = true;
        const saved = loadLayout();
        for (const id of saved.placed) if (nodesById.has(id)) placedIds.add(id);
      }

      // Drop placed nodes that no longer exist (e.g. a refused proposal).
      for (const id of [...placedIds]) if (!nodesById.has(id)) placedIds.delete(id);

      renderPalette();
      syncCanvas();
    }

    function renderPalette() {
      const search = (document.getElementById('palette-search').value || '').toLowerCase();
      const groups = { duty: [], contract: [], kata: [] };
      for (const n of nodesById.values()) {
        if (!groups[n.kind]) continue; // sensors/phantoms never listed — they ride along with their owner
        if (search && !n.name.toLowerCase().includes(search)) continue;
        groups[n.kind].push(n);
      }
      for (const key of Object.keys(groups)) groups[key].sort((a, b) => a.name.localeCompare(b.name));

      const labelFor = { duty: 'Duties', contract: 'Contracts', kata: 'Katas' };
      let html = '';
      for (const kind of ['duty', 'contract', 'kata']) {
        const items = groups[kind];
        if (items.length === 0) continue;
        html += '<div class="palette-group-label">' + labelFor[kind] + ' (' + items.length + ')</div>';
        html += items.map((n) =>
          '<div class="palette-item' + (placedIds.has(n.id) ? ' placed' : '') + '" draggable="true" data-id="' + escapeHtml(n.id) + '" title="Drag onto canvas, or click to add">' +
          '<span class="p-dot" style="background:' + colorForKind(n.kind) + '"></span>' +
          escapeHtml(n.name) + (n.ghost ? ' <em style="opacity:0.6">(pending)</em>' : '') +
          '</div>'
        ).join('');
      }
      const list = document.getElementById('palette-list');
      list.innerHTML = html || '<div class="palette-empty">Nothing matches.</div>';

      list.querySelectorAll('.palette-item').forEach((el) => {
        el.addEventListener('dragstart', (evt) => {
          evt.dataTransfer.setData('text/plain', el.dataset.id);
          evt.dataTransfer.effectAllowed = 'copy';
        });
        el.addEventListener('click', () => placeNode(el.dataset.id, null));
      });
    }

    function placeNode(nodeId, dropPosition) {
      if (!nodesById.has(nodeId)) return;
      const newlyPlaced = [];
      if (!placedIds.has(nodeId)) { placedIds.add(nodeId); newlyPlaced.push(nodeId); }
      for (const sid of sensorIdsFor(nodeId)) {
        if (nodesById.has(sid) && !placedIds.has(sid)) { placedIds.add(sid); newlyPlaced.push(sid); }
      }
      renderPalette();
      syncCanvas(dropPosition ? { [nodeId]: dropPosition } : {}, newlyPlaced);
      saveLayout();
    }

    function removeNode(nodeId) {
      placedIds.delete(nodeId);
      if (selectedNodeId === nodeId) selectNode(null);
      renderPalette();
      syncCanvas();
      saveLayout();
    }

    function clearCanvas() {
      placedIds.clear();
      renderPalette();
      syncCanvas();
      saveLayout();
    }

    /** Reconcile cy's actual elements with what placedIds/edgesById say should
     *  be shown — adds/removes/updates in place so existing node positions
     *  are never disturbed, and only genuinely new elements get laid out. */
    function syncCanvas(explicitPositions, newlyPlacedIds) {
      explicitPositions = explicitPositions || {};
      newlyPlacedIds = newlyPlacedIds || [];

      const phantomIds = new Set();
      const desiredEdges = new Map();
      for (const e of edgesById.values()) {
        if (!placedIds.has(e.sourceNodeId)) continue;
        if (e.danglingTarget && !nodesById.has(e.targetNodeId)) {
          phantomIds.add(e.targetNodeId);
          desiredEdges.set(e.id, e);
        } else if (placedIds.has(e.targetNodeId)) {
          desiredEdges.set(e.id, e);
        }
      }
      const desiredNodeIds = new Set([...placedIds, ...phantomIds]);

      document.getElementById('canvas-hint').style.display = placedIds.size === 0 ? 'block' : 'none';
      document.getElementById('node-count').textContent = placedIds.size + ' / ' + nodesById.size + ' shown';
      document.getElementById('edge-count').textContent = desiredEdges.size + ' edges';

      if (!cy) {
        cy = cytoscape({
          container: document.getElementById('cy'),
          elements: [],
          style: [
            { selector: 'node', style: {
                'background-color': (el) => colorForKind(el.data('kind')),
                'label': 'data(label)',
                'color': '${dramTheme.colors.textPrimary}',
                'font-size': '10px',
                'text-valign': 'bottom',
                'text-margin-y': 4,
                'width': 30, 'height': 30,
              } },
            { selector: 'node.ghost', style: { 'border-width': 2, 'border-style': 'dashed', 'border-color': '#fff', 'opacity': 0.55 } },
            { selector: 'node.sensor', style: { width: 14, height: 14 } },
            { selector: 'node.phantom', style: { shape: 'diamond', width: 12, height: 12, 'border-width': 1, 'border-style': 'dashed', 'border-color': FORGE_DANGER, 'font-style': 'italic' } },
            { selector: 'node.simulated', style: { 'border-width': 3, 'border-color': FORGE_CYAN } },
            { selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#ffffff' } },
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
            { selector: 'edge.live', style: { 'line-color': FORGE_CYAN, 'target-arrow-color': FORGE_CYAN } },
            { selector: 'edge.hot', style: { width: 4, opacity: 1 } },
          ],
          layout: { name: 'preset' },
        });
        bindTooltipEvents();
        bindCanvasDragDrop();
        bindNodeRemoval();
        bindPositionPersistence();
        bindSelection();
      }

      // Remove elements no longer desired. Removing a node removes its
      // incident edges automatically; the explicit edge pass after catches
      // any edge that should disappear while both endpoints remain (e.g. an
      // edge kind that's no longer derivable).
      cy.nodes().forEach((n) => { if (!desiredNodeIds.has(n.id())) cy.remove(n); });
      cy.edges().forEach((e) => { if (cy.getElementById(e.id()).length && !desiredEdges.has(e.id())) cy.remove(e); });

      // Update data on nodes already present (e.g. ghost -> solid). Only
      // touch the base kind/ghost classes — .classes(...) replaces the
      // whole class string, which would otherwise silently wipe transient
      // UI state like .selected or .simulated every time the graph re-syncs.
      for (const id of desiredNodeIds) {
        const n = nodesById.get(id);
        if (!n) continue; // phantom
        const el = cy.getElementById(id);
        if (el.length) {
          el.data({ label: n.name, kind: n.kind, ghost: n.ghost });
          el.removeClass('duty contract kata sensor ghost');
          el.addClass((n.ghost ? 'ghost ' : '') + n.kind);
        }
      }

      const savedPositions = loadLayout().positions || {};
      const toAdd = [];
      const genuinelyNewIds = [];
      for (const id of desiredNodeIds) {
        if (cy.getElementById(id).length > 0) continue;
        const n = nodesById.get(id);
        const el = n
          ? { data: { id: n.id, label: n.name, kind: n.kind, ghost: n.ghost }, classes: (n.ghost ? 'ghost ' : '') + n.kind }
          : { data: { id, label: id.split(':').slice(1).join(':') + ' (missing)', kind: 'phantom' }, classes: 'phantom' };
        const pos = explicitPositions[id] || savedPositions[id];
        if (pos) el.position = pos;
        else genuinelyNewIds.push(id);
        toAdd.push(el);
      }
      for (const [id, e] of desiredEdges) {
        if (cy.getElementById(id).length > 0) continue;
        toAdd.push({
          data: { id: e.id, source: e.sourceNodeId, target: e.targetNodeId, kind: e.kind, dangling: e.danglingTarget, eventName: e.eventName, eventType: e.eventType },
          classes: (e.danglingTarget ? 'dangling ' : '') + e.kind,
        });
      }
      if (toAdd.length) cy.add(toAdd);

      // Lay out only elements with no known position (freshly added, no
      // explicit drop position, no saved position) — everything else stays
      // exactly where it already was.
      if (genuinelyNewIds.length > 0) {
        const toLayout = cy.collection();
        for (const id of genuinelyNewIds) {
          const el = cy.getElementById(id);
          if (el.length) toLayout.merge(el);
        }
        if (toLayout.length > 0) {
          toLayout.layout({ name: 'cose', animate: false, fit: false, randomize: true, nodeRepulsion: 8000 }).run();
        }
      }
    }

    function bindCanvasDragDrop() {
      const container = document.getElementById('cy');
      container.addEventListener('dragover', (evt) => evt.preventDefault());
      container.addEventListener('drop', (evt) => {
        evt.preventDefault();
        const nodeId = evt.dataTransfer.getData('text/plain');
        if (!nodeId) return;
        const rect = container.getBoundingClientRect();
        const pan = cy.pan();
        const zoom = cy.zoom();
        const pos = { x: (evt.clientX - rect.left - pan.x) / zoom, y: (evt.clientY - rect.top - pan.y) / zoom };
        placeNode(nodeId, pos);
      });
    }

    function bindNodeRemoval() {
      cy.on('dbltap', 'node', (evt) => {
        if (evt.target.hasClass('phantom')) return;
        removeNode(evt.target.id());
      });
    }

    // Select a node (single tap) to enable "Expand connections" — pulls in
    // every node directly connected to it that isn't already on canvas, and
    // draws the real edges to them. Tapping empty canvas deselects.
    let selectedNodeId = null;

    function bindSelection() {
      cy.on('tap', 'node', (evt) => {
        if (evt.target.hasClass('phantom')) return;
        selectNode(evt.target.id());
      });
      cy.on('tap', (evt) => {
        if (evt.target === cy) selectNode(null);
      });
    }

    function selectNode(id) {
      cy.nodes().removeClass('selected');
      selectedNodeId = id;
      if (id) {
        const el = cy.getElementById(id);
        if (el.length) el.addClass('selected');
      }
      const btn = document.getElementById('btn-expand');
      if (id && nodesById.has(id)) {
        btn.disabled = false;
        btn.textContent = '🔗 Expand ' + nodesById.get(id).name;
      } else {
        btn.disabled = true;
        btn.textContent = '🔗 Expand connections';
      }
      openCodePanel(id);
    }

    let codePanelRequestSeq = 0;

    async function openCodePanel(id) {
      const panel = document.getElementById('code-panel');
      if (!id || !nodesById.has(id)) {
        panel.classList.remove('open');
        return;
      }
      const node = nodesById.get(id);
      panel.classList.add('open');
      document.getElementById('code-panel-title').textContent = node.kind + ': ' + node.name;
      document.getElementById('code-panel-body').innerHTML = '<div class="palette-empty">Loading…</div>';

      const mySeq = ++codePanelRequestSeq;
      let source;
      try {
        source = await send({ op: 'query', target: 'graph-keeper', type: 'get-node-source', payload: { id }, timeoutMs: 10000 });
      } catch (e) {
        if (mySeq !== codePanelRequestSeq) return; // a newer selection superseded this request
        document.getElementById('code-panel-body').innerHTML = '<div class="palette-empty">Failed to load: ' + escapeHtml(e.message) + '</div>';
        return;
      }
      if (mySeq !== codePanelRequestSeq) return; // user selected something else while this was in flight

      const body = document.getElementById('code-panel-body');
      if (!source) {
        body.innerHTML = '<div class="palette-empty">No source available for this node.</div>';
        return;
      }
      const note = source.reconstructed
        ? '<div id="code-panel-note">Reconstructed from stored fields — not a real file on disk.</div>'
        : '';
      body.innerHTML = note + '<pre>' + escapeHtml(source.code) + '</pre>';
    }

    function expandConnections(nodeId) {
      if (!nodeId || !nodesById.has(nodeId)) return;
      const toPlace = new Set();
      for (const e of edgesById.values()) {
        if (e.sourceNodeId === nodeId && nodesById.has(e.targetNodeId) && !placedIds.has(e.targetNodeId)) toPlace.add(e.targetNodeId);
        if (e.targetNodeId === nodeId && nodesById.has(e.sourceNodeId) && !placedIds.has(e.sourceNodeId)) toPlace.add(e.sourceNodeId);
      }
      if (toPlace.size === 0) return;

      const newlyPlaced = [];
      for (const id of toPlace) {
        placedIds.add(id);
        newlyPlaced.push(id);
        for (const sid of sensorIdsFor(id)) {
          if (nodesById.has(sid) && !placedIds.has(sid)) { placedIds.add(sid); newlyPlaced.push(sid); }
        }
      }
      renderPalette();
      syncCanvas({}, newlyPlaced);
      saveLayout();
    }

    function bindPositionPersistence() {
      let saveTimer = null;
      cy.on('dragfree', 'node', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveLayout, 300);
      });
    }

    function bindTooltipEvents() {
      const tooltip = document.getElementById('tooltip');

      cy.on('mouseover', 'node', (evt) => {
        const node = nodesById.get(evt.target.id());
        if (!node || evt.target.hasClass('phantom')) {
          if (evt.target.hasClass('phantom')) {
            tooltip.innerHTML = tooltipHeader('phantom', evt.target.data('label'), FORGE_DANGER) +
              '<div class="tt-warn">This node does not exist in the real system — something points at it that shouldn\\'t.</div>';
            tooltip.classList.add('open');
          }
          return;
        }
        tooltip.innerHTML = renderNodeTooltip(node);
        tooltip.classList.add('open');
      });
      cy.on('mouseover', 'edge', (evt) => {
        const edge = edgesById.get(evt.target.id());
        if (!edge) return;
        tooltip.innerHTML = renderEdgeTooltip(edge);
        tooltip.classList.add('open');
      });
      cy.on('mouseout', 'node, edge', () => {
        tooltip.classList.remove('open');
      });
      cy.on('mousemove', (evt) => {
        if (!tooltip.classList.contains('open')) return;
        const orig = evt.originalEvent;
        if (!orig) return;
        const x = orig.clientX + 16;
        const y = orig.clientY + 16;
        const maxX = window.innerWidth - 360;
        const maxY = window.innerHeight - 40;
        tooltip.style.left = Math.min(x, maxX) + 'px';
        tooltip.style.top = Math.min(y, maxY) + 'px';
      });
    }

    function tooltipHeader(kind, name, color) {
      return '<div class="tt-header"><span class="tt-swatch" style="background:' + color + '"></span>' +
        '<span class="tt-title">' + escapeHtml(name) + '</span></div>' +
        '<div class="tt-kind">' + escapeHtml(kind) + '</div>';
    }

    function portList(label, items, dotColor) {
      if (!items || items.length === 0) return '';
      return '<div class="tt-section"><div class="tt-label">' + escapeHtml(label) + '</div>' +
        items.map((i) => '<div class="tt-port-row"><span class="tt-dot" style="background:' + dotColor + '"></span>' + escapeHtml(i) + '</div>').join('') +
        '</div>';
    }

    function renderNodeTooltip(node) {
      const color = colorForKind(node.kind);
      let html = tooltipHeader(node.kind, node.name, color);
      if (node.ghost) html += '<div class="tt-warn">Ghost — pending proposal' + (node.proposalId ? ' (' + escapeHtml(node.proposalId) + ')' : '') + '</div>';
      if (node.description) html += '<div class="tt-desc">' + escapeHtml(node.description) + '</div>';

      if (node.kind === 'duty') {
        html += portList('Consumes (in)', node.ports.eventsIn, FORGE_AMBER);
        html += portList('Emits (out)', node.ports.eventsOut, FORGE_AMBER);
        html += portList('Beams to', node.ports.beamsOut.map(b => b.target + ' · ' + b.eventType), FORGE_AMBER);
        html += portList('Queries', node.ports.queriesOut.map(q => q.target + ' · ' + q.queryType), FORGE_CYAN);
        html += portList('Serves queries', node.ports.queriesServed, FORGE_CYAN);
        html += portList('Tools', node.tools.map(t => t.name), FORGE_CYAN);
        html += portList('Skills', node.skills.map(s => s.name), FORGE_CYAN);
        if (node.schedule) html += '<div class="tt-section"><div class="tt-label">Schedule</div>' + escapeHtml(node.schedule) + '</div>';
        if (node.webhook) html += '<div class="tt-section"><div class="tt-label">Webhook</div>' + escapeHtml(node.webhook) + '</div>';
        const hasAnyPort = node.ports.eventsIn.length || node.ports.eventsOut.length || node.ports.beamsOut.length ||
          node.ports.queriesOut.length || node.ports.queriesServed.length || node.tools.length || node.skills.length || node.schedule || node.webhook;
        if (!hasAnyPort) html += '<div class="tt-empty">No declared or scanned topology.</div>';
      } else if (node.kind === 'contract') {
        html += '<div class="tt-section"><div class="tt-label">Trigger</div>' +
          (node.triggerType === 'cron' ? 'cron: ' + escapeHtml(node.cronExpression || '') :
           node.triggerType === 'event' ? 'event: ' + escapeHtml(node.eventName || '') :
           'webhook: ' + escapeHtml(node.webhookPath || '')) + '</div>';
        html += '<div class="tt-section"><div class="tt-label">Runs</div>kata ' + escapeHtml(node.targetName) + (node.targetVersion ? ' ' + escapeHtml(node.targetVersion) : '') + '</div>';
        html += '<div class="tt-section"><div class="tt-label">Status</div>' + (node.active ? 'active' : node.approvalStatus === 'pending' ? 'pending approval' : 'inactive') + '</div>';
        if (node.nextExecutions && node.nextExecutions.length) {
          html += portList('Next runs', node.nextExecutions.slice(0, 3).map(d => new Date(d).toLocaleString()), FORGE_GOLD);
        }
      } else if (node.kind === 'kata') {
        html += '<div class="tt-section"><div class="tt-label">Phases</div>' +
          (node.phases.length
            ? node.phases.map(p => '<div class="tt-port-row"><span class="tt-dot" style="background:' + FORGE_KATA + '"></span>' +
                escapeHtml(p.name) + (p.skill ? ' (' + escapeHtml(p.skill) + ')' : '') + (p.next ? ' → ' + escapeHtml(p.next) : '') + '</div>').join('')
            : '<span class="tt-empty">No phases derived.</span>') +
          '</div>';
      } else if (node.kind === 'sensor') {
        html += '<div class="tt-section"><div class="tt-label">' + escapeHtml(node.sensorType) + '</div>' +
          Object.entries(node.config || {}).map(([k, v]) => escapeHtml(k) + ': ' + escapeHtml(String(v))).join('<br>') + '</div>';
      }
      return html;
    }

    function renderEdgeTooltip(edge) {
      const source = nodesById.get(edge.sourceNodeId);
      const target = nodesById.get(edge.targetNodeId);
      const color = colorForEdgeKind(edge.kind, edge.danglingTarget);
      let html = tooltipHeader(edge.kind, (source ? source.name : edge.sourceNodeId) + ' → ' + (target ? target.name : edge.targetNodeId), color);
      if (edge.kind === 'broadcast') html += '<div class="tt-section"><div class="tt-label">Event</div>' + escapeHtml(edge.eventName) + '</div>';
      if (edge.kind === 'beam') html += '<div class="tt-section"><div class="tt-label">Beam</div>' + escapeHtml(edge.eventType) + '</div>';
      if (edge.kind === 'query') html += '<div class="tt-section"><div class="tt-label">Query</div>' + escapeHtml(edge.queryType) + ' (timeout ' + edge.timeoutMs + 'ms)</div>';
      html += '<div class="tt-section"><div class="tt-label">Derivation</div>' + escapeHtml(edge.derivation) + '</div>';
      if (edge.danglingTarget) html += '<div class="tt-warn">Target does not exist — likely a rename or a typo.</div>';
      if (edge.ghost) html += '<div class="tt-warn">Ghost — part of a pending proposal.</div>';
      return html;
    }

    // --- Propose Contract panel ---------------------------------------
    let pendingContractProposal = null;

    document.getElementById('palette-new-contract').onclick = () => {
      document.getElementById('contract-panel').classList.add('open');
    };
    document.getElementById('contract-cancel-btn').onclick = () => {
      document.getElementById('contract-panel').classList.remove('open');
      resetContractPanel();
    };
    function resetContractPanel() {
      pendingContractProposal = null;
      document.getElementById('contract-preview').style.display = 'none';
      document.getElementById('contract-name-wrap').style.display = 'none';
      document.getElementById('contract-decide-actions').style.display = 'none';
      document.getElementById('contract-status').textContent = '';
      document.getElementById('contract-intent').value = '';
      document.getElementById('contract-name-field').value = '';
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
        document.getElementById('contract-name-field').value = result.data.contractName;
        document.getElementById('contract-name-wrap').style.display = 'block';
        document.getElementById('contract-decide-actions').style.display = 'flex';
        document.getElementById('contract-status').textContent = 'Drafted — placing as a ghost node on canvas.';
        await refreshGraphData(true);
        placeNode('contract:' + result.data.contractName, null);
      } catch (e) {
        document.getElementById('contract-status').textContent = 'Failed: ' + e.message;
      }
    };

    async function decideContractProposal(action) {
      if (!pendingContractProposal) return;
      document.getElementById('contract-status').textContent = action === 'approve' ? 'Approving…' : 'Refusing…';
      try {
        const nameField = document.getElementById('contract-name-field').value.trim();
        const originalGhostId = 'contract:' + pendingContractProposal.contractName;
        const res = await fetch('/api/contracts/proposals/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'approve' ? { id: pendingContractProposal.id, name: nameField } : { id: pendingContractProposal.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          document.getElementById('contract-status').textContent = action === 'approve' ? 'Approved.' : 'Refused.';
          document.getElementById('contract-panel').classList.remove('open');
          resetContractPanel();
          if (action === 'approve' && body.contractName) {
            await settleAndReveal(originalGhostId, 'contract:' + body.contractName);
          } else {
            refreshGraphData(true);
          }
        } else {
          document.getElementById('contract-status').textContent = 'Failed: ' + (body.message || res.statusText);
        }
      } catch (e) {
        document.getElementById('contract-status').textContent = 'Failed: network error';
      }
    }
    document.getElementById('contract-allow-btn').onclick = () => decideContractProposal('approve');
    document.getElementById('contract-refuse-btn').onclick = () => decideContractProposal('refuse');

    // After approving a proposal (possibly renamed), the ghost placeholder's
    // id may no longer match the real thing that just landed — drop the old
    // one, wait briefly for it to actually exist, then place, select, and
    // center on it so "where did the thing I just made go" has one obvious answer.
    async function settleAndReveal(oldId, newId) {
      if (oldId !== newId) placedIds.delete(oldId);
      await new Promise((r) => setTimeout(r, 1200));
      await refreshGraphData(true);
      placeNode(newId, null);
      selectNode(newId);
      if (cy) {
        const el = cy.getElementById(newId);
        if (el.length) cy.animate({ center: { eles: el }, zoom: Math.max(cy.zoom(), 1) }, { duration: 400 });
      }
    }

    // --- Propose Duty panel -------------------------------------------
    let pendingDutyProposal = null;

    document.getElementById('palette-new-duty').onclick = () => {
      document.getElementById('duty-panel').classList.add('open');
    };
    document.getElementById('duty-cancel-btn').onclick = () => {
      document.getElementById('duty-panel').classList.remove('open');
      resetDutyPanel();
    };
    function resetDutyPanel() {
      pendingDutyProposal = null;
      document.getElementById('duty-preview').style.display = 'none';
      document.getElementById('duty-name-wrap').style.display = 'none';
      document.getElementById('duty-code-details').style.display = 'none';
      document.getElementById('duty-decide-actions').style.display = 'none';
      document.getElementById('duty-status').textContent = '';
      document.getElementById('duty-intent').value = '';
      document.getElementById('duty-name-field').value = '';
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
        document.getElementById('duty-name-field').value = result.data.dutyName;
        document.getElementById('duty-name-wrap').style.display = 'block';
        document.getElementById('duty-code').textContent = result.data.code;
        document.getElementById('duty-code-details').style.display = 'block';
        document.getElementById('duty-decide-actions').style.display = 'flex';
        document.getElementById('duty-status').textContent = 'Drafted — placing as a ghost node on canvas.';
        await refreshGraphData(true);
        placeNode('duty:' + result.data.dutyName, null);
      } catch (e) {
        document.getElementById('duty-status').textContent = 'Failed: ' + e.message;
      }
    };

    async function decideDutyProposal(action) {
      if (!pendingDutyProposal) return;
      document.getElementById('duty-status').textContent = action === 'approve' ? 'Approving…' : 'Refusing…';
      try {
        const nameField = document.getElementById('duty-name-field').value.trim();
        const originalGhostId = 'duty:' + pendingDutyProposal.dutyName;
        const res = await fetch('/api/duties/proposals/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'approve' ? { id: pendingDutyProposal.id, dutyName: nameField } : { id: pendingDutyProposal.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          document.getElementById('duty-status').textContent = action === 'approve'
            ? 'Approved — live within moments once HotReloadService picks up the file.'
            : 'Refused.';
          document.getElementById('duty-panel').classList.remove('open');
          resetDutyPanel();
          if (action === 'approve' && body.dutyName) {
            await settleAndReveal(originalGhostId, 'duty:' + body.dutyName);
          } else {
            refreshGraphData(true);
          }
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

    document.getElementById('palette-search').addEventListener('input', renderPalette);
    document.getElementById('btn-clear-canvas').onclick = clearCanvas;
    document.getElementById('btn-expand').onclick = () => expandConnections(selectedNodeId);
    document.getElementById('code-panel-close').onclick = () => selectNode(null);

    connect();
  </script>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
}
