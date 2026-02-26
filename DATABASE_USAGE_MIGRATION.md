# Database Usage Tracking - Phase 3

## Overview

Phase 3 implements SQLite-based usage tracking for the Model Selection System, moving from JSON-based tracking to a robust database backend. This enables efficient querying, analytics, and historical reporting of model usage and costs.

## Architecture

### Database Schema

Three main tables track usage statistics:

#### `model_usage_daily`
Daily aggregation of usage statistics per model.

```sql
CREATE TABLE model_usage_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_nametag TEXT NOT NULL,
  date TEXT NOT NULL,  -- YYYY-MM-DD format
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0.0,
  requests INTEGER DEFAULT 0,
  avg_latency_ms REAL DEFAULT 0.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_nametag, date)
);
```

**Queries**:
- Get today's usage: `getDailyUsage(api, "claude-haiku")`
- Get stats for specific date: `getDailyUsage(api, "claude-haiku", "2026-02-26")`
- Get all models on a date: `getDailyStats(api, "2026-02-26")`
- Get usage range: `getDailyUsageRange(api, "claude-haiku", "2026-02-20", "2026-02-26")`

#### `model_usage_monthly`
Monthly aggregated stats for trend analysis and billing.

```sql
CREATE TABLE model_usage_monthly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_nametag TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,  -- 1-12
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0.0,
  requests INTEGER DEFAULT 0,
  avg_latency_ms REAL DEFAULT 0.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_nametag, year, month)
);
```

**Queries**:
- Get current month: `getMonthlyUsage(api, "claude-haiku")`
- Get specific month: `getMonthlyUsage(api, "claude-haiku", 2026, 2)`
- Get all models this month: `getMonthlyStats(api, 2026, 2)`

#### `model_usage_log`
Detailed log of every usage event (optional, for analytics and audit trails).

```sql
CREATE TABLE model_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_nametag TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Queries**:
- Get recent events: `getUsageLog(api, "claude-haiku", 100)`
- Get all events: `getUsageLog(api)`

### Plugin API

#### model-selector-db Plugin

New plugin with database-backed methods:

```typescript
// Initialize database tables
await api.plugins.call("model-selector-db", "initializeDb", api);

// Record usage event
await api.plugins.call("model-selector-db", "recordUsageDb", 
  api, "claude-haiku", 1000, 500, 1200, 0.80, 2.40);

// Query daily usage
const usage = await api.plugins.call("model-selector-db", "getDailyUsage",
  api, "claude-haiku");

// Query monthly usage
const monthly = await api.plugins.call("model-selector-db", "getMonthlyUsage",
  api, "claude-haiku", 2026, 2);

// Get cost for period
const cost = await api.plugins.call("model-selector-db", "getTotalCost",
  api, "2026-02-01", "2026-02-28", "claude-haiku");

// Get usage log
const log = await api.plugins.call("model-selector-db", "getUsageLog",
  api, "claude-haiku", 50);
```

## Migration from JSON to Database

### Automated Migration

```typescript
import { migrateUsageData, isUsageDataMigrated } from "@ronin/database/migration.js";

// Check migration status
const isMigrated = await isUsageDataMigrated(api);

// Perform migration
const recordsMigrated = await migrateUsageData(api);
console.log(`Migrated ${recordsMigrated} records to database`);
```

### Manual Migration Steps

1. **Initialize database** (creates tables and indices):
   ```bash
   ronin db init-usage-tracking
   ```

2. **Migrate data** (moves JSON stats to DB):
   ```bash
   ronin db migrate-usage-data
   ```

3. **Verify migration**:
   ```bash
   ronin db usage-migration-status
   ```

## Usage Examples

### Recording Usage

When an AI model is called, record the usage:

```typescript
// From middleware or AI integration
const inputTokens = 1000;
const outputTokens = 500;
const latencyMs = 1200;
const model = modelConfig; // from registry

const cost = 
  (inputTokens / 1000000) * model.limits.costPerMTok +
  (outputTokens / 1000000) * model.limits.costPerOTok;

await api.plugins.call("model-selector-db", "recordUsageDb",
  api, model.nametag, inputTokens, outputTokens, latencyMs,
  model.limits.costPerMTok, model.limits.costPerOTok);
```

### Querying Usage Statistics

#### Daily Stats
```typescript
// Today's usage for a model
const today = await api.plugins.call("model-selector-db", "getDailyUsage",
  api, "claude-haiku");

console.log(`Today: ${today.requests} requests, ${today.cost} cost`);

// Specific date
const date = "2026-02-20";
const usage = await api.plugins.call("model-selector-db", "getDailyUsage",
  api, "claude-haiku", date);

// All models on a date
const allModels = await api.plugins.call("model-selector-db", "getDailyStats",
  api, "2026-02-26");
```

#### Weekly/Range Queries
```typescript
const startDate = "2026-02-20";
const endDate = "2026-02-26";

const weeklyData = await api.plugins.call("model-selector-db", 
  "getDailyUsageRange", api, "claude-haiku", startDate, endDate);

let totalCost = 0;
for (const day of weeklyData) {
  totalCost += day.cost;
  console.log(`${day.date}: $${day.cost} (${day.requests} requests)`);
}
console.log(`Week total: $${totalCost}`);
```

#### Monthly Stats
```typescript
// Current month
const thisMonth = await api.plugins.call("model-selector-db", 
  "getMonthlyUsage", api, "claude-haiku");

console.log(`This month: ${thisMonth.cost} cost`);

// Specific month
const feb2026 = await api.plugins.call("model-selector-db",
  "getMonthlyUsage", api, "claude-haiku", 2026, 2);

