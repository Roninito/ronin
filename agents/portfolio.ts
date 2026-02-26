import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import {
  roninTheme,
  getAdobeCleanFontFaceCSS,
  getThemeCSS,
  getHeaderBarCSS,
  getHeaderHomeIconHTML,
} from "../src/utils/theme.js";

// ─── Data Shapes ────────────────────────────────────────────────────────────

interface Position {
  symbol: string;
  qty: number;
  entryPrice: number;
  currentPrice: number;
  value: number;
  unrealizedPnl: number;
  agent: string;
  confidence: number;
}

interface Trade {
  id: string;
  date: string;
  symbol: string;
  action: "BUY" | "SELL";
  qty: number;
  price: number;
  agent: string;
  confidence: number;
  pnl?: number;
  correct?: boolean;
}

interface AgentPerf {
  name: string;
  votes: number;
  correct: number;
  accuracy: number;
  weight: number;
  trend: "up" | "flat" | "down";
  trustScore: number;
}

interface TaskRecord {
  id: string;
  name: string;
  status: "completed" | "running" | "failed";
  startedAt: string;
  completedAt?: string;
  duration?: number;
  phases: string[];
  gitCommit?: string;
}

interface PortfolioStats {
  totalValue: number;
  dayChange: number;
  dayChangePct: number;
  ytdReturn: number;
  ytdReturnPct: number;
  positions: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
}

// ─── Alpaca connection check ─────────────────────────────────────────────────

function alpacaStatus(api: AgentAPI): { connected: boolean; mode: "live" | "paper" } {
  try {
    const cfg = api.config.getAll().alpaca;
    return {
      connected: !!(cfg?.apiKey && cfg?.secretKey),
      mode: (cfg?.mode as "live" | "paper") ?? "paper",
    };
  } catch {
    return { connected: false, mode: "paper" };
  }
}

// ─── Shared CSS helpers ──────────────────────────────────────────────────────

function sharedCSS(): string {
  return `
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

    body { min-height: 100vh; padding: 0; font-size: 0.8125rem; }

    .nav-tabs {
      background: ${roninTheme.colors.backgroundSecondary};
      border-bottom: 1px solid ${roninTheme.colors.border};
      padding: 0 ${roninTheme.spacing.lg};
      display: flex;
      gap: 0;
      overflow-x: auto;
    }
    .nav-tab {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.lg};
      color: ${roninTheme.colors.textTertiary};
      text-decoration: none;
      border-bottom: 2px solid transparent;
      font-size: 0.8125rem;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .nav-tab:hover { color: ${roninTheme.colors.textSecondary}; }
    .nav-tab.active {
      color: ${roninTheme.colors.link};
      border-bottom-color: ${roninTheme.colors.link};
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.lg};
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: ${roninTheme.spacing.md};
      margin-bottom: ${roninTheme.spacing.xl};
    }

    .stat-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.lg};
      transition: all 0.3s;
    }
    .stat-card:hover { border-color: ${roninTheme.colors.borderHover}; }
    .stat-card .label {
      color: ${roninTheme.colors.textTertiary};
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: ${roninTheme.spacing.xs};
    }
    .stat-card .value {
      font-size: 1.5rem;
      font-weight: 300;
      color: ${roninTheme.colors.textPrimary};
    }
    .stat-card .sub {
      font-size: 0.6875rem;
      color: ${roninTheme.colors.textTertiary};
      margin-top: ${roninTheme.spacing.xs};
    }
    .positive { color: ${roninTheme.colors.success} !important; }
    .negative { color: ${roninTheme.colors.error} !important; }

    .section { margin-bottom: ${roninTheme.spacing.xl}; }
    .section-title {
      font-size: 0.9375rem;
      font-weight: 300;
      margin-bottom: ${roninTheme.spacing.md};
      padding-bottom: ${roninTheme.spacing.sm};
      border-bottom: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
    }

    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    th {
      text-align: left;
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      color: ${roninTheme.colors.textTertiary};
      font-weight: 400;
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    td {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      border-bottom: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
    }
    tr:hover td { background: ${roninTheme.colors.backgroundTertiary}; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.6875rem;
    }
    .badge-buy { background: rgba(40,167,69,0.15); color: ${roninTheme.colors.success}; }
    .badge-sell { background: rgba(220,53,69,0.15); color: ${roninTheme.colors.error}; }
    .badge-completed { background: rgba(40,167,69,0.15); color: ${roninTheme.colors.success}; }
    .badge-running { background: rgba(245,158,11,0.15); color: ${roninTheme.colors.warning}; }
    .badge-failed { background: rgba(220,53,69,0.15); color: ${roninTheme.colors.error}; }

    .chart-box {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.lg};
    }
    .chart-box h3 {
      font-size: 0.8125rem;
      font-weight: 400;
      margin-bottom: ${roninTheme.spacing.md};
      color: ${roninTheme.colors.textSecondary};
    }
    .chart-box canvas { width: 100% !important; max-height: 280px; }

    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.xl};
    }

    .empty-state {
      text-align: center;
      padding: ${roninTheme.spacing.xl};
      color: ${roninTheme.colors.textTertiary};
    }

    .filter-bar {
      display: flex;
      gap: ${roninTheme.spacing.sm};
      margin-bottom: ${roninTheme.spacing.md};
      flex-wrap: wrap;
    }
    .filter-bar select, .filter-bar input {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: ${roninTheme.spacing.xs} ${roninTheme.spacing.sm};
      border-radius: ${roninTheme.borderRadius.md};
      font-size: 0.8125rem;
    }

    .trend-up { color: ${roninTheme.colors.success}; }
    .trend-down { color: ${roninTheme.colors.error}; }
    .trend-flat { color: ${roninTheme.colors.textTertiary}; }

    .progress-bar {
      width: 100%;
      height: 4px;
      background: ${roninTheme.colors.border};
      border-radius: 2px;
      overflow: hidden;
      margin-top: 4px;
    }
    .progress-fill {
      height: 100%;
      background: ${roninTheme.colors.link};
      border-radius: 2px;
      transition: width 0.4s;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: ${roninTheme.spacing.xs};
      color: ${roninTheme.colors.textTertiary};
      margin-bottom: ${roninTheme.spacing.md};
      font-size: 0.8125rem;
      text-decoration: none;
    }
    .back-link:hover { color: ${roninTheme.colors.link}; }

    .phase-chip {
      display: inline-block;
      background: ${roninTheme.colors.backgroundTertiary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: 10px;
      padding: 2px 8px;
      font-size: 0.6875rem;
      color: ${roninTheme.colors.textTertiary};
      margin: 2px;
    }

    @media (max-width: 900px) {
      .charts-grid { grid-template-columns: 1fr; }
      .cards { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
    }
  `;
}

