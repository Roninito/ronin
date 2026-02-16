import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import type {
  ToolCompletedEvent,
  ToolPolicyViolationEvent,
  AgentLifecycleEvent,
  AgentTaskStartedEvent,
  AgentTaskProgressEvent,
  AgentTaskCompletedEvent,
  AgentTaskFailedEvent,
  AgentMetricEvent,
  AICompletionEvent,
  AIStreamEvent,
  AIToolCallEvent,
} from "../src/tools/types.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

/**
 * Ring buffer that keeps the last N items in memory.
 */
class RingBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    this.buffer.push(item);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}

interface AgentStatus {
  name: string;
  status: "active" | "idle" | "error";
  lastSeen: number;
  firstSeen: number;
  tasksStarted: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalDuration: number;
  durations: number[];
}

interface TaskRecord {
  agent: string;
  taskId: string;
  taskName: string;
  status: "started" | "in_progress" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  duration?: number;
  result?: string;
  error?: string;
  progress?: number;
}

interface ErrorRecord {
  agent: string;
  taskId: string;
  taskName?: string;
  error: string;
  duration: number;
  timestamp: number;
}

interface MetricRecord {
  agent: string;
  metric: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
  timestamp: number;
}

interface TimeseriesBucket {
  timestamp: number;
  started: number;
  completed: number;
  failed: number;
  events: number;
}

interface ToolRecord {
  toolName: string;
  success: boolean;
  cost?: number;
  duration: number;
  cached: boolean;
  timestamp: number;
}

interface AIUsageRecord {
  kind: "completion" | "stream" | "toolCall";
  type?: string;
  model: string;
  duration: number;
  success: boolean;
  error?: string;
  toolCount?: number;
  timestamp: number;
}

/**
 * Analytics Agent
 *
 * Collects opt-in telemetry from agents via standardized events,
 * stores metrics in-memory with ring buffers, persists daily summaries,
 * and serves an interactive dashboard at /analytics.
 */
export default class AnalyticsAgent extends BaseAgent {
  static schedule = "0 * * * *"; // Every hour

  private startTime = Date.now();

  // In-memory ring buffers
  private taskBuffer = new RingBuffer<TaskRecord>(1000);
  private errorBuffer = new RingBuffer<ErrorRecord>(500);
  private metricBuffer = new RingBuffer<MetricRecord>(1000);
  private toolBuffer = new RingBuffer<ToolRecord>(1000);
  private aiUsageBuffer = new RingBuffer<AIUsageRecord>(500);
  private timeseriesBuffer = new RingBuffer<TimeseriesBucket>(168); // 7 days of hourly buckets

  // Agent status tracking
  private agentStatuses = new Map<string, AgentStatus>();

  // Timeseries accumulation for the current hour
  private currentHourBucket: TimeseriesBucket;

  // Active tasks (taskId -> TaskRecord)
  private activeTasks = new Map<string, TaskRecord>();

  // Total event counter
  private totalEvents = 0;

  constructor(api: AgentAPI) {
    super(api);

    this.currentHourBucket = this.newHourBucket();

    this.registerEventListeners();
    this.registerRoutes();
    this.startHourlyRotation();

    console.log("[analytics] Analytics Agent initialized. Dashboard at /analytics");
  }

  // ──────────────────────────────────────────────
  // Event Listeners
  // ──────────────────────────────────────────────

  private registerEventListeners(): void {
    this.api.events.on("agent.lifecycle", (data: unknown) => {
      this.handleLifecycle(data as AgentLifecycleEvent);
    });

    this.api.events.on("agent.task.started", (data: unknown) => {
      this.handleTaskStarted(data as AgentTaskStartedEvent);
    });

    this.api.events.on("agent.task.progress", (data: unknown) => {
      this.handleTaskProgress(data as AgentTaskProgressEvent);
    });

    this.api.events.on("agent.task.completed", (data: unknown) => {
      this.handleTaskCompleted(data as AgentTaskCompletedEvent);
    });

    this.api.events.on("agent.task.failed", (data: unknown) => {
      this.handleTaskFailed(data as AgentTaskFailedEvent);
    });

    this.api.events.on("agent.metric", (data: unknown) => {
      this.handleMetric(data as AgentMetricEvent);
    });

    this.api.events.on("tool.completed", (data: unknown) => {
      this.handleToolCompleted(data as ToolCompletedEvent);
    });

    this.api.events.on("tool.policyViolation", (data: unknown) => {
      this.handlePolicyViolation(data as ToolPolicyViolationEvent);
    });

    this.api.events.on("ai.completion", (data: unknown) => {
      this.handleAiCompletion(data as AICompletionEvent);
    });

    this.api.events.on("ai.stream", (data: unknown) => {
      this.handleAiStream(data as AIStreamEvent);
    });

    this.api.events.on("ai.toolCall", (data: unknown) => {
      this.handleAiToolCall(data as AIToolCallEvent);
    });

    console.log("[analytics] Event listeners registered");
  }

