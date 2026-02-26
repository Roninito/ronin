/**
 * Model Selector UI Agent
 * 
 * Provides a web dashboard for viewing and selecting AI models.
 * Integrates with the Model Selection System (Phase 1/3).
 * 
 * Routes:
 * - GET /models - Main dashboard UI
 * - GET /models/api/list - List all available models (JSON)
 * - GET /models/api/default - Get current default model (JSON)
 * - POST /models/api/set-default - Set default model (JSON)
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

interface ModelInfo {
  nametag: string;
  name: string;
  provider: string;
  modelId: string;
  description: string;
  tags: string[];
  isDefault: boolean;
  limits?: {
    costPerMTok: number;
    costPerOTok: number;
  };
}

export default class ModelSelectorUIAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    this.registerRoutes();
    console.log("[model-selector-ui] Dashboard available at /models");
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/models", this.handleDashboard.bind(this), {
      title: "Model Selector",
      description: "Select and manage AI models",
      icon: "🤖",
    });

    this.api.http.registerRoute("/models/api/list", this.handleListModels.bind(this));
    this.api.http.registerRoute("/models/api/default", this.handleGetDefault.bind(this));
    this.api.http.registerRoute("/models/api/set-default", this.handleSetDefault.bind(this));
  }

  private async handleDashboard(_req: Request): Promise<Response> {
    // Load models from model-selector plugin or registry
    let models: ModelInfo[] = [];
    try {
      const allModels = await this.api.plugins.call("model-selector", "listModels");
      if (Array.isArray(allModels)) {
        models = (allModels as any[]).map((m: any) => ({
          nametag: m.nametag || m.displayName || "unknown",
          name: m.displayName || m.nametag,
          provider: m.provider || "unknown",
          modelId: m.modelId || m.model,
          description: m.description || "",
          tags: m.tags || [],
          isDefault: m.isDefault || false,
          limits: m.limits,
        }));
      }
    } catch (e) {
      console.warn("[model-selector-ui] Failed to load models:", e);
    }

    const defaultModel = models.find((m) => m.isDefault)?.nametag || "none";
    const html = this.getHtml(models, defaultModel);

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  private async handleListModels(_req: Request): Promise<Response> {
    try {
      const allModels = await this.api.plugins.call("model-selector", "listModels");
      if (!Array.isArray(allModels)) {
        throw new Error("listModels did not return an array");
      }

      const models: ModelInfo[] = (allModels as any[]).map((m: any) => ({
        nametag: m.nametag || m.displayName || "unknown",
        name: m.displayName || m.nametag,
        provider: m.provider || "unknown",
        modelId: m.modelId || m.model,
        description: m.description || "",
        tags: m.tags || [],
        isDefault: m.isDefault || false,
        limits: m.limits,
      }));

      return new Response(JSON.stringify(models), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleGetDefault(_req: Request): Promise<Response> {
    try {
      const defaultModel = await this.api.plugins.call("model-selector", "getDefaultModel");
      if (!defaultModel) {
        return new Response(JSON.stringify({ default: null }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ default: defaultModel.nametag }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleSetDefault(req: Request): Promise<Response> {
    try {
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "POST required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = (await req.json()) as { nametag?: string };
      const nametag = body.nametag;

      if (!nametag) {
        return new Response(JSON.stringify({ error: "nametag required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      await this.api.plugins.call("model-selector", "setDefaultModel", nametag);

      return new Response(JSON.stringify({ success: true, default: nametag }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private getHtml(models: ModelInfo[], defaultModel: string): string {
    const modelRows = models
      .map(
        (m) => `
      <tr data-nametag="${m.nametag}" class="${m.isDefault ? "default-row" : ""}">
        <td class="model-name">
          <strong>${m.name}</strong>
          <br>
          <small style="color: #666;">${m.nametag}</small>
        </td>
        <td><code>${m.provider}</code></td>
        <td>
          ${m.tags.map((t) => `<span class="tag">${t}</span>`).join("")}
        </td>
        <td>
          <button 
            class="btn-default" 
            onclick="setDefault('${m.nametag}')"
            ${m.isDefault ? "disabled" : ""}
          >
            ${m.isDefault ? "✓ Default" : "Set Default"}
          </button>
        </td>
      </tr>
    `
      )
      .join("");

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Model Selector</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    .header {
      background: white;
      border-radius: 12px 12px 0 0;
      padding: 2rem;
      border-bottom: 2px solid #f0f0f0;
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .header h1 {
      font-size: 28px;
      color: #333;
      margin: 0;
    }

    .header-icon {
      font-size: 32px;
    }

    .info {
      background: white;
      border-radius: 0;
      padding: 1.5rem 2rem;
      border-bottom: 2px solid #f0f0f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .current-default {
      background: #e8f5e9;
      padding: 1rem 1.5rem;
      border-radius: 6px;
      border-left: 4px solid #4caf50;
    }

    .current-default strong {
      color: #2e7d32;
    }

    .content {
      background: white;
      border-radius: 0 0 12px 12px;
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      background: #f9f9f9;
      border-bottom: 2px solid #ddd;
    }

    th {
      padding: 1rem;
      text-align: left;
      font-weight: 600;
      color: #333;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    td {
      padding: 1.25rem 1rem;
      border-bottom: 1px solid #f0f0f0;
    }

    tr:hover {
      background: #fafafa;
    }

    tr.default-row {
      background: #f0f7ff;
    }

    .model-name {
      font-weight: 500;
      width: 250px;
    }

    .tag {
      display: inline-block;
      background: #e3f2fd;
      color: #1976d2;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 12px;
      margin-right: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .btn-default {
      background: #667eea;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-default:hover:not(:disabled) {
      background: #5568d3;
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
    }

    .btn-default:disabled {
      background: #4caf50;
      cursor: default;
      opacity: 0.8;
    }

    code {
      background: #f5f5f5;
      padding: 0.25rem 0.5rem;
      border-radius: 3px;
      font-family: "Courier New", monospace;
      font-size: 12px;
      color: #666;
    }

    .loading {
      text-align: center;
      padding: 2rem;
      color: #999;
    }

    .error {
      background: #ffebee;
      border: 1px solid #f5a6a6;
      color: #c62828;
      padding: 1rem;
      border-radius: 6px;
      margin: 1rem;
    }

    .success {
      background: #e8f5e9;
      border: 1px solid #81c784;
      color: #2e7d32;
      padding: 1rem;
      border-radius: 6px;
      margin: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-icon">🤖</div>
      <h1>AI Model Selector</h1>
    </div>

    <div class="info">
      <div class="current-default">
        <strong>Current Default:</strong> <code>${defaultModel}</code>
      </div>
    </div>

    <div class="content">
      <div id="status"></div>
      <table id="models-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Provider</th>
            <th>Tags</th>
            <th style="width: 160px;">Action</th>
          </tr>
        </thead>
        <tbody id="models-body">
          <tr><td colspan="4" class="loading">Loading models...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    async function loadModels() {
      try {
        const response = await fetch('/models/api/list');
        if (!response.ok) throw new Error('Failed to load models');
        
        const models = await response.json();
        const tbody = document.getElementById('models-body');
        
        tbody.innerHTML = models.map(m => \`
          <tr data-nametag="\${m.nametag}" class="\${m.isDefault ? 'default-row' : ''}">
            <td class="model-name">
              <strong>\${m.name}</strong>
              <br>
              <small style="color: #666;">\${m.nametag}</small>
            </td>
            <td><code>\${m.provider}</code></td>
            <td>
              \${m.tags.map(t => \`<span class="tag">\${t}</span>\`).join('')}
            </td>
            <td>
              <button 
                class="btn-default" 
                onclick="setDefault('\${m.nametag}')"
                \${m.isDefault ? 'disabled' : ''}
              >
                \${m.isDefault ? '✓ Default' : 'Set Default'}
              </button>
            </td>
          </tr>
        \`).join('');
      } catch (error) {
        const tbody = document.getElementById('models-body');
        tbody.innerHTML = \`<tr><td colspan="4" class="error">Error: \${error.message}</td></tr>\`;
      }
    }

    async function setDefault(nametag) {
      try {
        const response = await fetch('/models/api/set-default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nametag })
        });
        
        if (!response.ok) throw new Error('Failed to set default');
        
        const result = await response.json();
        showStatus('success', \`✓ Default model set to \${nametag}\`);
        
        // Reload models after a short delay
        setTimeout(() => location.reload(), 500);
      } catch (error) {
        showStatus('error', \`Error: \${error.message}\`);
      }
    }

    function showStatus(type, message) {
      const status = document.getElementById('status');
      status.innerHTML = \`<div class="\${type}">\${message}</div>\`;
      if (type === 'success') {
        setTimeout(() => { status.innerHTML = ''; }, 3000);
      }
    }

    // Load models on page load
    loadModels();
  </script>
</body>
</html>
    `;
  }
}
