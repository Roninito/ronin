/**
 * Model Selector UI Agent
 * 
 * Provides a web dashboard for viewing and selecting AI models.
 */

import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { hankoTheme, getSharedUIPrimitivesCSS, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

export default class ModelSelectorUIAgent extends BaseDuty {
  constructor(api: DutyAPI) {
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
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Model Selector - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(hankoTheme)}
    ${getSharedUIPrimitivesCSS(hankoTheme, { variant: "hanko" })}
    ${getHeaderBarCSS(hankoTheme)}

    body {
      min-height: 100vh;
      margin: 0;
      padding: 0;
    }

    .page-content {
      max-width: 900px;
      margin: 0 auto;
      padding: ${hankoTheme.spacing.xl};
    }

    .page-intro {
      margin-bottom: ${hankoTheme.spacing.xl};
      color: ${hankoTheme.colors.textSecondary};
      font-size: 0.95rem;
      line-height: 1.6;
    }

    .models {
      display: grid;
      gap: ${hankoTheme.spacing.lg};
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }

    .model-card {
      background: ${hankoTheme.colors.backgroundSecondary};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.lg};
      padding: ${hankoTheme.spacing.lg};
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: default;
    }

    .model-card:hover {
      border-color: ${hankoTheme.colors.borderHover};
      background: ${hankoTheme.colors.backgroundTertiary};
      transform: translateY(-4px);
    }

    .model-card h3 {
      margin: 0 0 ${hankoTheme.spacing.sm} 0;
      font-size: 1.05rem;
      font-weight: 400;
      letter-spacing: -0.01em;
      color: ${hankoTheme.colors.textPrimary};
    }

    .model-provider {
      font-size: 0.75rem;
      color: ${hankoTheme.colors.textTertiary};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: ${hankoTheme.spacing.md};
    }

    .model-description {
      font-size: 0.875rem;
      color: ${hankoTheme.colors.textSecondary};
      margin-bottom: ${hankoTheme.spacing.md};
      line-height: 1.5;
    }

    .model-tags {
      display: flex;
      flex-wrap: wrap;
      gap: ${hankoTheme.spacing.sm};
      margin-bottom: ${hankoTheme.spacing.md};
    }

    .tag {
      background: ${hankoTheme.colors.background};
      color: ${hankoTheme.colors.link};
      padding: 3px 8px;
      border-radius: ${hankoTheme.borderRadius.sm};
      font-size: 0.7rem;
      font-family: ${hankoTheme.fonts.mono};
      letter-spacing: 0.02em;
      border: 1px solid rgba(132, 204, 22, 0.2);
    }

    .btn {
      width: 100%;
      padding: ${hankoTheme.spacing.md};
      background: ${hankoTheme.colors.backgroundTertiary};
      border: 1px solid ${hankoTheme.colors.border};
      color: ${hankoTheme.colors.textSecondary};
      border-radius: ${hankoTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.875rem;
      font-family: ${hankoTheme.fonts.primary};
      font-weight: 400;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: -0.005em;
    }

    .btn:hover:not(:disabled) {
      background: ${hankoTheme.colors.link};
      color: ${hankoTheme.colors.background};
      border-color: ${hankoTheme.colors.link};
      transform: translateY(-2px);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .action-links {
      display: flex;
      gap: ${hankoTheme.spacing.md};
      margin-bottom: ${hankoTheme.spacing.xl};
      align-items: center;
    }

    .action-links a {
      color: ${hankoTheme.colors.link};
      text-decoration: none;
      font-size: 0.875rem;
      transition: color 0.2s;
      display: flex;
      align-items: center;
      gap: ${hankoTheme.spacing.sm};
    }

    .action-links a:hover {
      color: ${hankoTheme.colors.linkHover};
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>AI Model Selector</h1>
  </div>

  <div class="page-content">
    <div class="action-links">
      <a href="/models/manage">⚙️ Manage Models</a>
    </div>

    <div class="page-intro">
      <p>Select your default AI model for task execution. The default model will be used for all chain operations unless explicitly overridden.</p>
    </div>

    <div class="models" id="models-container">
      <p style="color: ${hankoTheme.colors.textTertiary}; grid-column: 1/-1;">Loading models...</p>
    </div>
  </div>

  <script>
    async function loadModels() {
      try {
        const response = await fetch('/models/api/list');
        const data = await response.json();
        if (!data.success && !Array.isArray(data)) {
          document.getElementById('models-container').innerHTML = '<p style="color: ${hankoTheme.colors.error}; grid-column: 1/-1;">Failed to load models</p>';
          return;
        }
        const models = Array.isArray(data) ? data : data.models || [];
        const defaultResp = await fetch('/models/api/default');
        const defaultData = await defaultResp.json();
        const defaultModel = defaultData.model?.nametag;
        
        const html = models.map(m => \`
          <div class="model-card">
            <h3>\${m.displayName || m.nametag}</h3>
            <div class="model-provider">\${m.provider}</div>
            <p class="model-description">\${m.description || 'No description available'}</p>
            \${m.tags && m.tags.length > 0 ? \`
              <div class="model-tags">
                \${m.tags.map(tag => \`<span class="tag">\${tag}</span>\`).join('')}
              </div>
            \` : ''}
            <button class="btn" \${m.nametag === defaultModel ? 'disabled' : ''} onclick="setDefault('\${m.nametag}')">
              \${m.nametag === defaultModel ? '✓ Default Model' : 'Set as Default'}
            </button>
          </div>
        \`).join('');
        document.getElementById('models-container').innerHTML = html;
      } catch (e) {
        document.getElementById('models-container').innerHTML = '<p style="color: ${hankoTheme.colors.error}; grid-column: 1/-1;">Error: ' + e.message + '</p>';
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