  private ensureAgent(name: string): AgentStatus {
    let status = this.agentStatuses.get(name);
    if (!status) {
      status = {
        name,
        status: "idle",
        lastSeen: Date.now(),
        firstSeen: Date.now(),
        tasksStarted: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        totalDuration: 0,
        durations: [],
      };
      this.agentStatuses.set(name, status);
    }
    return status;
  }

  private handleLifecycle(event: AgentLifecycleEvent): void {
    this.totalEvents++;
    const agent = this.ensureAgent(event.agent);
    agent.lastSeen = event.timestamp;
    if (event.status === "started") agent.status = "active";
    else if (event.status === "stopped") agent.status = "idle";
    else if (event.status === "error") agent.status = "error";
    this.currentHourBucket.events++;
  }

  private handleTaskStarted(event: AgentTaskStartedEvent): void {
    this.totalEvents++;
    const agent = this.ensureAgent(event.agent);
    agent.status = "active";
    agent.lastSeen = event.timestamp;
    agent.tasksStarted++;

    const record: TaskRecord = {
      agent: event.agent,
      taskId: event.taskId,
      taskName: event.taskName,
      status: "started",
      startedAt: event.timestamp,
    };
    this.activeTasks.set(event.taskId, record);
    this.taskBuffer.push(record);
    this.currentHourBucket.started++;
    this.currentHourBucket.events++;
  }

  private handleTaskProgress(event: AgentTaskProgressEvent): void {
    this.totalEvents++;
    const agent = this.ensureAgent(event.agent);
    agent.lastSeen = event.timestamp;

    const active = this.activeTasks.get(event.taskId);
    if (active) {
      active.status = "in_progress";
      active.progress = event.progress;
    }
    this.currentHourBucket.events++;
  }

  private handleTaskCompleted(event: AgentTaskCompletedEvent): void {
    this.totalEvents++;
    const agent = this.ensureAgent(event.agent);
    agent.lastSeen = event.timestamp;
    agent.tasksCompleted++;
    agent.totalDuration += event.duration;
    agent.durations.push(event.duration);
    if (agent.durations.length > 200) agent.durations.shift();

    const active = this.activeTasks.get(event.taskId);
    if (active) {
      active.status = "completed";
      active.completedAt = event.timestamp;
      active.duration = event.duration;
      active.result = event.result;
      this.activeTasks.delete(event.taskId);
    } else {
      this.taskBuffer.push({
        agent: event.agent,
        taskId: event.taskId,
        taskName: "unknown",
        status: "completed",
        startedAt: event.timestamp - event.duration,
        completedAt: event.timestamp,
        duration: event.duration,
        result: event.result,
      });
    }

    if (agent.tasksStarted === agent.tasksCompleted + agent.tasksFailed) {
      agent.status = "idle";
    }

    this.currentHourBucket.completed++;
    this.currentHourBucket.events++;
  }

  private handleTaskFailed(event: AgentTaskFailedEvent): void {
    this.totalEvents++;
    const agent = this.ensureAgent(event.agent);
    agent.lastSeen = event.timestamp;
    agent.tasksFailed++;
    agent.totalDuration += event.duration;
    agent.status = "error";

    const active = this.activeTasks.get(event.taskId);
    const taskName = active?.taskName || "unknown";
    if (active) {
      active.status = "failed";
      active.completedAt = event.timestamp;
      active.duration = event.duration;
      active.error = event.error;
      this.activeTasks.delete(event.taskId);
    }

    this.errorBuffer.push({
      agent: event.agent,
      taskId: event.taskId,
      taskName,
      error: event.error,
      duration: event.duration,
      timestamp: event.timestamp,
    });

    this.currentHourBucket.failed++;
    this.currentHourBucket.events++;
  }

