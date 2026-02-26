import type { AgentAPI } from "@ronin/types/index.js";

/**
 * Usage tracking database module
 * Manages model usage statistics in SQLite
 */

export interface DailyUsageStats {
  modelNametag: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requests: number;
  avgLatencyMs: number;
}

export interface MonthlyUsageStats {
  modelNametag: string;
  year: number;
  month: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requests: number;
  avgLatencyMs: number;
}

export interface UsageLogEntry {
  modelNametag: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  latencyMs: number;
  createdAt: string;
}

/**
 * Initialize usage tracking tables in database
 */
export async function initializeUsageTables(api: AgentAPI): Promise<void> {
  const db = api.db;

  // Create tables if not exist
  await db.execute(`
    CREATE TABLE IF NOT EXISTS model_usage_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_nametag TEXT NOT NULL,
      date TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0.0,
      requests INTEGER DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(model_nametag, date)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS model_usage_monthly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_nametag TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0.0,
      requests INTEGER DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(model_nametag, year, month)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS model_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_nametag TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost REAL NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indices if not exist
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_model_usage_daily_model
    ON model_usage_daily(model_nametag)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_model_usage_daily_date
    ON model_usage_daily(date)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_model_usage_monthly_model
    ON model_usage_monthly(model_nametag)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_model_usage_monthly_period
    ON model_usage_monthly(year, month)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_model_usage_log_model
    ON model_usage_log(model_nametag)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_model_usage_log_created
    ON model_usage_log(created_at)
  `);
}

/**
 * Record a single usage event
 */
