/**
 * Model Manager UI Agent
 * 
 * Provides advanced model management interface with provider sections
 * and per-model control to adjust constraints and settings
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

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
  <title>Model Manager</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
    .nav-link { color: #667eea; text-decoration: none; margin-left: 20px; }
    .nav-link:hover { text-decoration: underline; }
    
    .provider-section { background: white; border-radius: 8px; margin-bottom: 20px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .provider-header { background: #667eea; color: white; padding: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .provider-header h2 { font-size: 18px; margin: 0; }
    .provider-header .info { font-size: 12px; opacity: 0.9; }
    .provider-content { padding: 20px; }
    .models-list { display: grid; gap: 15px; }
    
    .model-card { border: 1px solid #ddd; border-radius: 6px; padding: 15px; background: #fafafa; }
    .model-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .model-name { font-weight: bold; font-size: 16px; }
    .model-nametag { background: #eee; padding: 2px 8px; border-radius: 3px; font-family: monospace; font-size: 12px; }
    .model-actions { display: flex; gap: 10px; }
    .btn { padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .btn:hover { background: #764ba2; }
    .btn-danger { background: #dc3545; }
    .btn-danger:hover { background: #c82333; }
    
    .settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd; }
    .setting { display: flex; flex-direction: column; }
    .setting label { font-size: 12px; color: #666; font-weight: 500; margin-bottom: 5px; }
    .setting input, .setting select { padding: 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 13px; }
    .setting input:focus, .setting select:focus { outline: none; border-color: #667eea; }
    
    .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
    .modal.show { display: flex; }
    .modal-content { background: white; border-radius: 8px; padding: 30px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal-header { margin-bottom: 20px; }
    .modal-header h3 { margin: 0; }
    .modal-close { float: right; cursor: pointer; font-size: 20px; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; margin-bottom: 5px; font-weight: 500; }
    .form-group input, .form-group select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
    
    .add-provider-btn { display: inline-block; margin-bottom: 20px; }
    .provider-empty { color: #999; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚙️ Model Manager</h1>
      <div>
        <a href="/models" class="nav-link">← Back to Dashboard</a>
      </div>
    </div>
    
    <div id="providers-container">
      <p>Loading providers...</p>
    </div>
  </div>

  <div id="edit-modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <span class="modal-close" onclick="closeModal()">&times;</span>
        <h3 id="modal-title">Edit Model</h3>
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
          <button type="button" onclick="closeModal()" class="btn" style="background: #999;">Cancel</button>
          <button type="button" onclick="saveEdits()" class="btn">Save Changes</button>
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
          section.innerHTML = \`
            <div class="provider-header" onclick="toggleProvider(this)">
              <div>
                <h2>\${providerKey}</h2>
                <div class="info">\${providerModels.length} model(s) • \${provider.type}</div>
              </div>
              <span>▼</span>
            </div>
            <div class="provider-content" style="display: none;">
              <div class="models-list">
                \${providerModels.length === 0 
                  ? '<div class="provider-empty">No models in this provider</div>'
                  : providerModels.map(m => \`
                    <div class="model-card">
                      <div class="model-header">
                        <div>
                          <div class="model-name">\${m.displayName || m.nametag}</div>
                          <div class="model-nametag">\${m.nametag}</div>
                        </div>
                        <div class="model-actions">
                          <button class="btn" onclick="editModel('\${m.nametag}')">⚙️ Edit</button>
                          <button class="btn btn-danger" onclick="removeModel('\${m.nametag}')">🗑️ Remove</button>
                        </div>
                      </div>
                      <div class="settings">
                        <div class="setting">
                          <label>Max Tokens</label>
                          <span>\${m.limits.maxTokensPerRequest}</span>
                        </div>
                        <div class="setting">
                          <label>Temperature</label>
                          <span>\${m.config.temperature || 0.7}</span>
                        </div>
                        <div class="setting">
                          <label>Daily Budget</label>
                          <span>\$\${m.limits.maxDailySpend}</span>
                        </div>
                        <div class="setting">
                          <label>Monthly Budget</label>
                          <span>\$\${m.limits.maxMonthlySpend}</span>
                        </div>
                      </div>
                    </div>
                  \`).join('')
                }
              </div>
            </div>
          \`;
          container.appendChild(section);
        }
      } catch (e) {
        document.getElementById('providers-container').innerHTML = '<p>Error: ' + e.message + '</p>';
      }
    }

    function toggleProvider(header) {
      const content = header.nextElementSibling;
      content.style.display = content.style.display === 'none' ? 'block' : 'none';
      header.querySelector('span').textContent = content.style.display === 'none' ? '▼' : '▲';
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
