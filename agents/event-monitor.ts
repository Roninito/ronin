import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { join } from "path";
import { homedir } from "os";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS } from "../src/utils/theme.js";

interface EventRecord {
  id: string;
  timestamp: number;
  type: string;
  source: string;
  payload: string;
  isSampled: boolean;
  sampleRate?: number;
}

interface EventMonitorConfig {
  enabled: boolean;
  retentionHours: number;
  maxPayloadSize: number;
  autoRefreshSeconds: number;
  pageSize: number;
  sampling: {
    enabled: boolean;
    thresholdPerHour: number;
    rate: number;
  };
}

/**
 * Event Monitor Agent
 * 
 * Monitors all events emitted by agents, stores them in memory with:
 * - 24h retention with hourly cleanup
 * - Sampling for high-volume events
 * - Timeline UI at /timeline
 * - Multi-select filters and pagination
 * - Real-time updates with highlight animation
 * - Visual indicators for sampled events
 */
export default class EventMonitorAgent extends BaseAgent {
  // Default configuration
  private config: EventMonitorConfig = {
    enabled: true,
    retentionHours: 24,
    maxPayloadSize: 500,
    autoRefreshSeconds: 30,
    pageSize: 50,
    sampling: {
      enabled: true,
      thresholdPerHour: 100,
      rate: 10,
    },
  };

  // Sampling counters per event type
  private eventCounters: Map<string, { count: number; lastReset: number }> = new Map();

  // Schedule: Run cleanup every hour
  static schedule = "0 * * * *";

  constructor(api: AgentAPI) {
    super(api);
    this.loadConfig();
    this.registerEventHandlers();
    this.registerRoutes();
    console.log("📊 Event Monitor ready. Timeline available at /timeline");
  }

  /**
   * Load configuration from ~/.ronin/config.json
   */
  private async loadConfig(): Promise<void> {
    const configPath = join(homedir(), ".ronin", "config.json");
    if (!existsSync(configPath)) return;

    try {
      const content = await readFile(configPath, "utf-8");
      const userConfig = JSON.parse(content);
      if (userConfig.eventMonitor) {
        this.config = { ...this.config, ...userConfig.eventMonitor };
      }
    } catch (error) {
      console.error("[event-monitor] Failed to load config:", error);
    }
  }

  /**
   * Register event handlers
   */
  private registerEventHandlers(): void {
    // Listen for captured events from EventsAPI
    this.api.events.on("target:event-monitor:capture", (data: unknown) => {
      const eventData = data as {
        timestamp: number;
        type: string;
        source: string;
        payload: unknown;
      };
      this.handleCapture(eventData);
    });
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/timeline", this.handleTimelineUI.bind(this));
    this.api.http.registerRoute("/timeline/api/events", this.handleEventsAPI.bind(this));
  }