  private handleMetric(event: AgentMetricEvent): void {
    this.totalEvents++;
    this.ensureAgent(event.agent).lastSeen = event.timestamp;
    this.metricBuffer.push({
      agent: event.agent,
      metric: event.metric,
      value: event.value,
      unit: event.unit,
      tags: event.tags,
      timestamp: event.timestamp,
    });
    this.currentHourBucket.events++;
  }

  private handleToolCompleted(event: ToolCompletedEvent): void {
    this.totalEvents++;
    this.toolBuffer.push({
      toolName: event.toolName,
      success: event.success,
      cost: event.cost,
      duration: event.duration,
      cached: event.cached,
      timestamp: event.timestamp,
    });
    this.currentHourBucket.events++;
  }

  private handlePolicyViolation(_event: ToolPolicyViolationEvent): void {
    this.totalEvents++;
    this.currentHourBucket.events++;
  }

  private handleAiCompletion(event: AICompletionEvent): void {
    this.aiUsageBuffer.push({
      kind: "completion",
      type: event.type,
      model: event.model,
      duration: event.duration,
      success: event.success,
      error: event.error,
      timestamp: event.timestamp,
    });
  }

  private handleAiStream(event: AIStreamEvent): void {
    this.aiUsageBuffer.push({
      kind: "stream",
      type: event.type,
      model: event.model,
      duration: event.duration,
      success: event.success,
      error: event.error,
      timestamp: event.timestamp,
    });
  }

  private handleAiToolCall(event: AIToolCallEvent): void {
    this.aiUsageBuffer.push({
      kind: "toolCall",
      model: event.model,
      duration: event.duration,
      success: event.success,
      error: event.error,
      toolCount: event.toolCount,
      timestamp: event.timestamp,
    });
  }

  // ──────────────────────────────────────────────
  // Timeseries hourly rotation
  // ──────────────────────────────────────────────

  private newHourBucket(): TimeseriesBucket {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return {
      timestamp: now.getTime(),
      started: 0,
      completed: 0,
      failed: 0,
      events: 0,
    };
  }

  private startHourlyRotation(): void {
    setInterval(() => {
      this.rotateHourBucket();
    }, 60_000); // Check every minute
  }

  private rotateHourBucket(): void {
    const currentHourTs = new Date();
    currentHourTs.setMinutes(0, 0, 0);

    if (currentHourTs.getTime() > this.currentHourBucket.timestamp) {
      if (this.currentHourBucket.events > 0) {
        this.timeseriesBuffer.push({ ...this.currentHourBucket });
      }
      this.currentHourBucket = this.newHourBucket();
    }
  }

  // ──────────────────────────────────────────────
  // API Endpoints
  // ──────────────────────────────────────────────

  private registerRoutes(): void {
    this.api.http.registerRoute("/analytics", this.handleDashboard.bind(this));
    this.api.http.registerRoute("/analytics/api/summary", this.handleSummary.bind(this));
    this.api.http.registerRoute("/analytics/api/agents", this.handleAgents.bind(this));
    this.api.http.registerRoute("/analytics/api/tasks", this.handleTasks.bind(this));
    this.api.http.registerRoute("/analytics/api/errors", this.handleErrors.bind(this));
    this.api.http.registerRoute("/analytics/api/timeseries", this.handleTimeseries.bind(this));
    this.api.http.registerRoute("/analytics/api/metrics", this.handleMetrics.bind(this));
    this.api.http.registerRoute("/analytics/api/tools", this.handleTools.bind(this));
    this.api.http.registerRoute("/analytics/api/ai-usage", this.handleAiUsage.bind(this));
  }

