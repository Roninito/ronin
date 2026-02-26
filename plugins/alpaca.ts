import type { Plugin } from "../src/plugins/base.js";
import { getConfigService } from "../src/config/ConfigService.js";

// ── Alpaca API types ─────────────────────────────────────────────────────────

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  buying_power: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
  side: "long" | "short";
  asset_class: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  limit_price?: string;
  filled_avg_price?: string;
  submitted_at: string;
  filled_at?: string;
  asset_class: string;
}

export interface AlpacaBar {
  t: string; // RFC3339 timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number;
}

export interface AlpacaConfig {
  apiKey: string;
  secretKey: string;
  mode: "live" | "paper";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const LIVE_BASE = "https://api.alpaca.markets";
const PAPER_BASE = "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function getAlpacaConfig(): AlpacaConfig {
  const cs = getConfigService();
  return {
    apiKey: (cs.get("alpaca.apiKey") as string) || "",
    secretKey: (cs.get("alpaca.secretKey") as string) || "",
    mode: (cs.get("alpaca.mode") as "live" | "paper") || "paper",
  };
}

function getCredentials(cfg: AlpacaConfig): { key: string; secret: string; base: string } {
  return {
    key: cfg.apiKey,
    secret: cfg.secretKey,
    base: cfg.mode === "live" ? LIVE_BASE : PAPER_BASE,
  };
}

async function alpacaFetch<T>(
  path: string,
  options: RequestInit = {},
  baseOverride?: string
): Promise<T> {
  const cfg = getAlpacaConfig();
  const { key, secret, base } = getCredentials(cfg);
  if (!key || !secret) {
    throw new Error(
      `Alpaca not configured for ${cfg.mode} mode. Visit /portfolio/settings to add API credentials.`
    );
  }
  const url = `${baseOverride ?? base}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const alpacaPlugin: Plugin = {
  name: "alpaca",
  description: "Alpaca Markets brokerage API — account info, positions, orders, and trade execution",
  methods: {
    /**
     * Check if Alpaca credentials are configured and return current config (secrets masked).
     */
    getConfig(): { connected: boolean; mode: "live" | "paper" } {
      const cfg = getAlpacaConfig();
      return {
        connected: !!(cfg.apiKey && cfg.secretKey),
        mode: cfg.mode,
      };
    },

    /**
     * Save Alpaca credentials and mode to config.
     */
    async setConfig(updates: Partial<AlpacaConfig>): Promise<void> {
      const cs = getConfigService();
      for (const [k, v] of Object.entries(updates)) {
        await cs.set(`alpaca.${k}`, v);
      }
    },

    /**
     * Fetch account summary (equity, cash, buying power, day P&L, etc.)
     */
    async getAccount(): Promise<AlpacaAccount> {
      return alpacaFetch<AlpacaAccount>("/v2/account");
    },

    /**
     * Fetch all open positions.
     */
    async getPositions(): Promise<AlpacaPosition[]> {
      return alpacaFetch<AlpacaPosition[]>("/v2/positions");
    },

    /**
     * Close an open position by symbol (market order at current price).
     */
    async closePosition(symbol: string): Promise<AlpacaOrder> {
      return alpacaFetch<AlpacaOrder>(`/v2/positions/${symbol}`, { method: "DELETE" });
    },

    /**
     * Fetch orders. status defaults to "open".
     */
    async getOrders(status: "open" | "closed" | "all" = "open", limit = 50): Promise<AlpacaOrder[]> {
      return alpacaFetch<AlpacaOrder[]>(`/v2/orders?status=${status}&limit=${limit}`);
    },

    /**
     * Fetch recent filled orders (order history).
     */
    async getOrderHistory(limit = 50): Promise<AlpacaOrder[]> {
      return alpacaFetch<AlpacaOrder[]>(`/v2/orders?status=closed&limit=${limit}`);
    },

    /**
     * Cancel an open order by ID.
     */
    async cancelOrder(orderId: string): Promise<void> {
      await alpacaFetch(`/v2/orders/${orderId}`, { method: "DELETE" });
    },

    /**
     * Place an order.
     * type defaults to "market". For limit orders, provide limitPrice.
     */
    async placeOrder(
      symbol: string,
      qty: number,
      side: "buy" | "sell",
      type: "market" | "limit" | "stop" | "stop_limit" = "market",
      limitPrice?: number
    ): Promise<AlpacaOrder> {
      const body: Record<string, unknown> = {
        symbol: symbol.toUpperCase(),
        qty: String(qty),
        side,
        type,
        time_in_force: type === "market" ? "day" : "gtc",
      };
      if (limitPrice !== undefined) body.limit_price = String(limitPrice);
      return alpacaFetch<AlpacaOrder>("/v2/orders", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /**
     * Get asset info (tradable, fractionable, etc.)
     */
    async getAsset(symbol: string): Promise<Record<string, unknown>> {
      return alpacaFetch<Record<string, unknown>>(`/v2/assets/${symbol.toUpperCase()}`);
    },

    /**
     * Get OHLCV bars for a symbol from the data feed.
     * timeframe: "1Min" | "5Min" | "15Min" | "1Hour" | "1Day"
     */
    async getBars(
      symbol: string,
      timeframe = "1Day",
      limit = 30
    ): Promise<AlpacaBar[]> {
      const data = await alpacaFetch<{ bars: AlpacaBar[] }>(
        `/v2/stocks/${symbol.toUpperCase()}/bars?timeframe=${timeframe}&limit=${limit}`,
        {},
        DATA_BASE
      );
      return data.bars ?? [];
    },

    /**
     * Get portfolio history (equity curve).
     * period: "1D" | "1W" | "1M" | "3M" | "6M" | "1A"
     */
    async getPortfolioHistory(period = "1M", timeframe = "1D"): Promise<{
      timestamp: number[];
      equity: number[];
      profit_loss: number[];
    }> {
      return alpacaFetch(`/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}`);
    },
  },
};

export default alpacaPlugin;
