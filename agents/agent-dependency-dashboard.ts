/**
 * @ronin enabled true
 * Agent & Plugin Dependency Dashboard
 * 
 * Provides web interface to visualize:
 * - Agent dependency graph
 * - Plugin usage map
 * - Event flow between agents
 * - System status
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.ts";

export default class AgentDependencyDashboard extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
  }

  /**
   * Register HTTP routes for the dashboard
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/dashboard/dependencies", this.handleDashboardRequest.bind(this));
    this.api.http.registerRoute("/dashboard/dependencies/", this.handleDashboardRequest.bind(this));
    this.api.http.registerRoute("/dashboard/dependencies/api/graph", this.handleGraphAPI.bind(this));
    this.api.http.registerRoute("/dashboard/dependencies/api/agents", this.handleAgentsAPI.bind(this));
    this.api.http.registerRoute("/dashboard/dependencies/api/plugins", this.handlePluginsAPI.bind(this));
    console.log("[agent-dependency-dashboard] Ready at /dashboard/dependencies");
  }

  async execute(): Promise<void> {
    // Agent runs on-demand via HTTP routes
    // Routes are registered in constructor
  }

  /**
   * Handle dashboard HTML request
   */
  private async handleDashboardRequest(req: Request): Promise<Response> {
    try {
      const html = await this.renderDashboard();
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    } catch (err) {
      console.error("[agent-dependency-dashboard] Dashboard render error:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  /**
   * Handle graph API request
   */
  private async handleGraphAPI(req: Request): Promise<Response> {
    try {
      const graph = await this.getDependencyGraph();
      return new Response(JSON.stringify(graph), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[agent-dependency-dashboard] Graph API error:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  /**
   * Handle agents API request
   */
  private async handleAgentsAPI(req: Request): Promise<Response> {
    try {
      const agents = await this.getAgentDependencies();
      return new Response(JSON.stringify(agents), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[agent-dependency-dashboard] Agents API error:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  /**
   * Handle plugins API request
   */
  private async handlePluginsAPI(req: Request): Promise<Response> {
    try {
      const plugins = await this.getPluginRegistry();
      return new Response(JSON.stringify(plugins), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[agent-dependency-dashboard] Plugins API error:", err);
      return new Response(
        JSON.stringify({ error: String(err) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  /**
   * Get agent dependency data
   */
  async getAgentDependencies(): Promise<any> {
    const registry = await this.api.memory.retrieve("agent-registry");
    return registry || [];
  }

  /**
   * Get plugin registry data
   */
  async getPluginRegistry(): Promise<any> {
    const registry = await this.api.memory.retrieve("plugin-registry");
    return registry || [];
  }

  /**
   * Get dependency graph
   */
  async getDependencyGraph(): Promise<any> {
    const graph = await this.api.memory.retrieve("agent-dependency-graph");
    return graph || { agents: [], eventProducers: [], pluginUsage: [] };
  }

  /**
   * Render HTML dashboard
   */
  async renderDashboard(): Promise<string> {
    const agents = await this.getAgentDependencies();
    const plugins = await this.getPluginRegistry();
    const graph = await this.getDependencyGraph();

    const agentRows = (agents || [])
      .map(
        (agent: any) => `
      <tr>
        <td style="padding: 0.75rem; border-bottom: 1px solid #3a3a3a;">
          <strong>${agent.name}</strong>
          ${agent.enabled ? '<span style="color: #28a745; margin-left: 0.5rem;">✓</span>' : '<span style="color: #dc3545; margin-left: 0.5rem;">✗</span>'}
        </td>
        <td style="padding: 0.75rem; border-bottom: 1px solid #3a3a3a; font-size: 0.85rem; color: #a0a0a0;">
          ${agent.schedule ? `<em>Schedule:</em> ${agent.schedule}<br>` : ""}
          ${agent.webhook ? `<em>Webhook:</em> ${agent.webhook}` : ""}
        </td>
        <td style="padding: 0.75rem; border-bottom: 1px solid #3a3a3a; font-size: 0.85rem;">
          ${(agent.emitsEvents || []).length > 0 ? `<strong>Emits:</strong> ${agent.emitsEvents.join(", ")}<br>` : ""}
          ${(agent.consumesEvents || []).length > 0 ? `<strong>Consumes:</strong> ${agent.consumesEvents.join(", ")}` : ""}
        </td>
        <td style="padding: 0.75rem; border-bottom: 1px solid #3a3a3a; font-size: 0.85rem; color: #4a9eff;">
          ${(agent.requiredPlugins || []).join(", ") || "—"}
        </td>
      </tr>
    `
      )
      .join("");

    const pluginRows = (plugins?.plugins || [])
      .map(
        (plugin: any) => `
      <tr>
        <td style="padding: 0.75rem; border-bottom: 1px solid #3a3a3a;">
          <strong>${plugin.name}</strong>
          <span style="color: #28a745; margin-left: 0.5rem;">✓ loaded</span>
        </td>
        <td style="padding: 0.75rem; border-bottom: 1px solid #3a3a3a; font-size: 0.85rem; color: #a0a0a0;">
          ${(plugin.methods || []).join(", ") || "—"}
        </td>
        <td style="padding: 0.75rem; border-bottom: 1px solid #3a3a3a; font-size: 0.85rem; color: #707070;">
          ${(plugin.usedByAgents || []).join(", ") || "—"}
        </td>
      </tr>
    `
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent & Plugin Dependencies</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    ${getThemeCSS()}
    ${getAdobeCleanFontFaceCSS()}
    ${getHeaderBarCSS()}

    body {
      background: ${roninTheme.colors.background};
      color: ${roninTheme.colors.textSecondary};
    }

    .header {
      background: ${roninTheme.colors.backgroundSecondary};
      border-bottom: 1px solid ${roninTheme.colors.border};
      padding: ${roninTheme.spacing.md} ${roninTheme.spacing.xl};
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0;
      color: ${roninTheme.colors.link};
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.xl};
    }

    .tabs {
      display: flex;
      gap: ${roninTheme.spacing.sm};
      margin-bottom: ${roninTheme.spacing.lg};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }

    .tab {
      padding: ${roninTheme.spacing.md} ${roninTheme.spacing.lg};
      background: transparent;
      border: none;
      color: ${roninTheme.colors.textSecondary};
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 0.95rem;
      transition: all 0.2s;
    }

    .tab.active {
      color: ${roninTheme.colors.link};
      border-bottom-color: ${roninTheme.colors.link};
    }

    .tab:hover {
      color: ${roninTheme.colors.textPrimary};
    }

    .section {
      display: none;
    }

    .section.active {
      display: block;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      overflow: hidden;
    }

    th {
      background: ${roninTheme.colors.backgroundTertiary};
      padding: ${roninTheme.spacing.md};
      text-align: left;
      font-weight: 600;
      border-bottom: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.9rem;
    }

    td {
      padding: ${roninTheme.spacing.md};
      border-bottom: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
    }

    tr:hover {
      background: ${roninTheme.colors.backgroundTertiary};
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.xl};
    }

    .stat-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.lg};
      text-align: center;
      transition: all 0.2s;
    }

    .stat-card:hover {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.backgroundTertiary};
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: ${roninTheme.colors.link};
      margin: ${roninTheme.spacing.sm} 0;
    }

    .stat-label {
      font-size: 0.9rem;
      color: ${roninTheme.colors.textSecondary};
    }

    .status-enabled {
      color: ${roninTheme.colors.success};
    }

    .status-disabled {
      color: ${roninTheme.colors.error};
    }

    .refresh-btn {
      background: ${roninTheme.colors.link};
      color: ${roninTheme.colors.background};
      border: none;
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.9rem;
      margin-bottom: ${roninTheme.spacing.md};
      font-weight: 500;
      transition: all 0.2s;
    }

    .refresh-btn:hover {
      background: ${roninTheme.colors.linkHover};
      transform: translateY(-1px);
    }

    #graph-container {
      width: 100%;
      height: 600px;
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      background: ${roninTheme.colors.background};
      margin: ${roninTheme.spacing.lg} 0;
    }

    .graph-node {
      stroke: ${roninTheme.colors.accent};
      stroke-width: 2px;
      cursor: move;
    }

    .graph-node:hover {
      stroke: ${roninTheme.colors.link};
      stroke-width: 3px;
    }

    .graph-link {
      stroke: ${roninTheme.colors.accent};
      stroke-width: 2px;
      stroke-opacity: 0.6;
    }

    .graph-label {
      font-size: 11px;
      fill: ${roninTheme.colors.textSecondary};
      pointer-events: none;
      text-anchor: start;
    }

    .graph-tooltip {
      position: absolute;
      padding: ${roninTheme.spacing.sm};
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.link};
      border-radius: ${roninTheme.borderRadius.md};
      font-size: 0.85rem;
      color: ${roninTheme.colors.textPrimary};
      pointer-events: none;
      z-index: 1000;
      max-width: 250px;
    }

    .debug-section {
      margin-top: ${roninTheme.spacing.xl};
      padding-top: ${roninTheme.spacing.md};
      border-top: 1px solid ${roninTheme.colors.border};
    }

    .debug-toggle {
      background: ${roninTheme.colors.accent};
      color: ${roninTheme.colors.textPrimary};
      border: 1px solid ${roninTheme.colors.border};
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.85rem;
      margin-bottom: ${roninTheme.spacing.sm};
      transition: all 0.2s;
    }

    .debug-toggle:hover {
      background: ${roninTheme.colors.accentHover};
      border-color: ${roninTheme.colors.borderHover};
    }

    .debug-content {
      display: none;
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.md};
      overflow: auto;
      max-height: 400px;
      font-size: 0.85rem;
      color: ${roninTheme.colors.link};
      font-family: ${roninTheme.fonts.mono};
    }

    .debug-content.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>🔗 Agent & Plugin Dependencies</h1>
    <div style="font-size: 0.9rem; color: #a0a0a0;">
      Last updated: <span id="lastUpdated">loading...</span>
    </div>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" onclick="showTab('agents')">📋 Agents</button>
      <button class="tab" onclick="showTab('plugins')">🔌 Plugins</button>
      <button class="tab" onclick="showTab('graph')">📊 Dependency Graph</button>
    </div>

    <!-- Agents Tab -->
    <div id="agents" class="section active">
      <h2 style="margin-bottom: 1rem;">Registered Agents (${agents?.length || 0})</h2>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">Total Agents</div>
          <div class="stat-value">${agents?.length || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Enabled</div>
          <div class="stat-value">${agents?.filter((a: any) => a.enabled)?.length || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Disabled</div>
          <div class="stat-value">${agents?.filter((a: any) => !a.enabled)?.length || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">With Schedule</div>
          <div class="stat-value">${agents?.filter((a: any) => a.schedule)?.length || 0}</div>
        </div>
      </div>

      <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>

      <table>
        <thead>
          <tr>
            <th>Agent Name</th>
            <th>Schedule & Webhook</th>
            <th>Events (Emits → Consumes)</th>
            <th>Required Plugins</th>
          </tr>
        </thead>
        <tbody>
          ${agentRows}
        </tbody>
      </table>
    </div>

    <!-- Plugins Tab -->
    <div id="plugins" class="section">
      <h2 style="margin-bottom: 1rem;">Loaded Plugins (${plugins?.plugins?.length || 0})</h2>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">Total Plugins</div>
          <div class="stat-value">${plugins?.plugins?.length || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Last Updated</div>
          <div class="stat-value" style="font-size: 0.9rem;">${new Date(plugins?.lastUpdated || 0).toLocaleTimeString()}</div>
        </div>
      </div>

      <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>

      <table>
        <thead>
          <tr>
            <th>Plugin Name</th>
            <th>Available Methods</th>
            <th>Used By Agents</th>
          </tr>
        </thead>
        <tbody>
          ${pluginRows}
        </tbody>
      </table>
    </div>

    <!-- Graph Tab -->
    <div id="graph" class="section">
      <h2 style="margin-bottom: 1rem;">Dependency Graph</h2>
      <p style="color: #a0a0a0; margin-bottom: 0.5rem;">Interactive visualization of agent and plugin dependencies</p>
      <small style="color: #707070;">💡 Drag nodes • Scroll to zoom • Left-click background to pan</small>
      
      <div id="graph-container"></div>
      
      <div class="debug-section">
        <button class="debug-toggle" onclick="toggleDebug()">🔧 Show Raw JSON</button>
        <pre id="debug-content" class="debug-content" style="font-size: 0.85rem; color: #4a9eff;">
${JSON.stringify(graph, null, 2)}
        </pre>
      </div>
    </div>
  </div>

  <script>
    function showTab(tabName) {
      // Hide all sections
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      
      // Show selected
      document.getElementById(tabName).classList.add('active');
      event.target.classList.add('active');
    }

    // Update "last updated" time
    document.getElementById('lastUpdated').textContent = new Date().toLocaleString();

    // Toggle debug JSON view
    function toggleDebug() {
      const content = document.getElementById('debug-content');
      content.classList.toggle('show');
    }

    // D3 Graph Visualization
    async function initializeDependencyGraph() {
      try {
        // Fetch graph data
        const response = await fetch('/dashboard/dependencies/api/graph');
        if (!response.ok) {
          console.error('[dashboard] Failed to fetch graph:', response.status);
          document.getElementById('graph-container').innerHTML = 
            '<div style="padding: 2rem; text-align: center; color: #a0a0a0;">Failed to load graph data (HTTP ' + response.status + ')</div>';
          return;
        }
        const apiGraph = await response.json();

        // Transform API data to D3 format
        const { nodes, links } = transformGraphData(apiGraph);

        // If no nodes, show message
        if (nodes.length === 0) {
          document.getElementById('graph-container').innerHTML = 
            '<div style="padding: 2rem; text-align: center; color: #a0a0a0;">No dependency data available</div>';
          return;
        }

        // Get container dimensions
        const container = document.getElementById('graph-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Create SVG
        const svg = d3.select('#graph-container')
          .append('svg')
          .attr('width', width)
          .attr('height', height)
          .style('background', '#1a1a1a');

        // Add group for zoom/pan
        const g = svg.append('g');

        // Create force simulation
        const simulation = d3.forceSimulation(nodes)
          .force('link', d3.forceLink(links)
            .id(d => d.id)
            .distance(d => d.type === 'strong' ? 80 : 120)
            .strength(0.7))
          .force('charge', d3.forceManyBody().strength(-400))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collide', d3.forceCollide().radius(d => d.type === 'plugin' ? 18 : 16));

        // Create defs for markers (arrow heads)
        svg.append('defs').append('marker')
          .attr('id', 'arrowhead')
          .attr('markerWidth', 10)
          .attr('markerHeight', 10)
          .attr('refX', 28)
          .attr('refY', 3)
          .attr('orient', 'auto')
          .append('polygon')
          .attr('points', '0 0, 10 3, 0 6')
          .attr('fill', '#4a4a4a');

        // Draw links
        const link = g.selectAll('line.graph-link')
          .data(links)
          .enter().append('line')
          .attr('class', 'graph-link')
          .attr('stroke', d => d.type === 'strong' ? '#4a9eff' : '#4a4a4a')
          .attr('stroke-width', d => d.type === 'strong' ? 2.5 : 1.5)
          .attr('stroke-opacity', d => d.type === 'strong' ? 0.8 : 0.5)
          .attr('marker-end', 'url(#arrowhead)');

        // Draw agent nodes (circles)
        const agentNodes = g.selectAll('circle.graph-node')
          .data(nodes.filter(n => n.type === 'agent'))
          .enter().append('circle')
          .attr('class', 'graph-node')
          .attr('r', 12)
          .attr('fill', d => d.enabled ? '#4a9eff' : '#666666')
          .attr('data-node-id', d => d.id)
          .call(drag(simulation))
          .on('mouseover', function(e, d) { highlightNode(d.id, true); })
          .on('mouseout', function(e, d) { highlightNode(d.id, false); })
          .on('click', function(e, d) { showNodeDetails(d); });

        // Draw plugin nodes (squares)
        const pluginNodes = g.selectAll('rect.graph-node')
          .data(nodes.filter(n => n.type === 'plugin'))
          .enter().append('rect')
          .attr('class', 'graph-node')
          .attr('width', 20)
          .attr('height', 20)
          .attr('x', d => d.x - 10)
          .attr('y', d => d.y - 10)
          .attr('fill', '#28a745')
          .attr('rx', 3)
          .attr('data-node-id', d => d.id)
          .call(drag(simulation))
          .on('mouseover', function(e, d) { highlightNode(d.id, true); })
          .on('mouseout', function(e, d) { highlightNode(d.id, false); })
          .on('click', function(e, d) { showNodeDetails(d); });

        // Draw labels
        const labels = g.selectAll('text.graph-label')
          .data(nodes)
          .enter().append('text')
          .attr('class', 'graph-label')
          .text(d => d.label)
          .attr('data-node-id', d => d.id);

        // Add zoom/pan behavior
        svg.call(d3.zoom()
          .on('zoom', (e) => {
            g.attr('transform', e.transform);
          }));

        // Update positions on simulation tick
        simulation.on('tick', () => {
          link.attr('x1', d => d.source.x)
              .attr('y1', d => d.source.y)
              .attr('x2', d => d.target.x)
              .attr('y2', d => d.target.y);

          agentNodes.attr('cx', d => d.x)
                    .attr('cy', d => d.y);

          pluginNodes.attr('x', d => d.x - 10)
                     .attr('y', d => d.y - 10);

          labels.attr('x', d => d.x + 18)
                .attr('y', d => d.y + 4);
        });

        // Drag behavior
        function drag(simulation) {
          return d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded);

          function dragStarted(e, d) {
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          }

          function dragged(e, d) {
            d.fx = e.x;
            d.fy = e.y;
          }

          function dragEnded(e, d) {
            if (!e.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }
        }

        // Highlight node and connected edges
        function highlightNode(nodeId, highlight) {
          const connectedNodes = new Set([nodeId]);
          const connectedLinks = new Set();

          // Find all connected nodes and links
          links.forEach(link => {
            if (link.source.id === nodeId) {
              connectedNodes.add(link.target.id);
              connectedLinks.add(links.indexOf(link));
            }
            if (link.target.id === nodeId) {
              connectedNodes.add(link.source.id);
              connectedLinks.add(links.indexOf(link));
            }
          });

          if (highlight) {
            g.selectAll('.graph-node').style('opacity', d => 
              connectedNodes.has(d.id) ? 1 : 0.3);
            g.selectAll('.graph-link').style('opacity', (d, i) =>
              connectedLinks.has(i) ? 1 : 0.1);
            g.selectAll('.graph-label').style('opacity', d =>
              connectedNodes.has(d.id) ? 1 : 0.3);
          } else {
            g.selectAll('.graph-node').style('opacity', 1);
            g.selectAll('.graph-link').style('opacity', 0.6);
            g.selectAll('.graph-label').style('opacity', 1);
          }
        }

        // Show node details on click
        function showNodeDetails(node) {
          const details = [];
          details.push(\`<strong>\${node.label}</strong>\`);
          details.push(\`<em>Type: \${node.type}\`);
          if (node.type === 'agent') {
            details.push(\`Status: \${node.enabled ? '✓ Enabled' : '✗ Disabled'}\`);
          }
          console.log('Node details:', node);
          alert(\`\${details.join('\\n')}\`);
        }

      } catch (error) {
        console.error('Failed to initialize dependency graph:', error);
        document.getElementById('graph-container').innerHTML = 
          '<div style="padding: 2rem; color: #dc3545;">Error loading dependency graph</div>';
      }
    }

    // Transform API graph to D3 format
    function transformGraphData(apiGraph) {
      const nodes = [];
      const links = [];
      const nodeIds = new Set();

      // Create agent nodes
      (apiGraph.agents || []).forEach(agent => {
        nodes.push({
          id: agent.name,
          type: 'agent',
          label: agent.name,
          enabled: agent.enabled,
          x: Math.random() * 400 - 200,
          y: Math.random() * 400 - 200,
          vx: 0,
          vy: 0
        });
        nodeIds.add(agent.name);
      });

      // Collect all plugins
      const pluginNames = new Set();
      (apiGraph.agents || []).forEach(agent => {
        (agent.requiredPlugins || []).forEach(plugin => {
          pluginNames.add(plugin);
        });
      });

      // Create plugin nodes
      pluginNames.forEach(plugin => {
        const nodeId = \`plugin-\${plugin}\`;
        nodes.push({
          id: nodeId,
          type: 'plugin',
          label: plugin,
          x: Math.random() * 400 - 200,
          y: Math.random() * 400 - 200,
          vx: 0,
          vy: 0
        });
        nodeIds.add(nodeId);
      });

      // Create agent-plugin links
      (apiGraph.agents || []).forEach(agent => {
        (agent.requiredPlugins || []).forEach(plugin => {
          links.push({
            source: agent.name,
            target: \`plugin-\${plugin}\`,
            type: 'weak'
          });
        });
      });

      // Create agent-agent links (event dependencies)
      (apiGraph.agents || []).forEach(agent => {
        (agent.dependsOnAgents || []).forEach(depAgent => {
          if (nodeIds.has(depAgent)) {
            links.push({
              source: agent.name,
              target: depAgent,
              type: 'strong'
            });
          }
        });
      });

      return { nodes, links };
    }

    // Initialize graph when graph tab is shown
    document.addEventListener('DOMContentLoaded', () => {
      // Wait for graph tab to be visible, then initialize
      const observer = new MutationObserver((mutations) => {
        const graphSection = document.getElementById('graph');
        if (graphSection?.classList.contains('active') && 
            graphSection.querySelector('svg') === null) {
          initializeDependencyGraph();
          observer.disconnect();
        }
      });

      // Watch for tab changes
      document.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab')) {
          setTimeout(() => {
            const graphSection = document.getElementById('graph');
            if (graphSection?.classList.contains('active') && 
                graphSection.querySelector('svg') === null) {
              initializeDependencyGraph();
            }
          }, 50);
        }
      });

      // Also initialize if graph tab is already active
      if (document.getElementById('graph')?.classList.contains('active')) {
        initializeDependencyGraph();
      }
    });
  </script>
</body>
</html>`;
  }
}
