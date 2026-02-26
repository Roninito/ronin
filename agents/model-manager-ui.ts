/**
 * Model Manager UI Agent
 * 
 * Provides advanced model management interface with provider sections
 * and per-model control to adjust constraints and settings
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

export default class ModelManagerUIAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
    console.log("[model-manager-ui] Model management dashboard available at /models/manage");
  }

  async execute(): Promise<void> {
    // No-op - routes registered in constructor
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/models/manage", this.handleDashboard.bind(this));
    this.api.http.registerRoute("/models/api/managers/list", this.handleList.bind(this));
    this.api.http.registerRoute("/models/api/managers/providers", this.handleProviders.bind(this));
    this.api.http.registerRoute("/models/api/managers/update", this.handleUpdate.bind(this));
    this.api.http.registerRoute("/models/api/managers/add", this.handleAdd.bind(this));
    this.api.http.registerRoute("/models/api/managers/remove", this.handleRemove.bind(this));
  }

  private async handleDashboard(): Promise<Response> {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Model Manager - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

    body {
      min-height: 100vh;
      margin: 0;
      padding: 0;
    }

    .page-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.xl};
    }

    .provider-section {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      margin-bottom: ${roninTheme.spacing.lg};
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .provider-section:hover {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.backgroundTertiary};
    }

    .provider-header {
      background: linear-gradient(135deg, ${roninTheme.colors.backgroundTertiary}, ${roninTheme.colors.backgroundSecondary});
      border-bottom: 1px solid ${roninTheme.colors.border};
      padding: ${roninTheme.spacing.md} ${roninTheme.spacing.lg};
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      transition: all 0.2s;
    }

    .provider-header:hover {
      background: linear-gradient(135deg, ${roninTheme.colors.backgroundTertiary}, ${roninTheme.colors.accent});
    }

    .provider-header h2 {
      font-size: 1.1rem;
      margin: 0;
      font-weight: 400;
      letter-spacing: -0.01em;
      color: ${roninTheme.colors.textPrimary};
    }

    .provider-header .info {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 300;
    }

    .provider-header .toggle {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
      transition: transform 0.3s;
    }

    .provider-content {
      padding: ${roninTheme.spacing.lg};
      display: none;
    }

    .provider-content.expanded {
      display: block;
    }

    .models-list {
      display: grid;
      gap: ${roninTheme.spacing.md};
    }

    .model-card {
      background: ${roninTheme.colors.backgroundTertiary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .model-card:hover {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.accent};
      transform: translateY(-2px);
    }

    .model-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: ${roninTheme.spacing.md};
    }

    .model-info h3 {
      font-size: 0.95rem;
      margin: 0 0 ${roninTheme.spacing.xs} 0;
      font-weight: 400;
      letter-spacing: -0.01em;
      color: ${roninTheme.colors.textPrimary};
    }

    .model-nametag {
      background: ${roninTheme.colors.background};
      color: ${roninTheme.colors.link};
      padding: 2px 8px;
      border-radius: ${roninTheme.borderRadius.sm};
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.75rem;
      display: inline-block;
      letter-spacing: 0.02em;
    }

    .model-actions {
      display: flex;
      gap: ${roninTheme.spacing.sm};
    }

    .btn {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.8125rem;
      font-family: ${roninTheme.fonts.primary};
      font-weight: 400;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
    }

    .btn:hover:not(:disabled) {
      background: ${roninTheme.colors.backgroundTertiary};
      border-color: ${roninTheme.colors.borderHover};
      color: ${roninTheme.colors.textPrimary};
      transform: translateY(-1px);
    }

    .btn-danger {
      border-color: ${roninTheme.colors.error};
      color: ${roninTheme.colors.error};
    }

    .btn-danger:hover {
      background: rgba(220, 53, 69, 0.1);
      border-color: ${roninTheme.colors.error};
    }

    .settings {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: ${roninTheme.spacing.md};
      margin-top: ${roninTheme.spacing.md};
      padding-top: ${roninTheme.spacing.md};
      border-top: 1px solid ${roninTheme.colors.border};
      font-size: 0.8125rem;
    }

    .setting {
      display: flex;
      flex-direction: column;
    }

    .setting label {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: ${roninTheme.spacing.xs};
      font-weight: 500;
    }

    .setting span {
      color: ${roninTheme.colors.textSecondary};
      font-family: ${roninTheme.fonts.mono};
      line-height: 1.4;
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(4px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    .modal.show {
      display: flex;
    }

    .modal-content {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.xl};
      max-width: 500px;
      width: 90%;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }

    .modal-header {
      margin-bottom: ${roninTheme.spacing.lg};
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 400;
      letter-spacing: -0.01em;
      color: ${roninTheme.colors.textPrimary};
    }

    .modal-close {
      background: none;
      border: none;
      color: ${roninTheme.colors.textSecondary};
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
    }

    .modal-close:hover {
      color: ${roninTheme.colors.textPrimary};
    }

    .form-group {
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .form-group label {
      display: block;
      margin-bottom: ${roninTheme.spacing.sm};
      font-weight: 400;
      font-size: 0.8125rem;
      color: ${roninTheme.colors.textPrimary};
      letter-spacing: -0.01em;
    }

    .form-group input {
      width: 100%;
      padding: ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundTertiary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      border-radius: ${roninTheme.borderRadius.md};
      font-family: ${roninTheme.fonts.primary};
      font-size: 0.875rem;
      transition: all 0.3s;
    }

    .form-group input:focus {
      outline: none;
      border-color: ${roninTheme.colors.link};
      background: ${roninTheme.colors.background};
      box-shadow: 0 0 0 2px rgba(132, 204, 22, 0.1);
    }

    .form-group input::placeholder {
      color: ${roninTheme.colors.textTertiary};
    }

    .modal-actions {
      display: flex;
      gap: ${roninTheme.spacing.md};
      justify-content: flex-end;
      margin-top: ${roninTheme.spacing.lg};
      padding-top: ${roninTheme.spacing.lg};
      border-top: 1px solid ${roninTheme.colors.border};
    }

    .modal-actions .btn {
      min-width: 100px;
    }

    .provider-empty {
      color: ${roninTheme.colors.textTertiary};
      padding: ${roninTheme.spacing.lg};
      text-align: center;
      font-size: 0.875rem;
      font-style: italic;
    }

    #providers-container {
      margin-top: ${roninTheme.spacing.lg};
    }

    .loading {
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Model Manager</h1>
    <div class="header-meta">
      <a href="/models" style="color: ${roninTheme.colors.link}; text-decoration: none;">← Back to Dashboard</a>
    </div>
  </div>

  <div class="page-content">
    <div id="providers-container">
      <p class="loading">Loading providers...</p>
    </div>
  </div>

  <div id="edit-modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="modal-title">Edit Model</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <form id="edit-form">
        <div class="form-group">
          <label>Model Name</label>
          <input type="text" id="edit-displayName" placeholder="e.g., Claude 3.5 Haiku">
        </div>
        <div class="form-group">
          <label>Description</label>
          <input type="text" id="edit-description">
        </div>
        <div class="form-group">
          <label>Max Tokens Per Request</label>
          <input type="number" id="edit-maxTokens" min="1024" max="128000">
        </div>
        <div class="form-group">
          <label>Temperature (0-2)</label>
          <input type="number" id="edit-temperature" min="0" max="2" step="0.1">
        </div>
        <div class="form-group">
          <label>Cost Per Million Input Tokens</label>
          <input type="number" id="edit-costPerMTok" min="0" step="0.01">
        </div>
        <div class="form-group">
          <label>Cost Per Million Output Tokens</label>
          <input type="number" id="edit-costPerOTok" min="0" step="0.01">
        </div>
        <div class="form-group">
          <label>Max Daily Spend (\$)</label>
          <input type="number" id="edit-maxDailySpend" min="0" step="1">
        </div>
        <div class="form-group">
          <label>Max Monthly Spend (\$)</label>
          <input type="number" id="edit-maxMonthlySpend" min="0" step="1">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="button" class="btn" style="background: ${roninTheme.colors.link}; color: ${roninTheme.colors.background}; border-color: ${roninTheme.colors.link};" onclick="saveEdits()">Save Changes</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let editingModel = null;

    async function loadProviders() {
      try {
        const modelsResp = await fetch('/models/api/managers/list');
        const models = await modelsResp.json();
        const providersResp = await fetch('/models/api/managers/providers');
        const providers = await providersResp.json();

        const container = document.getElementById('providers-container');
        container.innerHTML = '';

        for (const [providerKey, provider] of Object.entries(providers)) {
          const providerModels = models.filter(m => m.provider === providerKey);
          
          const section = document.createElement('div');
          section.className = 'provider-section';
          
          const headerDiv = document.createElement('div');
          headerDiv.className = 'provider-header';
          headerDiv.onclick = () => toggleProvider(headerDiv);
          
          const titleDiv = document.createElement('div');
          titleDiv.innerHTML = \`
            <h2>\${providerKey.charAt(0).toUpperCase() + providerKey.slice(1)}</h2>
            <div class="info">\${providerModels.length} model(s) • \${provider.type}</div>
          \`;
          
          const toggleSpan = document.createElement('span');
          toggleSpan.className = 'toggle';
          toggleSpan.textContent = '▼';
          
          headerDiv.appendChild(titleDiv);
          headerDiv.appendChild(toggleSpan);
          
          const contentDiv = document.createElement('div');
          contentDiv.className = 'provider-content';
          
          if (providerModels.length === 0) {
            contentDiv.innerHTML = '<div class="provider-empty">No models in this provider</div>';
          } else {
            const modelsList = document.createElement('div');
            modelsList.className = 'models-list';
            
            for (const m of providerModels) {
              const card = document.createElement('div');
              card.className = 'model-card';
              card.innerHTML = \`
                <div class="model-header">
                  <div class="model-info">
                    <h3>\${m.displayName || m.nametag}</h3>
                    <span class="model-nametag">\${m.nametag}</span>
                  </div>
                  <div class="model-actions">
                    <button class="btn" onclick="editModel('\${m.nametag}')">⚙️ Edit</button>
                    <button class="btn btn-danger" onclick="removeModel('\${m.nametag}')">🗑️ Remove</button>
                  </div>
                </div>
                <div class="settings">
                  <div class="setting">
                    <label>Max Tokens</label>
                    <span>\${m.limits.maxTokensPerRequest.toLocaleString()}</span>
                  </div>
                  <div class="setting">
                    <label>Temperature</label>
                    <span>\${(m.config.temperature || 0.7).toFixed(1)}</span>
                  </div>
                  <div class="setting">
                    <label>Daily Budget</label>
                    <span>\$\${m.limits.maxDailySpend.toFixed(2)}</span>
                  </div>
                  <div class="setting">
                    <label>Monthly Budget</label>
                    <span>\$\${m.limits.maxMonthlySpend.toFixed(2)}</span>
                  </div>
                </div>
              \`;
              modelsList.appendChild(card);
            }
            contentDiv.appendChild(modelsList);
          }
          
          section.appendChild(headerDiv);
          section.appendChild(contentDiv);
          container.appendChild(section);
        }
      } catch (e) {
        document.getElementById('providers-container').innerHTML = '<p class="loading">Error: ' + e.message + '</p>';
      }
    }

    function toggleProvider(header) {
      const content = header.nextElementSibling;
      const isExpanded = content.classList.contains('expanded');
      content.classList.toggle('expanded');
      header.querySelector('.toggle').textContent = isExpanded ? '▼' : '▲';
    }

    async function editModel(nametag) {
      editingModel = nametag;
      try {
        const response = await fetch('/models/api/managers/list');
        const models = await response.json();
        const model = models.find(m => m.nametag === nametag);
        
        if (model) {
          document.getElementById('edit-displayName').value = model.displayName || '';
          document.getElementById('edit-description').value = model.description || '';
          document.getElementById('edit-maxTokens').value = model.limits.maxTokensPerRequest;
          document.getElementById('edit-temperature').value = model.config.temperature || 0.7;
          document.getElementById('edit-costPerMTok').value = model.limits.costPerMTok || 0;
          document.getElementById('edit-costPerOTok').value = model.limits.costPerOTok || 0;
          document.getElementById('edit-maxDailySpend').value = model.limits.maxDailySpend || 0;
          document.getElementById('edit-maxMonthlySpend').value = model.limits.maxMonthlySpend || 0;
          
          document.getElementById('modal-title').textContent = 'Edit Model: ' + nametag;
          document.getElementById('edit-modal').classList.add('show');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function saveEdits() {
      try {
        const updates = {
          displayName: document.getElementById('edit-displayName').value,
          description: document.getElementById('edit-description').value,
          limits: {
            maxTokensPerRequest: parseInt(document.getElementById('edit-maxTokens').value),
            costPerMTok: parseFloat(document.getElementById('edit-costPerMTok').value),
            costPerOTok: parseFloat(document.getElementById('edit-costPerOTok').value),
            maxDailySpend: parseFloat(document.getElementById('edit-maxDailySpend').value),
            maxMonthlySpend: parseFloat(document.getElementById('edit-maxMonthlySpend').value),
          },
          config: {
            temperature: parseFloat(document.getElementById('edit-temperature').value),
          }
        };

        const response = await fetch('/models/api/managers/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nametag: editingModel, updates })
        });

        if (response.ok) {
          closeModal();
          loadProviders();
        } else {
          alert('Error saving model');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function removeModel(nametag) {
      if (!confirm('Remove model: ' + nametag + '?')) return;
      
      try {
        const response = await fetch('/models/api/managers/remove?nametag=' + encodeURIComponent(nametag), {
          method: 'DELETE'
        });

        if (response.ok) {
          loadProviders();
        } else {
          alert('Error removing model');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    function closeModal() {
      document.getElementById('edit-modal').classList.remove('show');
    }

    loadProviders();
  </script>
</body>
</html>
    `;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  private async handleList(): Promise<Response> {
    try {
      const models = await this.api.plugins.call("model-selector", "listModels");
      return new Response(JSON.stringify(Array.isArray(models) ? models : []), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleProviders(): Promise<Response> {
    try {
      const registry = await this.api.plugins.call("model-selector", "loadRegistry");
      return new Response(JSON.stringify(registry.providers || {}), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleUpdate(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { nametag, updates } = body;

      if (!nametag || !updates) {
        throw new Error("nametag and updates required");
      }

      await this.api.plugins.call("model-selector", "updateModel", nametag, updates);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleAdd(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { nametag, config } = body;

      if (!nametag || !config) {
        throw new Error("nametag and config required");
      }

      await this.api.plugins.call("model-selector", "addModel", nametag, config);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleRemove(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const nametag = url.searchParams.get("nametag");

      if (!nametag) {
        throw new Error("nametag required");
      }

      await this.api.plugins.call("model-selector", "removeModel", nametag);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}