export async function recordUsageEvent(
  api: AgentAPI,
  modelNametag: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  cost: number
): Promise<void> {
  const db = api.db;
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  // Insert into detailed log
  await db.execute(
    `INSERT INTO model_usage_log (model_nametag, input_tokens, output_tokens, cost, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [modelNametag, inputTokens, outputTokens, cost, latencyMs, now]
  );

  // Update daily stats
  const dailyResult = await db.query<{ requests: number; avgLatencyMs: number }>(
    `SELECT requests, avg_latency_ms FROM model_usage_daily
     WHERE model_nametag = ? AND date = ?`,
    [modelNametag, today]
  );

  const dailyRow = dailyResult?.[0];
  if (dailyRow) {
    // Update existing daily record
    const newRequests = dailyRow.requests + 1;
    const newAvgLatency =
      (dailyRow.avgLatencyMs * dailyRow.requests + latencyMs) / newRequests;

    await db.execute(
      `UPDATE model_usage_daily
       SET input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           cost = cost + ?,
           requests = ?,
           avg_latency_ms = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE model_nametag = ? AND date = ?`,
      [
        inputTokens,
        outputTokens,
        cost,
        newRequests,
        newAvgLatency,
        modelNametag,
        today,
      ]
    );
  } else {
    // Insert new daily record
    await db.execute(
      `INSERT INTO model_usage_daily
       (model_nametag, date, input_tokens, output_tokens, cost, requests, avg_latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [modelNametag, today, inputTokens, outputTokens, cost, 1, latencyMs]
    );
  }

  // Update monthly stats
  const monthlyResult = await db.query<{ requests: number; avgLatencyMs: number }>(
    `SELECT requests, avg_latency_ms FROM model_usage_monthly
     WHERE model_nametag = ? AND year = ? AND month = ?`,
    [modelNametag, year, month]
  );

  const monthlyRow = monthlyResult?.[0];
  if (monthlyRow) {
    // Update existing monthly record
    const newRequests = monthlyRow.requests + 1;
    const newAvgLatency =
      (monthlyRow.avgLatencyMs * monthlyRow.requests + latencyMs) / newRequests;

    await db.execute(
      `UPDATE model_usage_monthly
       SET input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           cost = cost + ?,
           requests = ?,
           avg_latency_ms = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE model_nametag = ? AND year = ? AND month = ?`,
      [
        inputTokens,
        outputTokens,
        cost,
        newRequests,
        newAvgLatency,
        modelNametag,
        year,
        month,
      ]
    );
  } else {
    // Insert new monthly record
    await db.execute(
      `INSERT INTO model_usage_monthly
       (model_nametag, year, month, input_tokens, output_tokens, cost, requests, avg_latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [modelNametag, year, month, inputTokens, outputTokens, cost, 1, latencyMs]
    );
  }
}

/**
 * Get usage stats for a specific model on a specific date
 */
export async function getDailyUsage(
  api: AgentAPI,
  modelNametag: string,
  date?: string
): Promise<DailyUsageStats | null> {
  const db = api.db;
  const queryDate = date || new Date().toISOString().split("T")[0];

  const result = await db.query<DailyUsageStats>(
    `SELECT model_nametag as modelNametag, date, input_tokens as inputTokens,
            output_tokens as outputTokens, cost, requests, avg_latency_ms as avgLatencyMs
     FROM model_usage_daily
     WHERE model_nametag = ? AND date = ?`,
    [modelNametag, queryDate]
  );

  return result?.[0] || null;
}

/**
 * Get usage stats for a specific model in a specific month
 */
export async function getMonthlyUsage(
  api: AgentAPI,
  modelNametag: string,
  year?: number,
  month?: number
): Promise<MonthlyUsageStats | null> {
  const db = api.db;
  const now = new Date();
  const queryYear = year || now.getFullYear();
  const queryMonth = month || now.getMonth() + 1;

  const result = await db.query<MonthlyUsageStats>(
    `SELECT model_nametag as modelNametag, year, month,
            input_tokens as inputTokens, output_tokens as outputTokens,
            cost, requests, avg_latency_ms as avgLatencyMs
     FROM model_usage_monthly
     WHERE model_nametag = ? AND year = ? AND month = ?`,
    [modelNametag, queryYear, queryMonth]
  );

  return result?.[0] || null;
}

/**
 * Get all daily usage stats for a model over a date range
 */
export async function getDailyUsageRange(
  api: AgentAPI,
  modelNametag: string,
  startDate: string,
  endDate: string
): Promise<DailyUsageStats[]> {
  const db = api.db;
  const result = await db.query<DailyUsageStats>(
    `SELECT model_nametag as modelNametag, date, input_tokens as inputTokens,
            output_tokens as outputTokens, cost, requests, avg_latency_ms as avgLatencyMs
     FROM model_usage_daily
     WHERE model_nametag = ? AND date BETWEEN ? AND ?
     ORDER BY date ASC`,
    [modelNametag, startDate, endDate]
  );

  return result || [];
}

/**
 * Get aggregated stats for all models on a specific date
 */
export async function getDailyStats(
  api: AgentAPI,
  date?: string
): Promise<DailyUsageStats[]> {
  const db = api.db;
  const queryDate = date || new Date().toISOString().split("T")[0];

  const result = await db.query<DailyUsageStats>(
    `SELECT model_nametag as modelNametag, date, input_tokens as inputTokens,
            output_tokens as outputTokens, cost, requests, avg_latency_ms as avgLatencyMs
     FROM model_usage_daily
     WHERE date = ?
     ORDER BY cost DESC`,
    [queryDate]
  );

  return result || [];
}

/**
 * Get aggregated stats for all models in a specific month
 */
export async function getMonthlyStats(
  api: AgentAPI,
  year?: number,
  month?: number
): Promise<MonthlyUsageStats[]> {
  const db = api.db;
  const now = new Date();
  const queryYear = year || now.getFullYear();
  const queryMonth = month || now.getMonth() + 1;

  const result = await db.query<MonthlyUsageStats>(
    `SELECT model_nametag as modelNametag, year, month,
            input_tokens as inputTokens, output_tokens as outputTokens,
            cost, requests, avg_latency_ms as avgLatencyMs
     FROM model_usage_monthly
     WHERE year = ? AND month = ?
     ORDER BY cost DESC`,
    [queryYear, queryMonth]
  );

  return result || [];
}

/**
 * Get usage log for analytics
 */
export async function getUsageLog(
  api: AgentAPI,
  modelNametag?: string,
  limit = 100
): Promise<UsageLogEntry[]> {
  const db = api.db;

  let query = `SELECT model_nametag as modelNametag, input_tokens as inputTokens,
                      output_tokens as outputTokens, cost, latency_ms as latencyMs,
                      created_at as createdAt
               FROM model_usage_log`;
  const params: (string | number)[] = [];

  if (modelNametag) {
    query += ` WHERE model_nametag = ?`;
    params.push(modelNametag);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const result = await db.query<UsageLogEntry>(query, params);
  return result || [];
}

/**
 * Get total cost for a period
 */
export async function getTotalCost(
  api: AgentAPI,
  startDate: string,
  endDate: string,
  modelNametag?: string
): Promise<number> {
  const db = api.db;

  let query = `SELECT SUM(cost) as totalCost FROM model_usage_daily WHERE date BETWEEN ? AND ?`;
  const params: (string | number)[] = [startDate, endDate];

  if (modelNametag) {
    query += ` AND model_nametag = ?`;
    params.push(modelNametag);
  }

  const result = await db.query<{ totalCost: number }>(query, params);
  return result?.[0]?.totalCost || 0;
}

/**
 * Clear usage data (for testing)
 */
export async function clearUsageData(api: AgentAPI): Promise<void> {
  const db = api.db;
  await db.execute(`DELETE FROM model_usage_daily`);
  await db.execute(`DELETE FROM model_usage_monthly`);
  await db.execute(`DELETE FROM model_usage_log`);
}