  private handleSummary(_req: Request): Response {
    const agents = Array.from(this.agentStatuses.values());
    const totalTasks = agents.reduce((s, a) => s + a.tasksStarted, 0);
    const totalCompleted = agents.reduce((s, a) => s + a.tasksCompleted, 0);
    const totalFailed = agents.reduce((s, a) => s + a.tasksFailed, 0);
    const activeAgents = agents.filter(a => a.status === "active").length;

    const uptimeMs = Date.now() - this.startTime;
    const tasksPerHour = uptimeMs > 0 ? (totalTasks / (uptimeMs / 3_600_000)).toFixed(1) : "0";
    const errorRate = totalTasks > 0 ? ((totalFailed / totalTasks) * 100).toFixed(1) : "0";

    const tools = this.toolBuffer.getAll();
    const totalToolCost = tools.reduce((s, t) => s + (t.cost || 0), 0);

    return Response.json({
      totalAgents: agents.length,
      activeAgents,
      activeTasks: this.activeTasks.size,
      totalTasks,
      totalCompleted,
      totalFailed,
      tasksPerHour: parseFloat(tasksPerHour),
      errorRate: parseFloat(errorRate),
      totalEvents: this.totalEvents,
      totalToolCost,
      uptimeMs,
    });
  }

  private handleAgents(_req: Request): Response {
    const agents = Array.from(this.agentStatuses.values()).map(a => {
      const total = a.tasksCompleted + a.tasksFailed;
      const successRate = total > 0 ? ((a.tasksCompleted / total) * 100).toFixed(1) : "100";
      const avgDuration = total > 0 ? Math.round(a.totalDuration / total) : 0;

      let p50 = 0;
      let p95 = 0;
      if (a.durations.length > 0) {
        const sorted = [...a.durations].sort((x, y) => x - y);
        p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
        p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
      }

      return {
        name: a.name,
        status: a.status,
        lastSeen: a.lastSeen,
        firstSeen: a.firstSeen,
        tasksStarted: a.tasksStarted,
        tasksCompleted: a.tasksCompleted,
        tasksFailed: a.tasksFailed,
        successRate: parseFloat(successRate),
        avgDuration,
        p50,
        p95,
      };
    });

    return Response.json(agents);
  }

  private handleTasks(req: Request): Response {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const all = this.taskBuffer.getAll().reverse();
    const page = all.slice(offset, offset + limit);

    return Response.json({
      tasks: page,
      total: all.length,
      limit,
      offset,
    });
  }

  private handleErrors(_req: Request): Response {
    return Response.json(this.errorBuffer.getAll().reverse());
  }

  private handleTimeseries(_req: Request): Response {
    const buckets = [
      ...this.timeseriesBuffer.getAll(),
      { ...this.currentHourBucket },
    ];
    return Response.json(buckets);
  }

  private handleMetrics(_req: Request): Response {
    const all = this.metricBuffer.getAll();

    // Group by agent:metric for latest values and sparkline
    const grouped: Record<string, { agent: string; metric: string; unit?: string; latest: number; values: number[]; timestamps: number[] }> = {};

    for (const m of all) {
      const key = `${m.agent}:${m.metric}`;
      if (!grouped[key]) {
        grouped[key] = { agent: m.agent, metric: m.metric, unit: m.unit, latest: m.value, values: [], timestamps: [] };
      }
      grouped[key].latest = m.value;
      grouped[key].values.push(m.value);
      grouped[key].timestamps.push(m.timestamp);
    }

    return Response.json(Object.values(grouped));
  }

  private handleTools(_req: Request): Response {
    const all = this.toolBuffer.getAll();

    // Aggregate by tool name
    const byTool: Record<string, { calls: number; successes: number; totalCost: number; totalDuration: number; cached: number }> = {};
    for (const t of all) {
      if (!byTool[t.toolName]) {
        byTool[t.toolName] = { calls: 0, successes: 0, totalCost: 0, totalDuration: 0, cached: 0 };
      }
      const s = byTool[t.toolName];
      s.calls++;
      if (t.success) s.successes++;
      s.totalCost += t.cost || 0;
      s.totalDuration += t.duration;
      if (t.cached) s.cached++;
    }

    const tools = Object.entries(byTool).map(([name, s]) => ({
      name,
      calls: s.calls,
      successRate: s.calls > 0 ? parseFloat(((s.successes / s.calls) * 100).toFixed(1)) : 100,
      totalCost: parseFloat(s.totalCost.toFixed(4)),
      avgDuration: s.calls > 0 ? Math.round(s.totalDuration / s.calls) : 0,
      cacheRate: s.calls > 0 ? parseFloat(((s.cached / s.calls) * 100).toFixed(1)) : 0,
    }));

    return Response.json(tools);
  }

