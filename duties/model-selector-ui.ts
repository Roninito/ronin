/**
 * Model Selector UI Agent
 * 
 * Provides a web dashboard for viewing and selecting AI models.
 */

import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { hankoTheme, kiosaTheme, getSharedUIPrimitivesCSS, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";
import { getKiosaTopbarCSS, getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaHeadHTML } from "../src/utils/kiosa.js";

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
    const accent = getKiosaAccentForPath("/models");
    const accentHex = kiosaTheme.colors.accent;
    return new Response(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Model Selector - Ronin</title>
  ${getKiosaHeadHTML(accent)}
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(kiosaTheme)}
    ${getSharedUIPrimitivesCSS(kiosaTheme, { variant: "kiosa" })}
    ${getKiosaTopbarCSS()}

    body { margin: 0; min-height: 100vh; }

    .page-content {
      max-width: 1060px;
      margin: 0 auto;
      padding: 22px;
    }

    .page-intro {
      margin-bottom: 22px;
      color: ${kiosaTheme.colors.textSecondary};
      font-size: 12px;
      line-height: 1.65;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .models {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }

    .model-card {
      background: ${kiosaTheme.colors.backgroundSecondary};
      border: 1px solid ${kiosaTheme.colors.border};
      border-radius: 3px;
      padding: 12px;
      transition: border-color 150ms ease, background 150ms ease;
      cursor: default;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .model-card:hover {
      border-color: color-mix(in srgb, ${accentHex} 40%, transparent);
      background: color-mix(in srgb, ${accentHex} 6%, transparent);
    }

    .model-card h3 {
      margin: 0 0 6px 0;
      font-family: ${kiosaTheme.fonts.primary};
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: ${kiosaTheme.colors.textPrimary};
    }

    .model-provider {
      font-size: 10px;
      color: ${accentHex};
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 10px;
    }

    .model-description {
      font-size: 11px;
      color: ${kiosaTheme.colors.textSecondary};
      margin-bottom: 10px;
      line-height: 1.6;
    }

    .model-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 12px;
    }

    .tag {
      background: transparent;
      color: ${accentHex};
      padding: 2px 7px;
      border-radius: 2px;
      font-size: 9px;
      font-family: ${kiosaTheme.fonts.mono};
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border: 1px solid color-mix(in srgb, ${accentHex} 40%, transparent);
    }

    .btn {
      width: 100%;
      padding: 8px;
      background: ${kiosaTheme.colors.backgroundTertiary};
      border: 1px solid ${kiosaTheme.colors.border};
      color: ${kiosaTheme.colors.textSecondary};
      border-radius: 2px;
      cursor: pointer;
      font-size: 10px;
      font-family: ${kiosaTheme.fonts.mono};
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }

    .btn:hover:not(:disabled) {
      background: ${accentHex};
      color: ${kiosaTheme.colors.background};
      border-color: ${accentHex};
    }

    .btn:disabled {
      background: color-mix(in srgb, ${accentHex} 15%, transparent);
      border-color: ${accentHex};
      color: ${accentHex};
      opacity: 1;
      cursor: default;
    }

    .action-links {
      display: flex;
      gap: 10px;
      margin-bottom: 22px;
      align-items: center;
    }

    .action-links a {
      color: ${kiosaTheme.colors.textSecondary};
      text-decoration: none;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-family: ${kiosaTheme.fonts.mono};
      border-bottom: 1px solid transparent;
      transition: border-color 150ms ease, color 150ms ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .action-links a:hover {
      color: ${accentHex};
      border-bottom-color: ${accentHex};
    }
  </style>
</head>
<body>
  ${getKiosaTopbarHTML({ title: "RONIN", subtitle: "MODELS / SELECT DEFAULT", accent, chips: [], tabs: [{ label: "SELECT", href: "/models", active: true }, { label: "MANAGE", href: "/models/manage" }] })}

  <div class="page-content">
    <div class="action-links">
      <a href="/models/manage">▶ MANAGE MODELS</a>
    </div>

    <div class="page-intro">
      <p>Select your default AI model for task execution. The default model will be used for all chain operations unless explicitly overridden.</p>
    </div>

    <div class="models" id="models-container">
      <p style="color: ${kiosaTheme.colors.textTertiary}; grid-column: 1/-1; font-family:${kiosaTheme.fonts.mono};font-size:11px;">Loading models...</p>
    </div>
    ${getKiosaFooterHTML("RONIN · MODELS", "MODEL SELECTION · V0.1")}
  </div>

  <script>
    async function loadModels() {
      try {
        const response = await fetch('/models/api/list');
        const data = await response.json();
        if (!data.success && !Array.isArray(data)) {
          document.getElementById('models-container').innerHTML = '<p style="color: ${kiosaTheme.colors.error}; grid-column: 1/-1; font-family:${kiosaTheme.fonts.mono};font-size:11px;">Failed to load models</p>';
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
              \${m.nametag === defaultModel ? 'DEFAULT MODEL' : 'SET AS DEFAULT'}
            </button>
          </div>
        \`).join('');
        document.getElementById('models-container').innerHTML = html;
      } catch (e) {
        document.getElementById('models-container').innerHTML = '<p style="color: ${kiosaTheme.colors.error}; grid-column: 1/-1; font-family:${kiosaTheme.fonts.mono};font-size:11px;">Error: ' + e.message + '</p>';
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
