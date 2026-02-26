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

// ─── Default demo data (used when portfolio-vault/ is absent) ────────────────

function defaultStats(): PortfolioStats {
  return {
    totalValue: 102_500,
    dayChange: 850,
    dayChangePct: 0.84,
    ytdReturn: 4_250,
    ytdReturnPct: 4.25,
    positions: 8,
    winRate: 74,
    sharpeRatio: 0.92,
    maxDrawdown: -1.2,
    totalTrades: 127,
  };
}

function defaultPositions(): Position[] {
  return [
    { symbol: "AAPL", qty: 50, entryPrice: 180.0, currentPrice: 185.42, value: 9271, unrealizedPnl: 271, agent: "SWOT", confidence: 88 },
    { symbol: "BTC", qty: 1.5, entryPrice: 43000, currentPrice: 45200, value: 67800, unrealizedPnl: 3300, agent: "PESTLE", confidence: 85 },
    { symbol: "MSFT", qty: 30, entryPrice: 370.0, currentPrice: 382.15, value: 11465, unrealizedPnl: 364.5, agent: "SWOT", confidence: 79 },
    { symbol: "TSLA", qty: 20, entryPrice: 210.0, currentPrice: 198.75, value: 3975, unrealizedPnl: -225, agent: "Regression", confidence: 61 },
    { symbol: "ETH", qty: 5, entryPrice: 2800, currentPrice: 3120, value: 15600, unrealizedPnl: 1600, agent: "PESTLE", confidence: 82 },
    { symbol: "NVDA", qty: 15, entryPrice: 480.0, currentPrice: 520.30, value: 7804.5, unrealizedPnl: 604.5, agent: "SWOT", confidence: 91 },
    { symbol: "AMZN", qty: 25, entryPrice: 178.5, currentPrice: 185.0, value: 4625, unrealizedPnl: 162.5, agent: "Porter", confidence: 75 },
    { symbol: "SPY", qty: 10, entryPrice: 450.0, currentPrice: 462.80, value: 4628, unrealizedPnl: 128, agent: "PESTLE", confidence: 70 },
  ];
}

function defaultTrades(): Trade[] {
  const now = Date.now();
  const day = 86_400_000;
  return [
    { id: "t1", date: new Date(now - 1 * day).toISOString(), symbol: "AAPL", action: "BUY", qty: 50, price: 180.0, agent: "SWOT", confidence: 88, correct: true },
    { id: "t2", date: new Date(now - 2 * day).toISOString(), symbol: "BTC", action: "BUY", qty: 1.5, price: 43000, agent: "PESTLE", confidence: 85, correct: true },
    { id: "t3", date: new Date(now - 3 * day).toISOString(), symbol: "TSLA", action: "BUY", qty: 20, price: 210.0, agent: "Regression", confidence: 61, pnl: -225, correct: false },
    { id: "t4", date: new Date(now - 4 * day).toISOString(), symbol: "GOOG", action: "SELL", qty: 10, price: 138.5, agent: "SWOT", confidence: 77, pnl: 320, correct: true },
    { id: "t5", date: new Date(now - 5 * day).toISOString(), symbol: "NVDA", action: "BUY", qty: 15, price: 480.0, agent: "SWOT", confidence: 91, correct: true },
    { id: "t6", date: new Date(now - 6 * day).toISOString(), symbol: "MSFT", action: "BUY", qty: 30, price: 370.0, agent: "SWOT", confidence: 79, correct: true },
    { id: "t7", date: new Date(now - 8 * day).toISOString(), symbol: "ETH", action: "BUY", qty: 5, price: 2800, agent: "PESTLE", confidence: 82, correct: true },
    { id: "t8", date: new Date(now - 10 * day).toISOString(), symbol: "META", action: "SELL", qty: 20, price: 320.0, agent: "Porter", confidence: 68, pnl: -180, correct: false },
    { id: "t9", date: new Date(now - 12 * day).toISOString(), symbol: "AMZN", action: "BUY", qty: 25, price: 178.5, agent: "Porter", confidence: 75, correct: true },
    { id: "t10", date: new Date(now - 15 * day).toISOString(), symbol: "SPY", action: "BUY", qty: 10, price: 450.0, agent: "PESTLE", confidence: 70, correct: true },
  ];
}

