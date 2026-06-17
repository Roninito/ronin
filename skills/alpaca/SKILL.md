---
name: Alpaca Trading
description: Trading operations with Alpaca (positions, orders, account health, risk validation)
---

# Alpaca Trading Skill

Execute trading operations via Alpaca API including position management, order placement, portfolio synchronization, and risk validation.

## Available Operations

### generate-orders
Prepare candidate order actions from current account state and provided targets.

**Inputs:**
- `limit` (number, optional) - Number of recent orders to inspect (default: 50)
- `proposedActions` (array, optional) - Candidate actions supplied by planner/rules (default: [])

**Outputs:**
- `currentPositions` (array) - Current open positions
- `recentOrders` (array) - Recently closed orders
- `proposedActions` (array) - Candidate actions forwarded to risk review

### get-account-health
Get account health metrics including buying power, margin used, and risk status.

### get-positions
Retrieve all current open positions.

### place-order
Place a single order (market, limit, stop, etc.).

### place-orders-batch
Place multiple orders in a single batch operation.

### sync-portfolio
Synchronize local portfolio state with Alpaca's current state.

### validate-risk
Validate proposed actions against risk parameters before execution.

### write-run-report
Generate a run report summarizing trading session results.

## Requirements

- Alpaca API credentials configured in environment or Ronin config
- `ALPACA_API_KEY` and `ALPACA_API_SECRET` environment variables