  /**
   * Handle captured event
   */
  private async handleCapture(data: {
    timestamp: number;
    type: string;
    source: string;
    payload: unknown;
  }): Promise<void> {
    if (!this.config.enabled) return;

    // Apply sampling
    const samplingResult = this.applySampling(data.type);
    if (!samplingResult.shouldStore) return;

    // Create event record
    const event: EventRecord = {
      id: `evt-${data.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: data.timestamp,
      type: data.type,
      source: data.source,
      payload: this.truncatePayload(data.payload),
      isSampled: samplingResult.isSampled,
      sampleRate: samplingResult.rate,
    };

    // Store event
    await this.storeEvent(event);
  }

  /**
   * Apply sampling rules
   */
  private applySampling(eventType: string): {
    shouldStore: boolean;
    isSampled: boolean;
    rate?: number;
  } {
    if (!this.config.sampling.enabled) {
      return { shouldStore: true, isSampled: false };
    }

    const now = Date.now();
    const counter = this.eventCounters.get(eventType) || { count: 0, lastReset: now };

    // Reset counter every hour
    if (now - counter.lastReset > 3600000) {
      counter.count = 0;
      counter.lastReset = now;
    }

    counter.count++;
    this.eventCounters.set(eventType, counter);

    // Under threshold: store all
    if (counter.count <= this.config.sampling.thresholdPerHour) {
      return { shouldStore: true, isSampled: false };
    }

    // Over threshold: sample every Nth
    const isNth = counter.count % this.config.sampling.rate === 0;
    return {
      shouldStore: isNth,
      isSampled: true,
      rate: this.config.sampling.rate,
    };
  }

  /**
   * Truncate payload to max size
   */
  private truncatePayload(payload: unknown): string {
    const str = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (str.length <= this.config.maxPayloadSize) return str;
    return str.substring(0, this.config.maxPayloadSize) + "... [truncated]";
  }

  /**
   * Store event in memory
   */
  private async storeEvent(event: EventRecord): Promise<void> {
    // Get existing events
    const events = (await this.api.memory.retrieve("event_monitor_events")) as Record<
      string,
      EventRecord
    > || {};

    // Get index
    const index = (await this.api.memory.retrieve("event_monitor_index")) as Record<
      string,
      string[]
    > || {};

    // Add event
    events[event.id] = event;

    // Add to index
    if (!index[event.type]) index[event.type] = [];
    index[event.type].push(event.id);

    // Update metadata
    const meta = (await this.api.memory.retrieve("event_monitor_meta")) as {
      totalCount: number;
      samplingActive: string[];
    } || { totalCount: 0, samplingActive: [] };
    meta.totalCount++;

    // Track which types are being sampled
    if (event.isSampled && !meta.samplingActive.includes(event.type)) {
      meta.samplingActive.push(event.type);
    }

    // Store everything
    await Promise.all([
      this.api.memory.store("event_monitor_events", events),
      this.api.memory.store("event_monitor_index", index),
      this.api.memory.store("event_monitor_meta", meta),
    ]);
  }

  /**
   * Cleanup old events (runs every hour via schedule)
   */
  async execute(): Promise<void> {
    await this.cleanupOldEvents();
  }

  /**
   * Remove events older than retention period
   */
  private async cleanupOldEvents(): Promise<void> {
    const cutoff = Date.now() - this.config.retentionHours * 60 * 60 * 1000;

    const events = (await this.api.memory.retrieve("event_monitor_events")) as Record<
      string,
      EventRecord
    > || {};
    const index = (await this.api.memory.retrieve("event_monitor_index")) as Record<
      string,
      string[]
    > || {};

    let cleaned = 0;
    const samplingActive: string[] = [];

    for (const [id, event] of Object.entries(events)) {
      if (event.timestamp < cutoff) {
        delete events[id];

        // Remove from index
        const typeList = index[event.type];
        if (typeList) {
          const idx = typeList.indexOf(id);
          if (idx > -1) typeList.splice(idx, 1);
        }
        cleaned++;
      } else if (event.isSampled) {
        // Track still-active sampled types
        if (!samplingActive.includes(event.type)) {
          samplingActive.push(event.type);
        }
      }
    }

    // Update metadata
    const meta = {
      totalCount: Object.keys(events).length,
      lastCleanup: Date.now(),
      samplingActive,
    };

    await Promise.all([
      this.api.memory.store("event_monitor_events", events),
      this.api.memory.store("event_monitor_index", index),
      this.api.memory.store("event_monitor_meta", meta),
    ]);

    if (cleaned > 0) {
      console.log(`[event-monitor] Cleaned ${cleaned} old events`);
    }
  }

  /**
   * Handle timeline UI request
   */
  private async handleTimelineUI(req: Request): Promise<Response> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Event Timeline - Ronin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    .header {
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .header h1 {
      font-size: clamp(1.5rem, 3vw, 2rem);
      font-weight: 300;
    }

    .auto-refresh {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.875rem;
    }

    .auto-refresh.active {
      color: #28a745;
    }

    .filters {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .filter-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
      margin-bottom: 1rem;
    }

    .filter-section h4 {
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
    }

    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-height: 150px;
      overflow-y: auto;
      padding: 0.5rem;
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.sm};
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      cursor: pointer;
    }

    .checkbox-item input[type="checkbox"] {
      cursor: pointer;
    }

    .search-box {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .search-box input {
      flex: 1;
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.5rem 0.75rem;
      border-radius: ${roninTheme.borderRadius.md};
      font-family: inherit;
    }

    .btn {
      background: ${roninTheme.colors.accent};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.5rem 1rem;
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.875rem;
    }

    .btn:hover {
      background: ${roninTheme.colors.accentHover};
    }

    .btn-secondary {
      background: transparent;
      color: ${roninTheme.colors.textSecondary};
    }

    .btn-secondary:hover {
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textPrimary};
    }

    .stats {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
      color: ${roninTheme.colors.textSecondary};
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .sampling-indicator {
      background: #fd7e14;
      color: white;
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
      font-size: 0.625rem;
      font-weight: 600;
    }

    .events-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .event {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: 1rem;
      transition: all 0.2s;
    }

    .event:hover {
      border-color: ${roninTheme.colors.borderHover};
    }

    .event-new {
      animation: highlight-pulse 2s ease-out;
    }

    @keyframes highlight-pulse {
      0% { background-color: rgba(253, 126, 20, 0.3); }
      100% { background-color: transparent; }
    }

    .event-sampled {
      opacity: 0.7;
      border-left: 3px solid #fd7e14;
    }

    .event-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }

    .event-timestamp {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
    }

    .event-type {
      font-weight: 600;
      font-size: 0.875rem;
      color: ${roninTheme.colors.textPrimary};
    }

    .event-source {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
      background: ${roninTheme.colors.backgroundTertiary};
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
    }

    .badge-sampled {
      background: #fd7e14;
      color: white;
      font-size: 0.625rem;
      font-weight: 600;
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
    }

    .event-payload {
      margin-top: 0.5rem;
      padding: 0.75rem;
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.sm};
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 150px;
      overflow-y: auto;
    }

    .event-payload.collapsed {
      display: none;
    }

    .payload-toggle {
      font-size: 0.75rem;
      color: ${roninTheme.colors.accent};
      cursor: pointer;
      margin-top: 0.5rem;
    }

    .payload-toggle:hover {
      color: ${roninTheme.colors.accentHover};
    }

    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 1rem;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid ${roninTheme.colors.border};
    }

    .pagination button {
      background: transparent;
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
      padding: 0.5rem 1rem;
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
    }

    .pagination button:hover:not(:disabled) {
      background: ${roninTheme.colors.backgroundSecondary};
      color: ${roninTheme.colors.textPrimary};
    }

    .pagination button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .page-info {
      font-size: 0.875rem;
      color: ${roninTheme.colors.textSecondary};
    }

    .loading {
      text-align: center;
      padding: 2rem;
      color: ${roninTheme.colors.textTertiary};
    }

    .error {
      background: rgba(220, 53, 69, 0.1);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #dc3545;
      padding: 1rem;
      border-radius: ${roninTheme.borderRadius.md};
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Event Timeline</h1>
      <div class="auto-refresh active" id="autoRefreshIndicator">
        <span>🔄</span>
        <span>Auto-refresh: ON (30s)</span>
      </div>
    </div>

    <div class="filters">
      <div class="filter-grid">
        <div class="filter-section">
          <h4>Event Types</h4>
          <div class="checkbox-group" id="typeFilters">
            <label class="checkbox-item">
              <input type="checkbox" id="selectAllTypes" checked>
              <span><strong>Select All</strong></span>
            </label>
            <div id="typeCheckboxes">
              <!-- Populated by JS -->
            </div>
          </div>
        </div>

        <div class="filter-section">
          <h4>Sources</h4>
          <div class="checkbox-group" id="sourceFilters">
            <label class="checkbox-item">
              <input type="checkbox" id="selectAllSources" checked>
              <span><strong>Select All</strong></span>
            </label>
            <div id="sourceCheckboxes">
              <!-- Populated by JS -->
            </div>
          </div>
        </div>

        <div class="filter-section">
          <h4>Time Range</h4>
          <div class="checkbox-group">
            <label class="checkbox-item">
              <input type="radio" name="timeRange" value="1h">
              <span>Last hour</span>
            </label>
            <label class="checkbox-item">
              <input type="radio" name="timeRange" value="24h" checked>
              <span>Last 24 hours</span>
            </label>
            <label class="checkbox-item">
              <input type="radio" name="timeRange" value="7d">
              <span>Last 7 days</span>
            </label>
            <label class="checkbox-item">
              <input type="radio" name="timeRange" value="all">
              <span>All time</span>
            </label>
          </div>
        </div>
      </div>

      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search events...">
        <button class="btn" onclick="applyFilters()">Apply</button>
        <button class="btn btn-secondary" onclick="clearFilters()">Clear</button>
      </div>

      <label class="checkbox-item">
        <input type="checkbox" id="hideSampled">
        <span>Hide sampled events</span>
      </label>
    </div>

    <div class="stats" id="stats">
      <span class="stat-item">Loading...</span>
    </div>

    <div class="events-list" id="eventsList">
      <div class="loading">Loading events...</div>
    </div>

    <div class="pagination" id="pagination">
      <!-- Populated by JS -->
    </div>
  </div>

  <script>
    let currentPage = 1;
    let knownEventIds = new Set();
    const refreshInterval = 30000; // 30 seconds

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      loadEvents();
      setInterval(loadEvents, refreshInterval);
      setupEventListeners();
    });

    function setupEventListeners() {
      // Select all/none for types
      document.getElementById('selectAllTypes').addEventListener('change', (e) => {
        document.querySelectorAll('#typeCheckboxes input').forEach(cb => {
          cb.checked = e.target.checked;
        });
      });

      // Select all/none for sources
      document.getElementById('selectAllSources').addEventListener('change', (e) => {
        document.querySelectorAll('#sourceCheckboxes input').forEach(cb => {
          cb.checked = e.target.checked;
        });
      });
    }

    async function loadEvents() {
      try {
        const params = new URLSearchParams();
        
        // Get selected types
        const selectedTypes = Array.from(document.querySelectorAll('#typeCheckboxes input:checked'))
          .map(cb => cb.value);
        if (selectedTypes.length > 0) {
          selectedTypes.forEach(type => params.append('type', type));
        }

        // Get selected sources
        const selectedSources = Array.from(document.querySelectorAll('#sourceCheckboxes input:checked'))
          .map(cb => cb.value);
        if (selectedSources.length > 0) {
          selectedSources.forEach(source => params.append('source', source));
        }

        // Get time range
        const timeRange = document.querySelector('input[name="timeRange"]:checked')?.value;
        if (timeRange && timeRange !== 'all') {
          const now = Date.now();
          let from;
          switch(timeRange) {
            case '1h': from = now - 3600000; break;
            case '24h': from = now - 86400000; break;
            case '7d': from = now - 604800000; break;
          }
          params.append('from', from);
        }

        // Get search
        const search = document.getElementById('searchInput').value;
        if (search) params.append('search', search);

        // Hide sampled
        if (document.getElementById('hideSampled').checked) {
          params.append('hideSampled', 'true');
        }

        // Pagination
        params.append('page', currentPage);
        params.append('limit', 50);

        const response = await fetch(\`/timeline/api/events?\${params}\`);
        const data = await response.json();

        renderEvents(data);
        renderFilters(data);
        renderPagination(data);
        renderStats(data);
      } catch (error) {
        document.getElementById('eventsList').innerHTML = 
          \`<div class="error">Failed to load events: \${error.message}</div>\`;
      }
    }

    function renderEvents(data) {
      const container = document.getElementById('eventsList');
      
      if (!data.events || data.events.length === 0) {
        container.innerHTML = '<div class="loading">No events found</div>';
        return;
      }

      const hideSampled = document.getElementById('hideSampled').checked;
      const events = hideSampled 
        ? data.events.filter(e => !e.isSampled)
        : data.events;

      // Track new events for animation
      const newIds = new Set();
      events.forEach(event => {
        if (!knownEventIds.has(event.id)) {
          newIds.add(event.id);
        }
      });
      knownEventIds = new Set(events.map(e => e.id));

      container.innerHTML = events.map(event => {
        const isNew = newIds.has(event.id);
        const sampledClass = event.isSampled ? 'event-sampled' : '';
        const newClass = isNew ? 'event-new' : '';
        const sampledBadge = event.isSampled 
          ? \`<span class="badge-sampled" title="Every \${event.sampleRate}th event stored">SAMPLED</span>\` 
          : '';
        
        const date = new Date(event.timestamp);
        const timeStr = date.toLocaleTimeString();
        const dateStr = date.toLocaleDateString();
        
        return \`
          <div class="event \${sampledClass} \${newClass}" data-event-id="\${event.id}">
            <div class="event-header">
              <span class="event-timestamp">\${dateStr} \${timeStr}</span>
              <span class="event-type">\${escapeHtml(event.type)}</span>
              <span class="event-source">\${escapeHtml(event.source)}</span>
              \${sampledBadge}
            </div>
            <div class="event-payload collapsed" id="payload-\${event.id}">
              \${escapeHtml(event.payload)}
            </div>
            <div class="payload-toggle" onclick="togglePayload('\${event.id}')">
              [View Payload]
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderFilters(data) {
      // Render type checkboxes
      const typeContainer = document.getElementById('typeCheckboxes');
      if (data.allTypes && typeContainer.children.length === 0) {
        typeContainer.innerHTML = data.allTypes.map(type => \`
          <label class="checkbox-item">
            <input type="checkbox" value="\${escapeHtml(type)}" checked>
            <span>\${escapeHtml(type)}</span>
          </label>
        \`).join('');
      }

      // Render source checkboxes
      const sourceContainer = document.getElementById('sourceCheckboxes');
      if (data.allSources && sourceContainer.children.length === 0) {
        sourceContainer.innerHTML = data.allSources.map(source => \`
          <label class="checkbox-item">
            <input type="checkbox" value="\${escapeHtml(source)}" checked>
            <span>\${escapeHtml(source)}</span>
          </label>
        \`).join('');
      }
    }

    function renderPagination(data) {
      const container = document.getElementById('pagination');
      if (data.pages <= 1) {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = \`
        <button \${currentPage <= 1 ? 'disabled' : ''} onclick="changePage(\${currentPage - 1})">← Prev</button>
        <span class="page-info">Page \${currentPage} of \${data.pages}</span>
        <button \${currentPage >= data.pages ? 'disabled' : ''} onclick="changePage(\${currentPage + 1})">Next →</button>
      \`;
    }

    function renderStats(data) {
      const container = document.getElementById('stats');
      const sampledCount = data.events?.filter(e => e.isSampled).length || 0;
      const samplingInfo = data.sampling?.length > 0 
        ? \`<span class="sampling-indicator">Sampling active: \${data.sampling.join(', ')}</span>\`
        : '';
      
      container.innerHTML = \`
        <span class="stat-item">📊 Total: \${data.total || 0} events</span>
        <span class="stat-item">📄 Page: \${data.events?.length || 0} shown</span>
        \${sampledCount > 0 ? \`<span class="stat-item">🎯 Sampled: \${sampledCount}</span>\` : ''}
        \${samplingInfo}
      \`;
    }

    function changePage(page) {
      currentPage = page;
      loadEvents();
    }

    function applyFilters() {
      currentPage = 1;
      loadEvents();
    }

    function clearFilters() {
      document.getElementById('searchInput').value = '';
      document.getElementById('hideSampled').checked = false;
      document.querySelectorAll('input[name="timeRange"][value="24h"]').forEach(r => r.checked = true);
      document.querySelectorAll('.checkbox-group input[type="checkbox"]').forEach(cb => cb.checked = true);
      currentPage = 1;
      loadEvents();
    }

    function togglePayload(eventId) {
      const payload = document.getElementById(\`payload-\${eventId}\`);
      const toggle = payload.nextElementSibling;
      
      if (payload.classList.contains('collapsed')) {
        payload.classList.remove('collapsed');
        toggle.textContent = '[Hide Payload]';
      } else {
        payload.classList.add('collapsed');
        toggle.textContent = '[View Payload]';
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  /**
   * Handle events API request
   */
  private async handleEventsAPI(req: Request): Promise<Response> {
    const url = new URL(req.url);
    
    // Parse query params
    const types = url.searchParams.getAll("type");
    const sources = url.searchParams.getAll("source");
    const from = url.searchParams.get("from") 
      ? parseInt(url.searchParams.get("from")!) 
      : undefined;
    const to = url.searchParams.get("to") 
      ? parseInt(url.searchParams.get("to")!) 
      : undefined;
    const search = url.searchParams.get("search") || undefined;
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const hideSampled = url.searchParams.get("hideSampled") === "true";

    try {
      // Load all events
      const eventsData = (await this.api.memory.retrieve("event_monitor_events")) as Record<
        string,
        EventRecord
      > || {};
      const index = (await this.api.memory.retrieve("event_monitor_index")) as Record<
        string,
        string[]
      > || {};
      const meta = (await this.api.memory.retrieve("event_monitor_meta")) as {
        totalCount: number;
        samplingActive: string[];
      } || { totalCount: 0, samplingActive: [] };

      let events = Object.values(eventsData);

      // Apply filters
      if (types.length > 0) {
        events = events.filter(e => types.includes(e.type));
      }

      if (sources.length > 0) {
        events = events.filter(e => sources.includes(e.source));
      }

      if (from) {
        events = events.filter(e => e.timestamp >= from);
      }

      if (to) {
        events = events.filter(e => e.timestamp <= to);
      }

      if (hideSampled) {
        events = events.filter(e => !e.isSampled);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        events = events.filter(e =>
          e.type.toLowerCase().includes(searchLower) ||
          e.source.toLowerCase().includes(searchLower) ||
          e.payload.toLowerCase().includes(searchLower)
        );
      }

      // Sort by timestamp (newest first)
      events.sort((a, b) => b.timestamp - a.timestamp);

      // Get unique types and sources for filters
      const allTypes = Object.keys(index).sort();
      const allSources = [...new Set(events.map(e => e.source))].sort();

      // Paginate
      const total = events.length;
      const pages = Math.ceil(total / limit);
      const start = (page - 1) * limit;
      const paginatedEvents = events.slice(start, start + limit);

      return Response.json({
        events: paginatedEvents,
        total,
        page,
        pages,
        allTypes,
        allSources,
        sampling: meta.samplingActive,
      });
    } catch (error) {
      return Response.json(
        { error: String(error) },
        { status: 500 }
      );
    }
  }
}
