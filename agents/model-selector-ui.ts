/**
 * Model Selector UI Agent
 * 
 * Provides a web dashboard for viewing and selecting AI models.
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class ModelSelectorUIAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
    console.log("[model-selector-ui] Dashboard available at /models");
  }

  async execute(): Promise<void> {
    // No-op - routes registered in constructor
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/models", this.handleModels.bind(this));
    this.api.http.registerRoute("/models/api/list", this.handleList.bind(this));
    this.api.http.registerRoute("/models/api/default", this.handleDefault.bind(this));
    this.api.http.registerRoute("/models/api/set-default", this.handleSetDefault.bind(this));
  }

  private async handleModels(): Promise<Response> {
    return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>AI Model Selector</title>
  <style>
    body { font-family: system-ui; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .models { display: grid; gap: 20px; }
    .model-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .model-name { font-weight: bold; font-size: 18px; margin-bottom: 8px; }
    button { padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #764ba2; }
    button:disabled { background: #ccc; cursor: not-allowed; }
  </style>
</head>
<body>
  <h1>⚙️  AI Model Selector</h1>
  <p>Select your default AI model</p>
  <div class="models" id="models-container">
    <p>Loading...</p>
  </div>
  <script>
    async function loadModels() {
      try {
        const response = await fetch('/models/api/list');
        const data = await response.json();
        if (!data.success && !Array.isArray(data)) {
          document.getElementById('models-container').innerHTML = '<p>Failed to load models</p>';
          return;
        }
        const models = Array.isArray(data) ? data : data.models || [];
        const defaultResp = await fetch('/models/api/default');
        const defaultData = await defaultResp.json();
        const defaultModel = defaultData.model?.nametag;
        
        const html = models.map(m => \`
          <div class="model-card">
            <div class="model-name">\${m.displayName || m.nametag}</div>
            <p><small>\${m.provider}</small></p>
            <p>\${m.description || 'No description'}</p>
            <button \${m.nametag === defaultModel ? 'disabled' : ''} onclick="setDefault('\${m.nametag}')">
              \${m.nametag === defaultModel ? '✓ Default' : 'Set Default'}
            </button>
          </div>
        \`).join('');
        document.getElementById('models-container').innerHTML = html;
      } catch (e) {
        document.getElementById('models-container').innerHTML = '<p>Error: ' + e.message + '</p>';
      }
    }

    async function setDefault(nametag) {
      try {
        const resp = await fetch('/models/api/set-default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nametag })
        });
        if (resp.ok) {
          location.reload();
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    loadModels();
  </script>
</body>
</html>
    `, { headers: { "Content-Type": "text/html" } });
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

  private async handleDefault(): Promise<Response> {
    try {
      const model = await this.api.plugins.call("model-selector", "getDefaultModel");
      return new Response(JSON.stringify({ model }), {
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
      const body = await req.json();
      const { nametag } = body;
      if (!nametag) throw new Error("nametag required");
      await this.api.plugins.call("model-selector", "setDefaultModel", nametag);
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