// All models this month
const allModels = await api.plugins.call("model-selector-db",
  "getMonthlyStats", api, 2026, 2);
```

#### Cost Calculations
```typescript
// Total cost for period
const cost = await api.plugins.call("model-selector-db", "getTotalCost",
  api, "2026-02-01", "2026-02-28");
console.log(`February cost: $${cost}`);

// Cost by model
const haikuCost = await api.plugins.call("model-selector-db", "getTotalCost",
  api, "2026-02-01", "2026-02-28", "claude-haiku");
const gptCost = await api.plugins.call("model-selector-db", "getTotalCost",
  api, "2026-02-01", "2026-02-28", "gpt-4o");

console.log(`Claude Haiku: $${haikuCost}`);
console.log(`GPT-4 Omni: $${gptCost}`);
```

#### Detailed Usage Log
```typescript
// Get recent events for a model
const recent = await api.plugins.call("model-selector-db", "getUsageLog",
  api, "claude-haiku", 10);

for (const event of recent) {
  console.log(
    `${event.createdAt}: ${event.inputTokens} in, ` +
    `${event.outputTokens} out, ${event.latencyMs}ms, $${event.cost}`
  );
}

// Get all events (for analytics)
const all = await api.plugins.call("model-selector-db", "getUsageLog", api);
```

## CLI Commands (Phase 4)

```bash
# Initialize usage tracking database
ronin db init-usage-tracking

# Migrate existing data
ronin db migrate-usage-data

# Check migration status
ronin db usage-migration-status

# View daily stats
ronin model usage --daily
ronin model usage --date 2026-02-26

# View monthly stats
ronin model usage --monthly
ronin model usage --month 2 --year 2026

# View cost reports
ronin model cost --today
ronin model cost --this-month
ronin model cost --from 2026-02-01 --to 2026-02-28
ronin model cost --model claude-haiku

# Export data
ronin model export --format csv --output usage.csv
ronin model export --format json --model gpt-4o
```

## Performance Characteristics

### Indices
- `model_usage_daily`: Indexed by (model_nametag, date) for fast lookups
- `model_usage_monthly`: Indexed by (model_nametag, year, month)
- `model_usage_log`: Indexed by (model_nametag, created_at) for audit trails

### Query Performance
- Daily usage lookup: O(1) via unique constraint
- Monthly lookup: O(1) via unique constraint
- Range queries: O(n) where n is days in range (typically <30)
- Cost aggregation: O(n) with index scan
- Daily/monthly stats: O(m) where m is models per period (typically <20)

### Storage
- Daily records: ~500 bytes per record (one per model per day)
- Monthly records: ~500 bytes per record (one per model per month)
- Usage log: ~100 bytes per event
- With 20 models: ~600KB/month (daily+monthly) + variable (log)

## Integration Points

### Model-Selector Plugin
Update the existing plugin to optionally use database:

```typescript
// Option 1: Use JSON (current)
await api.plugins.call("model-selector", "recordUsage", 
  nametag, inputTokens, outputTokens, latency);

// Option 2: Use database (Phase 3)
await api.plugins.call("model-selector-db", "recordUsageDb",
  api, nametag, inputTokens, outputTokens, latency,
  model.limits.costPerMTok, model.limits.costPerOTok);
```

### AI Middleware
Hook database recording into ai-tool middleware:

```typescript
// After AI completion
const tokens = response.usage;
const latency = Date.now() - startTime;

await api.plugins.call("model-selector-db", "recordUsageDb",
  api, model.nametag, tokens.input, tokens.output, latency,
  model.limits.costPerMTok, model.limits.costPerOTok);
```

## Testing

Comprehensive test suite in `tests/database-usage.test.ts`:

```bash
bun test tests/database-usage.test.ts
```

Tests cover:
- Table initialization
- Recording single/multiple events
- Daily/monthly aggregation
- Cost calculations
- Range queries
- Data integrity
- Migration utilities

All 14 tests pass ✅

## Files Created

1. **src/database/usage.ts** (11.4K)
   - Core usage tracking functions
   - Table initialization
   - Query and aggregation methods
   - Type definitions

2. **src/database/migration.ts** (5.2K)
   - JSON to database migration
   - Migration status checking
   - Data import logic

3. **src/database/index.ts**
   - Module exports

4. **plugins/model-selector-db.ts** (3.4K)
   - New plugin for database-backed operations
   - 11 methods for querying and recording

5. **tests/database-usage.test.ts** (9.5K)
   - Comprehensive test suite
   - 14 passing tests
   - Coverage for all features

## Next Steps (Phase 4)

1. **CLI Commands**: Add `ronin db` and `ronin model` commands for usage/cost queries
2. **UI Dashboard**: Create web interface for viewing statistics and trends
3. **Alerts & Notifications**: Cost threshold warnings, usage reports
4. **Analytics**: Trend analysis, cost predictions, optimization recommendations
5. **Export**: CSV/JSON export for reporting and external analysis

## Migration Path

**From Phase 1/2 (JSON) to Phase 3 (Database)**:

1. Both systems can coexist initially
2. New installations use database-only
3. Existing installations run migration once
4. JSON registry remains for model definitions
5. JSON usage data can be archived after migration

**Backward Compatibility**:
- Existing `model-selector` plugin continues to work
- New `model-selector-db` plugin available alongside
- Eventually merge into unified plugin in Phase 4

## Summary

Phase 3 delivers a production-ready database backend for usage tracking:
- ✅ Three-table schema for daily/monthly/detailed tracking
- ✅ Efficient indexing for fast queries
- ✅ Automated migration from JSON
- ✅ 11 plugin methods for all common queries
- ✅ Comprehensive test coverage
- ✅ Ready for Phase 4 CLI and UI integration