  private handleAiUsage(_req: Request): Response {
    const all = this.aiUsageBuffer.getAll();

    const byKind: Record<string, number> = { completion: 0, stream: 0, toolCall: 0 };
    const byModel: Record<string, { count: number; totalDuration: number }> = {};
    let totalCalls = 0;
    let errorCount = 0;
    let totalDuration = 0;

    for (const r of all) {
      totalCalls++;
      byKind[r.kind]++;
      if (!byModel[r.model]) byModel[r.model] = { count: 0, totalDuration: 0 };
      byModel[r.model].count++;
      byModel[r.model].totalDuration += r.duration;
      if (!r.success) errorCount++;
      totalDuration += r.duration;
    }

    const byModelArray = Object.entries(byModel).map(([model, s]) => ({
      model,
      count: s.count,
      avgDuration: s.count > 0 ? Math.round(s.totalDuration / s.count) : 0,
    }));

    return Response.json({
      byKind,
      byModel: byModelArray,
      recent: all.slice().reverse().slice(0, 100),
      totals: {
        totalCalls,
        errorCount,
        avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
      },
    });
  }

  // ──────────────────────────────────────────────
  // Dashboard HTML
  // ──────────────────────────────────────────────

  private handleDashboard(_req: Request): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

    body {
      min-height: 100vh;
      padding: 0;
      font-size: 0.8125rem;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.lg};
    }

    /* Overview cards */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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

    .stat-card:hover {
      border-color: ${roninTheme.colors.borderHover};
    }

    .stat-card .label {
      color: ${roninTheme.colors.textTertiary};
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: ${roninTheme.spacing.xs};
    }

    .stat-card .value {
      font-size: 1.75rem;
      font-weight: 300;
      color: ${roninTheme.colors.textPrimary};
    }

    .stat-card .sub {
      font-size: 0.6875rem;
      color: ${roninTheme.colors.textTertiary};
      margin-top: ${roninTheme.spacing.xs};
    }

    /* Sections */
    .section {
      margin-bottom: ${roninTheme.spacing.xl};
    }

    .section-title {
      font-size: 0.9375rem;
      font-weight: 300;
      margin-bottom: ${roninTheme.spacing.md};
      padding-bottom: ${roninTheme.spacing.sm};
      border-bottom: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
    }

    /* Charts grid */
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.xl};
    }

    .chart-box {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.lg};
    }

    .chart-box h3 {
      font-size: 0.8125rem;
      font-weight: 400;
      margin-bottom: ${roninTheme.spacing.md};
      color: ${roninTheme.colors.textSecondary};
    }

    .chart-box canvas {
      width: 100% !important;
      max-height: 260px;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }

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

    tr:hover td {
      background: ${roninTheme.colors.backgroundTertiary};
    }

    /* Status badges */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.6875rem;
      font-weight: 400;
    }

    .badge-active {
      background: rgba(40, 167, 69, 0.15);
      color: ${roninTheme.colors.success};
    }

    .badge-idle {
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textTertiary};
    }

    .badge-error {
      background: rgba(220, 53, 69, 0.15);
      color: ${roninTheme.colors.error};
    }

    /* Metrics panel */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: ${roninTheme.spacing.md};
    }

    .metric-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.md};
    }

    .metric-card .metric-label {
      font-size: 0.6875rem;
      color: ${roninTheme.colors.textTertiary};
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .metric-card .metric-agent {
      font-size: 0.625rem;
      color: ${roninTheme.colors.textTertiary};
    }

    .metric-card .metric-value {
      font-size: 1.375rem;
      font-weight: 300;
      margin-top: ${roninTheme.spacing.xs};
    }

    .empty-state {
      text-align: center;
      padding: ${roninTheme.spacing.xl};
      color: ${roninTheme.colors.textTertiary};
      font-size: 0.8125rem;
    }

    .error-text {
      color: ${roninTheme.colors.error};
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.75rem;
      word-break: break-all;
    }

    @media (max-width: 900px) {
      .charts-grid { grid-template-columns: 1fr; }
      .cards { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Ronin Analytics</h1>
    <div class="header-meta">
      <span id="last-updated">Loading...</span>
      <span>Auto-refresh: 30s</span>
    </div>
  </div>

  <div class="container">
    <!-- Overview Cards -->
    <div class="cards" id="cards"></div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-box">
        <h3>Task Throughput (Hourly)</h3>
        <canvas id="throughputChart"></canvas>
      </div>
      <div class="chart-box">
        <h3>Tool Usage (Top by Calls)</h3>
        <canvas id="toolChart"></canvas>
      </div>
    </div>

    <!-- Agent Status Table -->
    <div class="section">
      <div class="section-title">Agent Status</div>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Status</th>
            <th>Last Seen</th>
            <th>Tasks</th>
            <th>Completed</th>
            <th>Failed</th>
            <th>Success %</th>
            <th>Avg (ms)</th>
            <th>p50 (ms)</th>
            <th>p95 (ms)</th>
          </tr>
        </thead>
        <tbody id="agents-body"></tbody>
      </table>
      <div id="agents-empty" class="empty-state" style="display:none">No agents have reported yet. Agents opt in by emitting <code>agent.*</code> events.</div>
    </div>

    <!-- Error Log -->
    <div class="section">
      <div class="section-title">Recent Errors</div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Agent</th>
            <th>Task</th>
            <th>Duration</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody id="errors-body"></tbody>
      </table>
      <div id="errors-empty" class="empty-state" style="display:none">No errors recorded.</div>
    </div>

    <!-- Custom Metrics -->
    <div class="section">
      <div class="section-title">Custom Metrics</div>
      <div class="metrics-grid" id="metrics-grid"></div>
      <div id="metrics-empty" class="empty-state" style="display:none">No custom metrics reported yet.</div>
    </div>

    <!-- Tool Usage Table -->
    <div class="section">
      <div class="section-title">Tool Usage Summary</div>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Calls</th>
            <th>Success %</th>
            <th>Avg (ms)</th>
            <th>Cache %</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody id="tools-body"></tbody>
      </table>
      <div id="tools-empty" class="empty-state" style="display:none">No tool usage recorded yet.</div>
    </div>

    <!-- AI Usage -->
    <div class="section">
      <div class="section-title">AI Usage</div>
      <div class="cards" id="ai-usage-cards"></div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Kind</th>
            <th>Type</th>
            <th>Model</th>
            <th>Duration</th>
            <th>Success</th>
            <th>Tools</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody id="ai-usage-body"></tbody>
      </table>
      <div id="ai-usage-empty" class="empty-state" style="display:none">No AI calls recorded yet.</div>
    </div>
  </div>

  <script>
    let throughputChart = null;
    let toolChart = null;

    function relTime(ts) {
      if (!ts) return '-';
      const diff = Date.now() - ts;
      if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return Math.floor(diff / 86400000) + 'd ago';
    }

    function fmtTime(ts) {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function fmtDate(ts) {
      return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function badgeHtml(status) {
      const cls = status === 'active' ? 'badge-active' : status === 'error' ? 'badge-error' : 'badge-idle';
      return '<span class="badge ' + cls + '">' + status + '</span>';
    }

    function fmtDuration(ms) {
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
      return (ms / 60000).toFixed(1) + 'm';
    }

    function fmtUptime(ms) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      if (h > 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
      return h + 'h ' + m + 'm';
    }

    async function fetchJSON(url) {
      const res = await fetch(url);
      return res.json();
    }

    async function refresh() {
      try {
        const [summary, agents, errors, timeseries, metrics, tools, aiUsage] = await Promise.all([
          fetchJSON('/analytics/api/summary'),
          fetchJSON('/analytics/api/agents'),
          fetchJSON('/analytics/api/errors'),
          fetchJSON('/analytics/api/timeseries'),
          fetchJSON('/analytics/api/metrics'),
          fetchJSON('/analytics/api/tools'),
          fetchJSON('/analytics/api/ai-usage'),
        ]);

        renderCards(summary);
        renderAgents(agents);
        renderErrors(errors);
        renderThroughputChart(timeseries);
        renderToolChart(tools);
        renderMetrics(metrics);
        renderToolsTable(tools);
        renderAiUsage(aiUsage);

        document.getElementById('last-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
      } catch (err) {
        console.error('Refresh failed:', err);
      }
    }

    function renderCards(s) {
      document.getElementById('cards').innerHTML = [
        { label: 'Agents', value: s.totalAgents, sub: s.activeAgents + ' active' },
        { label: 'Active Tasks', value: s.activeTasks, sub: '' },
        { label: 'Total Tasks', value: s.totalTasks, sub: s.totalCompleted + ' done, ' + s.totalFailed + ' failed' },
        { label: 'Tasks / Hour', value: s.tasksPerHour, sub: '' },
        { label: 'Error Rate', value: s.errorRate + '%', sub: s.totalFailed + ' failures' },
        { label: 'Total Events', value: s.totalEvents, sub: '' },
        { label: 'Tool Cost', value: '$' + s.totalToolCost.toFixed(4), sub: '' },
        { label: 'Uptime', value: fmtUptime(s.uptimeMs), sub: '' },
      ].map(c => '<div class="stat-card"><div class="label">' + c.label + '</div><div class="value">' + c.value + '</div>' + (c.sub ? '<div class="sub">' + c.sub + '</div>' : '') + '</div>').join('');
    }

    function renderAgents(agents) {
      const body = document.getElementById('agents-body');
      const empty = document.getElementById('agents-empty');
      if (agents.length === 0) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      body.innerHTML = agents.map(a => '<tr>' +
        '<td><strong>' + a.name + '</strong></td>' +
        '<td>' + badgeHtml(a.status) + '</td>' +
        '<td>' + relTime(a.lastSeen) + '</td>' +
        '<td>' + a.tasksStarted + '</td>' +
        '<td>' + a.tasksCompleted + '</td>' +
        '<td>' + a.tasksFailed + '</td>' +
        '<td>' + a.successRate + '%</td>' +
        '<td>' + fmtDuration(a.avgDuration) + '</td>' +
        '<td>' + fmtDuration(a.p50) + '</td>' +
        '<td>' + fmtDuration(a.p95) + '</td>' +
        '</tr>').join('');
    }

    function renderErrors(errors) {
      const body = document.getElementById('errors-body');
      const empty = document.getElementById('errors-empty');
      if (errors.length === 0) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      body.innerHTML = errors.slice(0, 50).map(e => '<tr>' +
        '<td>' + fmtDate(e.timestamp) + '</td>' +
        '<td>' + e.agent + '</td>' +
        '<td>' + (e.taskName || e.taskId.substring(0, 12)) + '</td>' +
        '<td>' + fmtDuration(e.duration) + '</td>' +
        '<td class="error-text">' + (e.error || '').substring(0, 200) + '</td>' +
        '</tr>').join('');
    }

    function renderThroughputChart(buckets) {
      const canvas = document.getElementById('throughputChart');
      const labels = buckets.map(b => fmtTime(b.timestamp));
      const started = buckets.map(b => b.started);
      const completed = buckets.map(b => b.completed);
      const failed = buckets.map(b => b.failed);

      const data = {
        labels,
        datasets: [
          { label: 'Started', data: started, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(255,255,255,0.05)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: 'Completed', data: completed, borderColor: '#28a745', backgroundColor: 'rgba(40,167,69,0.1)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: 'Failed', data: failed, borderColor: '#dc3545', backgroundColor: 'rgba(220,53,69,0.1)', fill: true, tension: 0.3, pointRadius: 2 },
        ],
      };

      const opts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { beginAtZero: true, ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        },
      };

      if (throughputChart) { throughputChart.data = data; throughputChart.update(); }
      else { throughputChart = new Chart(canvas, { type: 'line', data, options: opts }); }
    }

    function renderToolChart(tools) {
      const canvas = document.getElementById('toolChart');
      const sorted = [...tools].sort((a, b) => b.calls - a.calls).slice(0, 10);
      const labels = sorted.map(t => t.name);
      const calls = sorted.map(t => t.calls);

      const data = {
        labels,
        datasets: [{
          label: 'Calls',
          data: calls,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderColor: 'rgba(255,255,255,0.3)',
          borderWidth: 1,
          borderRadius: 3,
        }],
      };

      const opts = {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }, grid: { display: false } },
        },
      };

      if (toolChart) { toolChart.data = data; toolChart.update(); }
      else { toolChart = new Chart(canvas, { type: 'bar', data, options: opts }); }
    }

    function renderMetrics(metrics) {
      const grid = document.getElementById('metrics-grid');
      const empty = document.getElementById('metrics-empty');
      if (metrics.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      grid.innerHTML = metrics.map(m =>
        '<div class="metric-card">' +
          '<div class="metric-label">' + m.metric + (m.unit ? ' (' + m.unit + ')' : '') + '</div>' +
          '<div class="metric-agent">' + m.agent + '</div>' +
          '<div class="metric-value">' + m.latest + '</div>' +
        '</div>'
      ).join('');
    }

    function renderToolsTable(tools) {
      const body = document.getElementById('tools-body');
      const empty = document.getElementById('tools-empty');
      if (tools.length === 0) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      const sorted = [...tools].sort((a, b) => b.calls - a.calls);
      body.innerHTML = sorted.map(t => '<tr>' +
        '<td><strong>' + t.name + '</strong></td>' +
        '<td>' + t.calls + '</td>' +
        '<td>' + t.successRate + '%</td>' +
        '<td>' + fmtDuration(t.avgDuration) + '</td>' +
        '<td>' + t.cacheRate + '%</td>' +
        '<td>$' + t.totalCost.toFixed(4) + '</td>' +
        '</tr>').join('');
    }

    function renderAiUsage(aiUsage) {
      const cards = document.getElementById('ai-usage-cards');
      const body = document.getElementById('ai-usage-body');
      const empty = document.getElementById('ai-usage-empty');
      const t = aiUsage.totals || {};
      const byKind = aiUsage.byKind || {};
      const recent = aiUsage.recent || [];

      cards.innerHTML = [
        { label: 'Total AI Calls', value: t.totalCalls || 0, sub: '' },
        { label: 'Errors', value: t.errorCount || 0, sub: '' },
        { label: 'Avg Duration', value: (t.avgDuration != null ? fmtDuration(t.avgDuration) : '0ms'), sub: '' },
        { label: 'Completion', value: byKind.completion || 0, sub: '' },
        { label: 'Stream', value: byKind.stream || 0, sub: '' },
        { label: 'Tool Call', value: byKind.toolCall || 0, sub: '' },
      ].map(c => '<div class="stat-card"><div class="label">' + c.label + '</div><div class="value">' + c.value + '</div>' + (c.sub ? '<div class="sub">' + c.sub + '</div>' : '') + '</div>').join('');

      if (recent.length === 0) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      body.innerHTML = recent.slice(0, 50).map(r =>
        '<tr>' +
        '<td>' + fmtDate(r.timestamp) + '</td>' +
        '<td>' + r.kind + '</td>' +
        '<td>' + (r.type || '-') + '</td>' +
        '<td>' + r.model + '</td>' +
        '<td>' + fmtDuration(r.duration) + '</td>' +
        '<td>' + (r.success ? 'Yes' : 'No') + '</td>' +
        '<td>' + (r.toolCount != null ? r.toolCount : '-') + '</td>' +
        '<td class="error-text">' + (r.error ? r.error.substring(0, 100) : '') + '</td>' +
        '</tr>'
      ).join('');
    }

    // Initial load and auto-refresh
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  // ──────────────────────────────────────────────
  // Scheduled Execution — persist daily summaries
  // ──────────────────────────────────────────────

  async execute(): Promise<void> {
    console.log("[analytics] Persisting hourly summary...");

    this.rotateHourBucket();

    const dayKey = new Date().toISOString().split("T")[0];
    const summaryKey = `analytics.summary.${dayKey}`;

    const agents = Array.from(this.agentStatuses.values());
    const summary = {
      timestamp: Date.now(),
      totalAgents: agents.length,
      totalTasks: agents.reduce((s, a) => s + a.tasksStarted, 0),
      totalCompleted: agents.reduce((s, a) => s + a.tasksCompleted, 0),
      totalFailed: agents.reduce((s, a) => s + a.tasksFailed, 0),
      totalEvents: this.totalEvents,
      agents: agents.map(a => ({
        name: a.name,
        status: a.status,
        tasksStarted: a.tasksStarted,
        tasksCompleted: a.tasksCompleted,
        tasksFailed: a.tasksFailed,
      })),
    };

    await this.api.memory.store(summaryKey, JSON.stringify(summary));
    console.log("[analytics] Summary persisted for", dayKey);
  }
}