function navTabs(active: string): string {
  const tabs = [
    { path: "/portfolio", label: "Dashboard" },
    { path: "/portfolio/agents", label: "Agents" },
    { path: "/portfolio/trades", label: "Trades" },
    { path: "/portfolio/tasks", label: "Tasks" },
    { path: "/portfolio/settings", label: "⚙ Settings" },
  ];
  return `<nav class="nav-tabs">${tabs.map(t =>
    `<a href="${t.path}" class="nav-tab${t.path === active ? " active" : ""}">${t.label}</a>`
  ).join("")}</nav>`;
}

function fmtCurrency(n: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ─── Agent ──────────────────────────────────────────────────────────────────

/**
 * Portfolio Management Dashboard Agent
 *
 * Serves a comprehensive web UI for portfolio analytics:
 * - /portfolio          – Main dashboard (summary + positions + recent trades)
 * - /portfolio/agents   – Agent performance leaderboard & trust scores
 * - /portfolio/trades   – Full trade history with filtering
 * - /portfolio/tasks    – Kata / task execution log
 * - /portfolio/assets/:symbol   – Per-asset detail page
 * - /portfolio/comparison/:symbol – Agent prediction vs actual price chart
 * - /portfolio/api/stats         – JSON stats endpoint
 *
 * Data is read from portfolio-vault/ when present; otherwise demo data is used.
 */
export default class PortfolioAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
    console.log("📊 Portfolio dashboard agent ready");
  }

  async execute(): Promise<void> {
    // no-op: this agent is purely HTTP-driven
  }

  // ── Route registration ────────────────────────────────────────────────────

  private registerRoutes(): void {
    this.api.http.registerRoute("/portfolio", this.handleDashboard.bind(this));
    this.api.http.registerRoute("/portfolio/agents", this.handleAgents.bind(this));
    this.api.http.registerRoute("/portfolio/trades", this.handleTrades.bind(this));
    this.api.http.registerRoute("/portfolio/tasks", this.handleTasks.bind(this));
    this.api.http.registerRoute("/portfolio/assets", this.handleAssetsList.bind(this));
    this.api.http.registerRoute("/portfolio/settings", this.handleSettings.bind(this));
    this.api.http.registerRoute("/portfolio/api/stats", this.handleApiStats.bind(this));
    this.api.http.registerRoute("/portfolio/api/close-position", this.handleClosePosition.bind(this));

    // Dynamic routes – handled via prefix matching in the HTTP layer
    this.api.http.registerRoute("/portfolio/assets/", this.handleAssetDetail.bind(this));
    this.api.http.registerRoute("/portfolio/comparison/", this.handleComparison.bind(this));
  }

  // ── Data helpers ──────────────────────────────────────────────────────────

  private async loadStats(): Promise<PortfolioStats | null> {
    try {
      const acct = await this.api.plugins.call("alpaca", "getAccount") as Record<string, string>;
      const totalValue = parseFloat(acct.portfolio_value ?? "0");
      const lastEquity = parseFloat(acct.last_equity ?? "0");
      const dayChange = totalValue - lastEquity;
      const orders = await this.api.plugins.call("alpaca", "getOrderHistory", 200) as Array<Record<string, string>>;
      const filled = orders.filter((o) => o.status === "filled");
      const correct = filled.filter((o) => (parseFloat(o.filled_avg_price ?? "0") > 0)).length;
      return {
        totalValue,
        dayChange,
        dayChangePct: lastEquity > 0 ? (dayChange / lastEquity) * 100 : 0,
        ytdReturn: 0,
        ytdReturnPct: 0,
        positions: 0,
        winRate: filled.length > 0 ? Math.round((correct / filled.length) * 100) : 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        totalTrades: filled.length,
      };
    } catch {
      return null;
    }
  }

  private async loadPositions(): Promise<Position[]> {
    try {
      const raw = await this.api.plugins.call("alpaca", "getPositions") as Array<Record<string, string>>;
      return raw.map((p) => ({
        symbol: p.symbol,
        qty: parseFloat(p.qty),
        entryPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        value: parseFloat(p.market_value),
        unrealizedPnl: parseFloat(p.unrealized_pl),
        agent: "Alpaca",
        confidence: 0,
      }));
    } catch {
      return [];
    }
  }

  private async loadTrades(): Promise<Trade[]> {
    try {
      const raw = await this.api.plugins.call("alpaca", "getOrderHistory", 50) as Array<Record<string, string>>;
      return raw.map((o) => ({
        id: o.id,
        date: o.filled_at ?? o.submitted_at,
        symbol: o.symbol,
        action: o.side === "buy" ? "BUY" : "SELL",
        qty: parseFloat(o.filled_qty ?? o.qty),
        price: parseFloat(o.filled_avg_price ?? "0"),
        agent: "Alpaca",
        confidence: 0,
      }));
    } catch {
      return [];
    }
  }

  private async loadAgents(): Promise<AgentPerf[]> {
    try {
      const rows = await this.api.db.query<{ source_kata: string; total: number; completed: number }>(
        `SELECT source_kata, COUNT(*) as total,
         SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
         FROM tasks_v2 WHERE source_kata IS NOT NULL GROUP BY source_kata`
      );
      return rows.map((r) => ({
        name: r.source_kata,
        votes: r.total,
        correct: r.completed,
        accuracy: r.total > 0 ? Math.round((r.completed / r.total) * 1000) / 10 : 0,
        weight: 0,
        trend: "flat" as const,
        trustScore: r.total > 0 ? r.completed / r.total : 0,
      }));
    } catch {
      return [];
    }
  }

  private async loadTasks(): Promise<TaskRecord[]> {
    try {
      const rows = await this.api.db.query<{
        task_id: string;
        source_kata: string;
        status: string;
        started_at: string;
        completed_at: string | null;
        duration: number | null;
        error_phase: string | null;
      }>(
        `SELECT task_id, source_kata, status, started_at, completed_at, duration, error_phase
         FROM tasks_v2 ORDER BY started_at DESC LIMIT 50`
      );
      return rows.map((r) => ({
        id: r.task_id,
        name: r.source_kata ?? r.task_id,
        status: r.status === "completed" ? "completed" : r.status === "running" ? "running" : "failed",
        startedAt: r.started_at,
        completedAt: r.completed_at ?? undefined,
        duration: r.duration ?? undefined,
        phases: r.error_phase ? [r.error_phase] : [],
      }));
    } catch {
      return [];
    }
  }

  // ── JSON API ──────────────────────────────────────────────────────────────

  private async handleApiStats(_req: Request): Promise<Response> {
    const [stats, positions, trades, agents, tasks] = await Promise.all([
      this.loadStats(),
      this.loadPositions(),
      this.loadTrades(),
      this.loadAgents(),
      this.loadTasks(),
    ]);
    const status = alpacaStatus(this.api);
    return Response.json({ stats, positions, trades, agents, tasks, status, timestamp: new Date().toISOString() });
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  private async handleSettings(req: Request): Promise<Response> {
    if (req.method === "POST") {
      let saveError = "";
      try {
        const form = await req.formData();
        const mode = form.get("mode");
        const apiKey = form.get("apiKey");
        const secretKey = form.get("secretKey");

        // Always save mode
        if (mode === "live" || mode === "paper") {
          await this.api.config.set("alpaca.mode", mode);
        }
        // Only overwrite key/secret if user provided non-empty values
        if (typeof apiKey === "string" && apiKey.trim() !== "") {
          await this.api.config.set("alpaca.apiKey", apiKey.trim());
        }
        if (typeof secretKey === "string" && secretKey.trim() !== "") {
          await this.api.config.set("alpaca.secretKey", secretKey.trim());
        }
      } catch (e) {
        saveError = encodeURIComponent(e instanceof Error ? e.message : String(e));
        return Response.redirect(`/portfolio/settings?error=${saveError}`, 303);
      }
      return Response.redirect("/portfolio/settings?saved=1", 303);
    }

    const alpacaCfg = this.api.config.getAll().alpaca ?? { apiKey: "", secretKey: "", mode: "paper" };
    const connected = !!(alpacaCfg.apiKey && alpacaCfg.secretKey);
    const mode = alpacaCfg.mode ?? "paper";

    const params = new URL(req.url).searchParams;
    const savedBanner = params.get("saved") === "1"
      ? `<div style="background:#14532d;border:1px solid #16a34a;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#86efac">✓ Credentials saved to ~/.ronin/config.json</div>`
      : params.get("error")
        ? `<div style="background:#7f1d1d;border:1px solid #dc2626;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#fca5a5">✗ Save failed: ${decodeURIComponent(params.get("error")!)}</div>`
        : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portfolio Settings</title>
  <style>
    ${sharedCSS()}
    .settings-card { background:${roninTheme.colors.backgroundSecondary};border:1px solid ${roninTheme.colors.border};border-radius:${roninTheme.borderRadius.lg};padding:${roninTheme.spacing.xl};margin-bottom:${roninTheme.spacing.lg}; }
    .settings-card h2 { margin:0 0 0.5rem;font-size:1rem;color:${roninTheme.colors.textPrimary}; }
    .settings-card p { margin:0 0 1rem;font-size:0.8125rem;color:${roninTheme.colors.textTertiary}; }
    .field { margin-bottom:1rem; }
    .field label { display:block;font-size:0.75rem;color:${roninTheme.colors.textTertiary};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em; }
    .field input[type=text], .field input[type=password] { width:100%;background:${roninTheme.colors.background};border:1px solid ${roninTheme.colors.border};border-radius:6px;padding:8px 12px;color:${roninTheme.colors.textPrimary};font-size:0.875rem;box-sizing:border-box; }
    .field input:focus { outline:none;border-color:${roninTheme.colors.link}; }
    .radio-group { display:flex;gap:1.5rem; }
    .radio-option { display:flex;align-items:center;gap:6px;cursor:pointer;color:${roninTheme.colors.textSecondary};font-size:0.875rem; }
    .btn-save { background:${roninTheme.colors.link};color:#000;border:none;padding:10px 24px;border-radius:6px;font-size:0.875rem;font-weight:600;cursor:pointer; }
    .status-dot { width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px; }
    .dot-on { background:#22c55e; }
    .dot-off { background:#6b7280; }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Portfolio Settings</h1>
    <div class="header-meta">
      <span class="status-dot ${connected ? "dot-on" : "dot-off"}"></span>
      <span>${connected ? `Connected · ${mode.toUpperCase()}` : "Not Connected"}</span>
    </div>
  </div>
  ${navTabs("/portfolio/settings")}
  <div class="container" style="max-width:680px">
    ${savedBanner}

    <form method="POST" action="/portfolio/settings">
      <div class="settings-card">
        <h2>Alpaca API Credentials ${connected ? '<span style="color:#22c55e;font-size:0.75rem">● Saved</span>' : ""}</h2>
        <p>Get your API Key ID and Secret Key from <a href="https://app.alpaca.markets" target="_blank" style="color:${roninTheme.colors.link}">app.alpaca.markets</a> → API Keys. Use Paper Trading keys to test safely.</p>
        <div class="field">
          <label>API Key ID</label>
          <input type="text" name="apiKey" placeholder="${connected ? "•••••••••••• (saved — enter new value to replace)" : "Paste your API Key ID"}" autocomplete="off">
        </div>
        <div class="field">
          <label>Secret Key</label>
          <input type="password" name="secretKey" placeholder="${connected ? "•••••••••••• (saved — enter new value to replace)" : "Paste your Secret Key"}" autocomplete="off">
        </div>
      </div>

      <div class="settings-card">
        <h2>Account Mode</h2>
        <p>Paper Trading uses a simulated account — no real money at risk. Switch to Live only when you're ready.</p>
        <div class="field">
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="mode" value="paper" ${mode === "paper" ? "checked" : ""}> 📄 Paper Trading
            </label>
            <label class="radio-option">
              <input type="radio" name="mode" value="live" ${mode === "live" ? "checked" : ""}> 💰 Live Trading
            </label>
          </div>
          ${mode === "live" ? `<p style="color:#dc2626;margin-top:0.5rem;margin-bottom:0">⚠ Live mode uses real money.</p>` : ""}
        </div>
      </div>

      <button type="submit" class="btn-save">Save Settings</button>
      <a href="/portfolio" style="margin-left:1rem;color:${roninTheme.colors.textTertiary};font-size:0.875rem">← Back to Dashboard</a>
    </form>
  </div>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // ── Close position API ────────────────────────────────────────────────────

  private async handleClosePosition(req: Request): Promise<Response> {
    try {
      const { symbol } = await req.json() as { symbol: string };
      await this.api.plugins.call("alpaca", "closePosition", symbol);
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  private async handleDashboard(_req: Request): Promise<Response> {
    const status = alpacaStatus(this.api);
    const [stats, positions, trades] = await Promise.all([
      this.loadStats(),
      this.loadPositions(),
      this.loadTrades(),
    ]);

    const modeBadge = status.connected
      ? status.mode === "live"
        ? `<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.6875rem;font-weight:700;letter-spacing:0.05em">LIVE</span>`
        : `<span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.6875rem;font-weight:700;letter-spacing:0.05em">PAPER</span>`
      : `<a href="/portfolio/settings" style="background:#374151;color:#9ca3af;padding:2px 8px;border-radius:4px;font-size:0.6875rem;font-weight:700;letter-spacing:0.05em;text-decoration:none">NOT CONNECTED</a>`;

    const connectBanner = !status.connected
      ? `<div style="background:#1f2937;border:1px solid #374151;border-radius:8px;padding:1rem 1.5rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:1rem">
           <span style="font-size:1.5rem">🔌</span>
           <div>
             <div style="font-weight:600;color:#f9fafb">Connect your Alpaca account to see live data</div>
             <div style="font-size:0.8125rem;color:#9ca3af;margin-top:2px">Add your API credentials to start tracking positions, orders, and account performance.</div>
           </div>
           <a href="/portfolio/settings" style="margin-left:auto;background:#22c55e;color:#000;padding:6px 16px;border-radius:6px;font-size:0.8125rem;font-weight:600;text-decoration:none;white-space:nowrap">Connect Alpaca →</a>
         </div>`
      : "";

    const posRows = positions.map(p => {
      const pnlClass = p.unrealizedPnl >= 0 ? "positive" : "negative";
      const sign = p.unrealizedPnl >= 0 ? "+" : "";
      return `<tr>
        <td><a href="/portfolio/assets/${p.symbol}" style="color:${roninTheme.colors.link}">${p.symbol}</a></td>
        <td>${p.qty}</td>
        <td>${fmtCurrency(p.entryPrice, 2)}</td>
        <td>${fmtCurrency(p.currentPrice, 2)}</td>
        <td>${fmtCurrency(p.value)}</td>
        <td class="${pnlClass}">${sign}${fmtCurrency(p.unrealizedPnl)}</td>
        <td>${p.agent}</td>
        <td><button onclick="closePosition('${p.symbol}')" style="background:#7f1d1d;color:#fca5a5;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.75rem">Close</button></td>
      </tr>`;
    }).join("");

    const tradeRows = trades.slice(0, 5).map(t => {
      const badgeClass = t.action === "BUY" ? "badge-buy" : "badge-sell";
      return `<tr>
        <td>${fmtDate(t.date)}</td>
        <td><a href="/portfolio/assets/${t.symbol}" style="color:${roninTheme.colors.link}">${t.symbol}</a></td>
        <td><span class="badge ${badgeClass}">${t.action}</span></td>
        <td>${t.qty}</td>
        <td>${fmtCurrency(t.price, 2)}</td>
        <td>${t.agent}</td>
      </tr>`;
    }).join("");

    const totalValue = stats?.totalValue ?? 0;
    const dayChange = stats?.dayChange ?? 0;
    const dayChangePct = stats?.dayChangePct ?? 0;
    const daySign = dayChange >= 0 ? "+" : "";
    const winRate = stats?.winRate ?? 0;
    const totalTrades = stats?.totalTrades ?? 0;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portfolio Dashboard</title>
  <style>${sharedCSS()}</style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Portfolio Dashboard</h1>
    <div class="header-meta">
      ${modeBadge}
      <span style="margin-left:0.75rem">Updated ${new Date().toLocaleTimeString()}</span>
      <a href="/portfolio/settings" style="margin-left:0.75rem;color:${roninTheme.colors.textTertiary};font-size:0.75rem">⚙ Settings</a>
    </div>
  </div>
  ${navTabs("/portfolio")}
  <div class="container">
    ${connectBanner}
    <div class="cards">
      <div class="stat-card">
        <div class="label">Total Value</div>
        <div class="value">${stats ? fmtCurrency(totalValue) : "—"}</div>
      </div>
      <div class="stat-card">
        <div class="label">Day Change</div>
        <div class="value ${dayChange >= 0 ? "positive" : "negative"}">${stats ? daySign + fmtCurrency(dayChange) : "—"}</div>
        ${stats ? `<div class="sub">${daySign}${dayChangePct.toFixed(2)}%</div>` : ""}
      </div>
      <div class="stat-card">
        <div class="label">Positions</div>
        <div class="value">${positions.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Win Rate</div>
        <div class="value">${stats ? winRate + "%" : "—"}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Trades</div>
        <div class="value">${stats ? totalTrades : "—"}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Current Positions</div>
      <table>
        <thead><tr>
          <th>Symbol</th><th>Qty</th><th>Entry</th><th>Current</th>
          <th>Value</th><th>Unrealized P&amp;L</th><th>Agent</th><th>Action</th>
        </tr></thead>
        <tbody>${posRows || `<tr><td colspan="8" class="empty-state">${status.connected ? "No open positions" : '<a href="/portfolio/settings" style="color:#22c55e">Connect Alpaca to view positions →</a>'}</td></tr>`}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Recent Trades <a href="/portfolio/trades" style="font-size:0.75rem;margin-left:1rem">View all →</a></div>
      <table>
        <thead><tr>
          <th>Date</th><th>Symbol</th><th>Action</th><th>Qty</th><th>Price</th><th>Agent</th>
        </tr></thead>
        <tbody>${tradeRows || `<tr><td colspan="6" class="empty-state">${status.connected ? "No recent trades" : '<a href="/portfolio/settings" style="color:#22c55e">Connect Alpaca to view trades →</a>'}</td></tr>`}</tbody>
      </table>
    </div>
  </div>
  <script>
    async function closePosition(symbol) {
      if (!confirm('Close position in ' + symbol + '?')) return;
      const res = await fetch('/portfolio/api/close-position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol }) });
      const data = await res.json();
      if (data.ok) { alert('Position closed'); location.reload(); } else { alert('Error: ' + data.error); }
    }
  </script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // ── Agent Performance ─────────────────────────────────────────────────────

  private async handleAgents(_req: Request): Promise<Response> {
    const agents = await this.loadAgents();

    const rows = agents.map(a => {
      const trendIcon = a.trend === "up" ? "↑" : a.trend === "down" ? "↓" : "→";
      const trendClass = a.trend === "up" ? "trend-up" : a.trend === "down" ? "trend-down" : "trend-flat";
      const incorrect = a.votes - a.correct;
      return `<tr>
        <td style="font-weight:500;color:${roninTheme.colors.textPrimary}">${a.name}</td>
        <td>${a.votes}</td>
        <td>${a.correct}</td>
        <td>${incorrect}</td>
        <td>${a.accuracy.toFixed(1)}%
          <div class="progress-bar"><div class="progress-fill" style="width:${a.accuracy}%"></div></div>
        </td>
        <td>${(a.weight * 100).toFixed(0)}%</td>
        <td>${a.trustScore.toFixed(2)}</td>
        <td class="${trendClass}">${trendIcon}</td>
      </tr>`;
    }).join("");

    const agentNames = JSON.stringify(agents.map(a => a.name));
    const agentAccuracies = JSON.stringify(agents.map(a => a.accuracy));
    const agentWeights = JSON.stringify(agents.map(a => parseFloat((a.weight * 100).toFixed(1))));
    const agentColors = JSON.stringify(["#84cc16","#22d3ee","#f59e0b","#a78bfa","#f472b6","#34d399"]);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Performance</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>${sharedCSS()}</style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Agent Performance</h1>
    <div class="header-meta"><span>Trust scores &amp; analytics</span></div>
  </div>
  ${navTabs("/portfolio/agents")}
  <div class="container">

    <div class="section">
      <div class="section-title">Agent Leaderboard</div>
      <table>
        <thead><tr>
          <th>Agent</th><th>Votes</th><th>Correct</th><th>Incorrect</th>
          <th>Accuracy</th><th>Vote Weight</th><th>Trust Score</th><th>Trend</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="charts-grid">
      <div class="chart-box">
        <h3>Accuracy by Agent (%)</h3>
        <canvas id="accuracyChart"></canvas>
      </div>
      <div class="chart-box">
        <h3>Voting Weight Distribution</h3>
        <canvas id="weightChart"></canvas>
      </div>
    </div>

  </div>
  <script>
    const names = ${agentNames};
    const accuracies = ${agentAccuracies};
    const weights = ${agentWeights};
    const colors = ${agentColors};

    new Chart(document.getElementById('accuracyChart'), {
      type: 'bar',
      data: {
        labels: names,
        datasets: [{ label: 'Accuracy %', data: accuracies, backgroundColor: colors, borderRadius: 4 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } }
        }
      }
    });

    new Chart(document.getElementById('weightChart'), {
      type: 'doughnut',
      data: {
        labels: names,
        datasets: [{ data: weights, backgroundColor: colors, borderWidth: 0 }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right', labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 } } }
        }
      }
    });
  </script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // ── Trade History ─────────────────────────────────────────────────────────

  private async handleTrades(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const filterAgent = url.searchParams.get("agent") || "";
    const filterSymbol = url.searchParams.get("symbol") || "";
    const filterAction = url.searchParams.get("action") || "";

    const allTrades = await this.loadTrades();
    const filtered = allTrades.filter(t =>
      (!filterAgent || t.agent === filterAgent) &&
      (!filterSymbol || t.symbol.toUpperCase().includes(filterSymbol.toUpperCase())) &&
      (!filterAction || t.action === filterAction)
    );

    const agents = [...new Set(allTrades.map(t => t.agent))];
    const agentOptions = agents.map(a => `<option value="${a}"${a === filterAgent ? " selected" : ""}>${a}</option>`).join("");

    const rows = filtered.map(t => {
      const badgeClass = t.action === "BUY" ? "badge-buy" : "badge-sell";
      const pnlStr = t.pnl !== undefined ? `<span class="${t.pnl >= 0 ? "positive" : "negative"}">${t.pnl >= 0 ? "+" : ""}${fmtCurrency(t.pnl)}</span>` : "—";
      const correctIcon = t.correct === true ? `<span class="positive">✓</span>` : t.correct === false ? `<span class="negative">✗</span>` : "—";
      return `<tr>
        <td>${fmtDate(t.date)}</td>
        <td><a href="/portfolio/assets/${t.symbol}" style="color:${roninTheme.colors.link}">${t.symbol}</a></td>
        <td><span class="badge ${badgeClass}">${t.action}</span></td>
        <td>${t.qty}</td>
        <td>${fmtCurrency(t.price, 2)}</td>
        <td>${t.agent}</td>
        <td>${t.confidence}%</td>
        <td>${pnlStr}</td>
        <td>${correctIcon}</td>
      </tr>`;
    }).join("");

    // Win rate over time data
    const winRateData = this.computeWinRateSeries(allTrades);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trade History</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>${sharedCSS()}</style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Trade History</h1>
    <div class="header-meta"><span>${filtered.length} of ${allTrades.length} trades</span></div>
  </div>
  ${navTabs("/portfolio/trades")}
  <div class="container">

    <div class="chart-box">
      <h3>Cumulative Win Rate Over Time</h3>
      <canvas id="winRateChart"></canvas>
    </div>

    <div class="section">
      <div class="filter-bar">
        <form method="get" style="display:flex;gap:8px;flex-wrap:wrap">
          <input name="symbol" placeholder="Symbol…" value="${filterSymbol}" />
          <select name="agent"><option value="">All Agents</option>${agentOptions}</select>
          <select name="action">
            <option value="">All Actions</option>
            <option value="BUY"${filterAction === "BUY" ? " selected" : ""}>BUY</option>
            <option value="SELL"${filterAction === "SELL" ? " selected" : ""}>SELL</option>
          </select>
          <button type="submit">Filter</button>
          <a href="/portfolio/trades" style="padding:4px 12px;color:${roninTheme.colors.textTertiary};align-self:center">Clear</a>
        </form>
      </div>

      <table>
        <thead><tr>
          <th>Date</th><th>Symbol</th><th>Action</th><th>Qty</th>
          <th>Price</th><th>Agent</th><th>Confidence</th><th>P&amp;L</th><th>Correct</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty-state">No trades match the filter</td></tr>'}</tbody>
      </table>
    </div>

  </div>
  <script>
    const labels = ${JSON.stringify(winRateData.labels)};
    const rates  = ${JSON.stringify(winRateData.rates)};
    new Chart(document.getElementById('winRateChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Win Rate %',
          data: rates,
          borderColor: '#84cc16',
          backgroundColor: 'rgba(132,204,22,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)', maxRotation: 0, maxTicksLimit: 8 } }
        }
      }
    });
  </script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  private computeWinRateSeries(trades: Trade[]): { labels: string[]; rates: number[] } {
    const sorted = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const labels: string[] = [];
    const rates: number[] = [];
    let wins = 0;
    let total = 0;
    for (const t of sorted) {
      if (t.correct !== undefined) {
        total++;
        if (t.correct) wins++;
        labels.push(new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        rates.push(total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0);
      }
    }
    return { labels, rates };
  }

  // ── Task Log ──────────────────────────────────────────────────────────────

  private async handleTasks(_req: Request): Promise<Response> {
    const tasks = await this.loadTasks();

    const rows = tasks.map(t => {
      const badgeClass = `badge-${t.status}`;
      const phases = t.phases.map(p => `<span class="phase-chip">${p}</span>`).join("");
      const commit = t.gitCommit ? `<code style="font-size:0.6875rem;color:${roninTheme.colors.textTertiary}">${t.gitCommit}</code>` : "—";
      return `<tr>
        <td style="font-family:${roninTheme.fonts.mono};font-size:0.75rem;color:${roninTheme.colors.textTertiary}">${t.id}</td>
        <td style="color:${roninTheme.colors.textPrimary}">${t.name}</td>
        <td><span class="badge ${badgeClass}">${t.status}</span></td>
        <td>${fmtDate(t.startedAt)}</td>
        <td>${t.completedAt ? fmtDate(t.completedAt) : "—"}</td>
        <td>${fmtDuration(t.duration)}</td>
        <td>${phases}</td>
        <td>${commit}</td>
      </tr>`;
    }).join("");

    const completed = tasks.filter(t => t.status === "completed").length;
    const running = tasks.filter(t => t.status === "running").length;
    const failed = tasks.filter(t => t.status === "failed").length;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Execution Log</title>
  <style>${sharedCSS()}</style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Task Execution Log</h1>
    <div class="header-meta">
      <span class="positive">${completed} completed</span>
      <span style="color:${roninTheme.colors.warning}">&nbsp;${running} running</span>
      <span class="negative">&nbsp;${failed} failed</span>
    </div>
  </div>
  ${navTabs("/portfolio/tasks")}
  <div class="container">
    <div class="section">
      <table>
        <thead><tr>
          <th>ID</th><th>Name</th><th>Status</th><th>Started</th>
          <th>Completed</th><th>Duration</th><th>Phases</th><th>Commit</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-state">No tasks recorded</td></tr>'}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // ── Assets List ───────────────────────────────────────────────────────────

  private async handleAssetsList(_req: Request): Promise<Response> {
    const positions = await this.loadPositions();
    const rows = positions.map(p => {
      const pnlClass = p.unrealizedPnl >= 0 ? "positive" : "negative";
      const sign = p.unrealizedPnl >= 0 ? "+" : "";
      return `<tr>
        <td><a href="/portfolio/assets/${p.symbol}" style="color:${roninTheme.colors.link}">${p.symbol}</a></td>
        <td>${p.qty}</td>
        <td>${fmtCurrency(p.entryPrice, 2)}</td>
        <td>${fmtCurrency(p.currentPrice, 2)}</td>
        <td>${fmtCurrency(p.value)}</td>
        <td class="${pnlClass}">${sign}${fmtCurrency(p.unrealizedPnl)}</td>
        <td>${p.agent}</td>
        <td>${p.confidence}%</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Assets</title>
  <style>${sharedCSS()}</style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Asset Positions</h1>
  </div>
  ${navTabs("")}
  <div class="container">
    <div class="section">
      <table>
        <thead><tr>
          <th>Symbol</th><th>Qty</th><th>Entry</th><th>Current</th>
          <th>Value</th><th>Unrealized P&amp;L</th><th>Agent</th><th>Confidence</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-state">No positions</td></tr>'}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // ── Asset Detail ──────────────────────────────────────────────────────────

  private async handleAssetDetail(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const symbol = url.pathname.replace("/portfolio/assets/", "").toUpperCase();

    if (!symbol) return this.handleAssetsList(req);

    const [positions, trades, agents] = await Promise.all([
      this.loadPositions(),
      this.loadTrades(),
      this.loadAgents(),
    ]);

    const pos = positions.find(p => p.symbol === symbol);
    const assetTrades = trades.filter(t => t.symbol === symbol);

    const posCard = pos ? `
      <div class="cards" style="margin-bottom:${roninTheme.spacing.xl}">
        <div class="stat-card">
          <div class="label">Current Price</div>
          <div class="value">${fmtCurrency(pos.currentPrice, 2)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Quantity</div>
          <div class="value">${pos.qty}</div>
        </div>
        <div class="stat-card">
          <div class="label">Position Value</div>
          <div class="value">${fmtCurrency(pos.value)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Unrealized P&amp;L</div>
          <div class="value ${pos.unrealizedPnl >= 0 ? "positive" : "negative"}">${pos.unrealizedPnl >= 0 ? "+" : ""}${fmtCurrency(pos.unrealizedPnl)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Entry Price</div>
          <div class="value">${fmtCurrency(pos.entryPrice, 2)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Lead Agent</div>
          <div class="value" style="font-size:1.1rem">${pos.agent}</div>
          <div class="sub">${pos.confidence}% confidence</div>
        </div>
      </div>` : `<div class="empty-state">No open position for ${symbol}</div>`;

    const tradeRows = assetTrades.map(t => {
      const badgeClass = t.action === "BUY" ? "badge-buy" : "badge-sell";
      const pnlStr = t.pnl !== undefined ? `<span class="${t.pnl >= 0 ? "positive" : "negative"}">${t.pnl >= 0 ? "+" : ""}${fmtCurrency(t.pnl)}</span>` : "—";
      const correctIcon = t.correct === true ? `<span class="positive">✓</span>` : t.correct === false ? `<span class="negative">✗</span>` : "—";
      return `<tr>
        <td>${fmtDate(t.date)}</td>
        <td><span class="badge ${badgeClass}">${t.action}</span></td>
        <td>${t.qty}</td>
        <td>${fmtCurrency(t.price, 2)}</td>
        <td>${t.agent}</td>
        <td>${t.confidence}%</td>
        <td>${pnlStr}</td>
        <td>${correctIcon}</td>
      </tr>`;
    }).join("");

    // Agent votes on this asset
    const agentVotes = agents
      .filter(a => assetTrades.some(t => t.agent === a.name))
      .map(a => {
        const relevantTrades = assetTrades.filter(t => t.agent === a.name);
        const correct = relevantTrades.filter(t => t.correct).length;
        const total = relevantTrades.filter(t => t.correct !== undefined).length;
        const acc = total > 0 ? ((correct / total) * 100).toFixed(0) : "N/A";
        return `<tr>
          <td>${a.name}</td>
          <td>${relevantTrades.length}</td>
          <td>${acc}%</td>
          <td>${a.trustScore.toFixed(2)}</td>
        </tr>`;
      }).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${symbol} – Asset Detail</title>
  <style>${sharedCSS()}</style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>${symbol}</h1>
    <div class="header-actions">
      <a href="/portfolio/comparison/${symbol}" style="color:${roninTheme.colors.link};font-size:0.8125rem">View Predictions →</a>
    </div>
  </div>
  ${navTabs("")}
  <div class="container">
    <a href="/portfolio" class="back-link">← Back to Dashboard</a>
    ${posCard}

    <div class="section">
      <div class="section-title">Transaction History</div>
      <table>
        <thead><tr>
          <th>Date</th><th>Action</th><th>Qty</th><th>Price</th>
          <th>Agent</th><th>Confidence</th><th>P&amp;L</th><th>Correct</th>
        </tr></thead>
        <tbody>${tradeRows || `<tr><td colspan="8" class="empty-state">No trades for ${symbol}</td></tr>`}</tbody>
      </table>
    </div>

    ${agentVotes ? `
    <div class="section">
      <div class="section-title">Agent Performance on ${symbol}</div>
      <table>
        <thead><tr><th>Agent</th><th>Trades</th><th>Accuracy</th><th>Trust Score</th></tr></thead>
        <tbody>${agentVotes}</tbody>
      </table>
    </div>` : ""}
  </div>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // ── Prediction Comparison ─────────────────────────────────────────────────

  private async handleComparison(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const symbol = url.pathname.replace("/portfolio/comparison/", "").toUpperCase();

    const agents = await this.loadAgents();
    const trades = await this.loadTrades();
    const assetTrades = trades.filter(t => t.symbol === symbol);

    // Simulate prediction data: each agent's "predicted" price relative to trade price
    const days = 14;
    const lastTrade = assetTrades[assetTrades.length - 1];
    const basePrice = lastTrade ? lastTrade.price : 100;
    const labels: string[] = [];
    const now = Date.now();
    for (let i = days; i >= 0; i--) {
      labels.push(new Date(now - i * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    }

    // Synthetic actual price series
    const actualPrices = this.syntheticPriceSeries(basePrice, days + 1, 42);

    // Agent predictions – each slightly off
    const agentPalette = ["#22d3ee", "#f59e0b", "#a78bfa", "#f472b6", "#34d399", "#84cc16"];
    const agentDatasets = agents.slice(0, 4).map((a, i) => ({
      label: a.name,
      data: this.syntheticPriceSeries(basePrice, days + 1, 100 + i * 13),
      borderColor: agentPalette[i] ?? "#22d3ee",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderDash: [4, 3],
      pointRadius: 0,
      tension: 0.3,
    }));

    // Mean of all agents
    const meanData = actualPrices.map((_, idx) =>
      parseFloat((agentDatasets.reduce((s, d) => s + (d.data[idx] ?? 0), 0) / agentDatasets.length).toFixed(2))
    );

    const allDatasets = [
      {
        label: "Actual",
        data: actualPrices,
        borderColor: "#ffffff",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 2,
        fill: false,
        tension: 0.3,
        pointRadius: 2,
      },
      {
        label: "Agent Mean",
        data: meanData,
        borderColor: "#84cc16",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 3],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
      },
      ...agentDatasets,
    ];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${symbol} – Prediction Comparison</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>${sharedCSS()}</style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>${symbol} – Prediction Comparison</h1>
    <div class="header-actions">
      <a href="/portfolio/assets/${symbol}" style="color:${roninTheme.colors.textTertiary};font-size:0.8125rem">← Asset Detail</a>
    </div>
  </div>
  ${navTabs("")}
  <div class="container">
    <a href="/portfolio/assets/${symbol}" class="back-link">← Back to ${symbol}</a>

    <div class="chart-box">
      <h3>Agent Predictions vs Actual Price (last ${days} days)</h3>
      <canvas id="compChart" style="max-height:400px"></canvas>
    </div>

    <div class="section">
      <div class="section-title">Agent Accuracy on ${symbol}</div>
      <table>
        <thead><tr><th>Agent</th><th>Trust Score</th><th>Weight</th><th>Trend</th></tr></thead>
        <tbody>
          ${agents.slice(0, 4).map((a, i) => `
          <tr>
            <td style="color:${agentPalette[i] ?? "#22d3ee"}">${a.name}</td>
            <td>${a.trustScore.toFixed(2)}</td>
            <td>${(a.weight * 100).toFixed(0)}%</td>
            <td class="${a.trend === "up" ? "trend-up" : a.trend === "down" ? "trend-down" : "trend-flat"}">${a.trend === "up" ? "↑" : a.trend === "down" ? "↓" : "→"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>
  <script>
    const chartData = ${JSON.stringify({ labels, datasets: allDatasets })};
    new Chart(document.getElementById('compChart'), {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 } } }
        },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)', maxRotation: 0, maxTicksLimit: 8 } }
        }
      }
    });
  </script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  /** Deterministic synthetic price series for demo purposes */
  private syntheticPriceSeries(base: number, count: number, seed: number): number[] {
    const prices: number[] = [base];
    let s = seed;
    for (let i = 1; i < count; i++) {
      // Simple LCG for determinism
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      const change = ((s & 0xff) / 255 - 0.5) * 0.03;
      prices.push(parseFloat((prices[i - 1]! * (1 + change)).toFixed(2)));
    }
    return prices;
  }
}