function defaultAgents(): AgentPerf[] {
  return [
    { name: "SWOT", votes: 45, correct: 38, accuracy: 84.4, weight: 0.30, trend: "up", trustScore: 0.84 },
    { name: "PESTLE", votes: 42, correct: 35, accuracy: 83.3, weight: 0.26, trend: "flat", trustScore: 0.83 },
    { name: "Porter", votes: 38, correct: 29, accuracy: 76.3, weight: 0.22, trend: "up", trustScore: 0.76 },
    { name: "Regression", votes: 40, correct: 28, accuracy: 70.0, weight: 0.18, trend: "down", trustScore: 0.70 },
    { name: "Sentiment", votes: 30, correct: 18, accuracy: 60.0, weight: 0.10, trend: "down", trustScore: 0.60 },
    { name: "Fundamental", votes: 25, correct: 17, accuracy: 68.0, weight: 0.14, trend: "flat", trustScore: 0.68 },
  ];
}

function defaultTasks(): TaskRecord[] {
  const now = Date.now();
  const hour = 3_600_000;
  return [
    { id: "k1", name: "Morning Market Scan", status: "completed", startedAt: new Date(now - 2 * hour).toISOString(), completedAt: new Date(now - 1.5 * hour).toISOString(), duration: 1800000, phases: ["data-fetch", "agent-vote", "execution", "report"], gitCommit: "a1b2c3d" },
    { id: "k2", name: "Portfolio Rebalance", status: "completed", startedAt: new Date(now - 5 * hour).toISOString(), completedAt: new Date(now - 4.7 * hour).toISOString(), duration: 1080000, phases: ["analysis", "allocation", "trades"], gitCommit: "e4f5g6h" },
    { id: "k3", name: "Trust Score Update", status: "completed", startedAt: new Date(now - 8 * hour).toISOString(), completedAt: new Date(now - 7.9 * hour).toISOString(), duration: 360000, phases: ["score-calc", "persistence"], gitCommit: "i7j8k9l" },
    { id: "k4", name: "Risk Assessment", status: "running", startedAt: new Date(now - 0.3 * hour).toISOString(), phases: ["data-fetch", "analysis"] },
    { id: "k5", name: "Overnight Strategy", status: "failed", startedAt: new Date(now - 26 * hour).toISOString(), completedAt: new Date(now - 25.9 * hour).toISOString(), duration: 360000, phases: ["data-fetch"], gitCommit: undefined },
    { id: "k6", name: "Sector Rotation Analysis", status: "completed", startedAt: new Date(now - 30 * hour).toISOString(), completedAt: new Date(now - 29.5 * hour).toISOString(), duration: 1800000, phases: ["fetch", "vote", "execute", "report"], gitCommit: "m1n2o3p" },
  ];
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
    this.api.http.registerRoute("/portfolio/api/stats", this.handleApiStats.bind(this));

    // Dynamic routes – handled via prefix matching in the HTTP layer
    this.api.http.registerRoute("/portfolio/assets/", this.handleAssetDetail.bind(this));
    this.api.http.registerRoute("/portfolio/comparison/", this.handleComparison.bind(this));
  }

  // ── Data helpers ──────────────────────────────────────────────────────────

  private async loadStats(): Promise<PortfolioStats> {
    try {
      const raw = await this.api.files.read("portfolio-vault/stats.json");
      return JSON.parse(raw) as PortfolioStats;
    } catch {
      return defaultStats();
    }
  }

  private async loadPositions(): Promise<Position[]> {
    try {
      const raw = await this.api.files.read("portfolio-vault/positions.json");
      return JSON.parse(raw) as Position[];
    } catch {
      return defaultPositions();
    }
  }

  private async loadTrades(): Promise<Trade[]> {
    try {
      const raw = await this.api.files.read("portfolio-vault/trades.json");
      return JSON.parse(raw) as Trade[];
    } catch {
      return defaultTrades();
    }
  }

  private async loadAgents(): Promise<AgentPerf[]> {
    try {
      const raw = await this.api.files.read("portfolio-vault/trust-scores.json");
      return JSON.parse(raw) as AgentPerf[];
    } catch {
      return defaultAgents();
    }
  }

  private async loadTasks(): Promise<TaskRecord[]> {
    try {
      const raw = await this.api.files.read("portfolio-vault/tasks.json");
      return JSON.parse(raw) as TaskRecord[];
    } catch {
      return defaultTasks();
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
    return Response.json({ stats, positions, trades, agents, tasks, timestamp: new Date().toISOString() });
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  private async handleDashboard(_req: Request): Promise<Response> {
    const [stats, positions, trades] = await Promise.all([
      this.loadStats(),
      this.loadPositions(),
      this.loadTrades(),
    ]);

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
        <td>${p.confidence}%</td>
      </tr>`;
    }).join("");

    const tradeRows = trades.slice(0, 5).map(t => {
      const badgeClass = t.action === "BUY" ? "badge-buy" : "badge-sell";
      const correctIcon = t.correct === true ? "✓" : t.correct === false ? "✗" : "—";
      const correctClass = t.correct === true ? "positive" : t.correct === false ? "negative" : "";
      return `<tr>
        <td>${fmtDate(t.date)}</td>
        <td><a href="/portfolio/assets/${t.symbol}" style="color:${roninTheme.colors.link}">${t.symbol}</a></td>
        <td><span class="badge ${badgeClass}">${t.action}</span></td>
        <td>${t.qty}</td>
        <td>${fmtCurrency(t.price, 2)}</td>
        <td>${t.agent}</td>
        <td>${t.confidence}%</td>
        <td class="${correctClass}">${correctIcon}</td>
      </tr>`;
    }).join("");

    const daySign = stats.dayChange >= 0 ? "+" : "";
    const ytdSign = stats.ytdReturn >= 0 ? "+" : "";

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
      <span>Updated ${new Date().toLocaleTimeString()}</span>
    </div>
  </div>
  ${navTabs("/portfolio")}
  <div class="container">
    <div class="cards">
      <div class="stat-card">
        <div class="label">Total Value</div>
        <div class="value">${fmtCurrency(stats.totalValue)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Day Change</div>
        <div class="value ${stats.dayChange >= 0 ? "positive" : "negative"}">${daySign}${fmtCurrency(stats.dayChange)}</div>
        <div class="sub">${daySign}${stats.dayChangePct.toFixed(2)}%</div>
      </div>
      <div class="stat-card">
        <div class="label">YTD Return</div>
        <div class="value ${stats.ytdReturn >= 0 ? "positive" : "negative"}">${ytdSign}${fmtCurrency(stats.ytdReturn)}</div>
        <div class="sub">${ytdSign}${stats.ytdReturnPct.toFixed(2)}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Positions</div>
        <div class="value">${stats.positions}</div>
      </div>
      <div class="stat-card">
        <div class="label">Win Rate</div>
        <div class="value">${stats.winRate}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Sharpe Ratio</div>
        <div class="value">${stats.sharpeRatio.toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Max Drawdown</div>
        <div class="value negative">${stats.maxDrawdown.toFixed(1)}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Trades</div>
        <div class="value">${stats.totalTrades}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Current Positions</div>
      <table>
        <thead><tr>
          <th>Symbol</th><th>Qty</th><th>Entry</th><th>Current</th>
          <th>Value</th><th>Unrealized P&amp;L</th><th>Agent</th><th>Confidence</th>
        </tr></thead>
        <tbody>${posRows || '<tr><td colspan="8" class="empty-state">No positions</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Recent Trades <a href="/portfolio/trades" style="font-size:0.75rem;margin-left:1rem">View all →</a></div>
      <table>
        <thead><tr>
          <th>Date</th><th>Symbol</th><th>Action</th><th>Qty</th>
          <th>Price</th><th>Agent</th><th>Confidence</th><th>Correct</th>
        </tr></thead>
        <tbody>${tradeRows || '<tr><td colspan="8" class="empty-state">No trades</td></tr>'}</tbody>
      </table>
    </div>
  </div>
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
