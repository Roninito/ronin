---
name: alpaca
description: Trading operations with Alpaca Markets — account health, positions, and order placement. Uses the same REST endpoints as plugins/alpaca.ts.
---

# Alpaca Trading Skill

Read account/position state and place orders via the Alpaca API. Defaults to paper trading — set `ALPACA_MODE=live` explicitly to trade a live account.

## When to Use

- Check account health (buying power, equity, day P&L, margin used)
- List current open positions
- Place a market/limit/stop order

## Abilities

### get-account-health
Get account health metrics: buying power, equity, day P&L, margin used.
- Input: (none)
- Output: { success, status, currency, cash, equity, buyingPower, dayPnl, dayPnlPct, marginUsedPct, dayTradeCount, patternDayTrader }
- Run: bun run scripts/get-account-health.ts

### get-positions
Retrieve all current open positions.
- Input: (none)
- Output: { success, positions: Array<{ symbol, qty, side, avgEntryPrice, currentPrice, marketValue, unrealizedPl, unrealizedPlPct }>, count }
- Run: bun run scripts/get-positions.ts

### place-order
Place a single order. Defaults to a market, day-in-force order.
- Input: symbol (string), qty (number), side ("buy" | "sell"), type (optional: "market" | "limit" | "stop" | "stop_limit", default "market"), limitPrice (optional number, required for limit/stop_limit)
- Output: { success, orderId, symbol, qty, side, type, status, submittedAt }
- Run: bun run scripts/place-order.ts --symbol={symbol} --qty={qty} --side={side} --type={type} --limitPrice={limitPrice}

## Requirements

- `ALPACA_API_KEY` and `ALPACA_API_SECRET` environment variables
- `ALPACA_MODE` — "paper" (default) or "live"
