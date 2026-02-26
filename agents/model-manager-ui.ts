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
    this.api.http.registerRoute("/models/api/managers/setdefault", this.handleSetDefault.bind(this));
    this.api.http.registerRoute("/models/api/managers/test", this.handleTestModel.bind(this));
    // Provider management endpoints
    this.api.http.registerRoute("/models/api/managers/provider/add", this.handleAddProvider.bind(this));
    this.api.http.registerRoute("/models/api/managers/provider/update", this.handleUpdateProvider.bind(this));
    this.api.http.registerRoute("/models/api/managers/provider/remove", this.handleRemoveProvider.bind(this));
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

    .tabs {
      display: flex;
      gap: ${roninTheme.spacing.md};
      margin-bottom: ${roninTheme.spacing.lg};
      border-bottom: 1px solid ${roninTheme.colors.border};
      padding-bottom: ${roninTheme.spacing.md};
    }

    .tab-button {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: none;
      border: none;
      color: ${roninTheme.colors.textSecondary};
      cursor: pointer;
      font-size: 0.9rem;
      font-family: ${roninTheme.fonts.primary};
      transition: all 0.2s;
      border-bottom: 2px solid transparent;
      margin-bottom: -${roninTheme.spacing.md};
    }

    .tab-button.active {
      color: ${roninTheme.colors.link};
      border-bottom-color: ${roninTheme.colors.link};
    }

    .tab-button:hover {
      color: ${roninTheme.colors.textPrimary};
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .provider-list {
      display: grid;
      gap: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .provider-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: ${roninTheme.spacing.lg};
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .provider-card:hover {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.backgroundTertiary};
    }

    .provider-card h3 {
      margin: 0 0 ${roninTheme.spacing.md} 0;
      font-size: 1.05rem;
      font-weight: 400;
      color: ${roninTheme.colors.textPrimary};
    }

    .provider-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: ${roninTheme.spacing.md};
      margin-bottom: ${roninTheme.spacing.md};
      font-size: 0.8125rem;
    }

    .provider-info-item {
      display: flex;
      flex-direction: column;
    }

    .provider-info-item label {
      color: ${roninTheme.colors.textTertiary};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 0.75rem;
      margin-bottom: ${roninTheme.spacing.xs};
    }

    .provider-info-item span {
      color: ${roninTheme.colors.textSecondary};
      font-family: ${roninTheme.fonts.mono};
      word-break: break-all;
    }

    .provider-actions {
      display: flex;
      gap: ${roninTheme.spacing.md};
    }

    .add-button {
      padding: ${roninTheme.spacing.md} ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.backgroundTertiary};
      border: 1px solid ${roninTheme.colors.link};
      color: ${roninTheme.colors.link};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.875rem;
      font-family: ${roninTheme.fonts.primary};
      font-weight: 400;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .add-button:hover {
      background: ${roninTheme.colors.link};
      color: ${roninTheme.colors.background};
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
    <div class="tabs">
      <button class="tab-button active" onclick="switchTab('models')">Models</button>
      <button class="tab-button" onclick="switchTab('providers')">Providers</button>
    </div>

    <div id="models-tab" class="tab-content active">
      <div id="providers-container">
        <p class="loading">Loading models...</p>
      </div>
    </div>

    <div id="providers-tab" class="tab-content">
      <button class="add-button" onclick="openAddProviderModal()">+ Add Provider</button>
      <div id="providers-list" class="provider-list">
        <p class="loading">Loading providers...</p>
      </div>
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

  <div id="provider-modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="provider-modal-title">Add Provider</h3>
        <button class="modal-close" onclick="closeProviderModal()">&times;</button>
      </div>
      <form id="provider-form">
        <div class="form-group">
          <label>Provider Name (ID)</label>
          <input type="text" id="provider-name" placeholder="e.g., anthropic, openai" disabled="" style="opacity: 0.6;">
        </div>
        <div class="form-group">
          <label>Provider Type</label>
          <select id="provider-type" style="width: 100%; padding: ${roninTheme.spacing.md}; background: ${roninTheme.colors.backgroundTertiary}; border: 1px solid ${roninTheme.colors.border}; color: ${roninTheme.colors.textPrimary}; border-radius: ${roninTheme.borderRadius.md}; font-family: ${roninTheme.fonts.primary};">
            <option value="">Select type...</option>
            <option value="remote">Remote API</option>
            <option value="local">Local Service</option>
          </select>
        </div>
        <div class="form-group">
          <label>Base URL</label>
          <input type="text" id="provider-baseUrl" placeholder="https://api.example.com/v1">
        </div>
        <div class="form-group">
          <label>API Key Environment Variable</label>
          <input type="text" id="provider-apiKeyEnv" placeholder="e.g., ANTHROPIC_API_KEY">
        </div>
        <div class="form-group">
          <label>Description</label>
          <input type="text" id="provider-description" placeholder="e.g., Anthropic Claude API">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" onclick="closeProviderModal()">Cancel</button>
          <button type="button" class="btn" style="background: ${roninTheme.colors.link}; color: ${roninTheme.colors.background}; border-color: ${roninTheme.colors.link};" onclick="saveProvider()">Add Provider</button>
        </div>
      </form>
    </div>
  </div>

  <div id="edit-provider-modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Edit Provider Settings</h3>
        <button class="modal-close" onclick="closeEditProviderModal()">&times;</button>
      </div>
      <form id="edit-provider-form">
        <div class="form-group">
          <label>Base URL</label>
          <input type="text" id="edit-provider-baseUrl" placeholder="https://api.example.com/v1">
        </div>
        <div class="form-group">
          <label>API Key Environment Variable</label>
          <input type="text" id="edit-provider-apiKeyEnv" placeholder="e.g., ANTHROPIC_API_KEY">
        </div>
        <div class="form-group">
          <label>Description</label>
          <input type="text" id="edit-provider-description" placeholder="Provider description">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" onclick="closeEditProviderModal()">Cancel</button>
          <button type="button" class="btn" style="background: ${roninTheme.colors.link}; color: ${roninTheme.colors.background}; border-color: ${roninTheme.colors.link};" onclick="saveEditProvider()">Save Changes</button>
        </div>
      </form>
    </div>
  </div>

  <div id="add-model-modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="add-model-title">Add Model to Provider</h3>
        <button class="modal-close" onclick="closeAddModelModal()">&times;</button>
      </div>
      <form id="add-model-form">
        <div class="form-group">
          <label>Model Name (Display)</label>
          <input type="text" id="add-model-displayName" placeholder="e.g., My Custom Model" required>
        </div>
        <div class="form-group">
          <label>Model ID (Nametag)</label>
          <input type="text" id="add-model-nametag" placeholder="e.g., my-custom-model" required>
        </div>
        <div class="form-group">
          <label>Description</label>
          <input type="text" id="add-model-description" placeholder="Model description">
        </div>
        <div class="form-group">
          <label>Max Tokens Per Request</label>
          <input type="number" id="add-model-maxTokens" min="1024" max="128000" value="4096" required>
        </div>
        <div class="form-group">
          <label>Temperature (0-2)</label>
          <input type="number" id="add-model-temperature" min="0" max="2" step="0.1" value="0.7" required>
        </div>
        <div class="form-group">
          <label>Cost Per Million Input Tokens</label>
          <input type="number" id="add-model-costPerMTok" min="0" step="0.01" value="0">
        </div>
        <div class="form-group">
          <label>Cost Per Million Output Tokens</label>
          <input type="number" id="add-model-costPerOTok" min="0" step="0.01" value="0">
        </div>
        <div class="form-group">
          <label>Max Daily Spend (\$)</label>
          <input type="number" id="add-model-maxDailySpend" min="0" step="1" value="0">
        </div>
        <div class="form-group">
          <label>Max Monthly Spend (\$)</label>
          <input type="number" id="add-model-maxMonthlySpend" min="0" step="1" value="0">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" onclick="closeAddModelModal()">Cancel</button>
          <button type="button" class="btn" style="background: ${roninTheme.colors.link}; color: ${roninTheme.colors.background}; border-color: ${roninTheme.colors.link};" onclick="saveNewModel()">Add Model</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    console.log('[Models Manager] Script loaded');
    let editingModel = null;
    let editingProvider = null;

    async function loadProviders() {
      console.log('[loadProviders] Starting...');
      try {
        console.log('[loadProviders] Fetching models...');
        const modelsResp = await fetch('/models/api/managers/list');
        if (!modelsResp.ok) {
          throw new Error('Failed to load models: ' + modelsResp.status);
        }
        const models = await modelsResp.json();
        console.log('[loadProviders] Got models:', models.length);
        console.log('[loadProviders] Models:', models);
        
        console.log('[loadProviders] Fetching providers...');
        const providersResp = await fetch('/models/api/managers/providers');
        if (!providersResp.ok) {
          throw new Error('Failed to load providers: ' + providersResp.status);
        }
        const providers = await providersResp.json();
        console.log('[loadProviders] Got providers:', Object.keys(providers).length);
        console.log('[loadProviders] Providers:', providers);

        const container = document.getElementById('providers-container');
        if (!container) {
          throw new Error('Container element not found');
        }
        console.log('[loadProviders] Container found, clearing...');
        container.innerHTML = '';

        console.log('[loadProviders] Creating sections for', Object.keys(providers).length, 'providers');
        for (const [providerKey, provider] of Object.entries(providers)) {
          console.log('[loadProviders] Processing provider:', providerKey);
          const providerModels = models.filter(m => m.provider === providerKey);
          console.log('[loadProviders] Found', providerModels.length, 'models for', providerKey);
          
          const section = document.createElement('div');
          section.className = 'provider-section';
          
          const headerDiv = document.createElement('div');
          headerDiv.className = 'provider-header';
          headerDiv.onclick = () => toggleProvider(headerDiv);
          
          const titleDiv = document.createElement('div');
          const h2 = document.createElement('h2');
          h2.textContent = providerKey.charAt(0).toUpperCase() + providerKey.slice(1);
          titleDiv.appendChild(h2);
          const info = document.createElement('div');
          info.className = 'info';
          info.textContent = providerModels.length + ' model(s) • ' + provider.type;
          titleDiv.appendChild(info);
          
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
              
              const headerDiv = document.createElement('div');
              headerDiv.className = 'model-header';
              
              const infoDiv = document.createElement('div');
              infoDiv.className = 'model-info';
              const h3 = document.createElement('h3');
              h3.textContent = m.displayName || m.nametag;
              const tag = document.createElement('span');
              tag.className = 'model-nametag';
              tag.textContent = m.nametag;
              infoDiv.appendChild(h3);
              infoDiv.appendChild(tag);
              
              const actionsDiv = document.createElement('div');
              actionsDiv.className = 'model-actions';
              
              const testBtn = document.createElement('button');
              testBtn.className = 'btn';
              testBtn.textContent = '🧪 Test';
              testBtn.title = 'Test model connectivity';
              testBtn.onclick = (e) => testModel(m.nametag, e);
              actionsDiv.appendChild(testBtn);
              
              const defaultBtn = document.createElement('button');
              defaultBtn.className = 'btn';
              defaultBtn.textContent = m.isDefault ? '⭐ Default' : '☆ Set Default';
              defaultBtn.title = 'Set as default model';
              defaultBtn.onclick = () => setAsDefault(m.nametag);
              actionsDiv.appendChild(defaultBtn);
              
              const editBtn = document.createElement('button');
              editBtn.className = 'btn';
              editBtn.textContent = '⚙️ Edit';
              editBtn.onclick = () => editModel(m.nametag);
              actionsDiv.appendChild(editBtn);
              
              const removeBtn = document.createElement('button');
              removeBtn.className = 'btn btn-danger';
              removeBtn.textContent = '🗑️ Remove';
              removeBtn.onclick = () => removeModel(m.nametag);
              actionsDiv.appendChild(removeBtn);
              
              headerDiv.appendChild(infoDiv);
              headerDiv.appendChild(actionsDiv);
              card.appendChild(headerDiv);
              
              const settingsDiv = document.createElement('div');
              settingsDiv.className = 'settings';
              
              const tokenSetting = document.createElement('div');
              tokenSetting.className = 'setting';
              tokenSetting.innerHTML = '<label>Max Tokens</label><span>' + m.limits.maxTokensPerRequest.toLocaleString() + '</span>';
              settingsDiv.appendChild(tokenSetting);
              
              const tempSetting = document.createElement('div');
              tempSetting.className = 'setting';
              tempSetting.innerHTML = '<label>Temperature</label><span>' + (m.config.temperature || 0.7).toFixed(1) + '</span>';
              settingsDiv.appendChild(tempSetting);
              
              const dailySetting = document.createElement('div');
              dailySetting.className = 'setting';
              dailySetting.innerHTML = '<label>Daily Budget</label><span>$' + m.limits.maxDailySpend.toFixed(2) + '</span>';
              settingsDiv.appendChild(dailySetting);
              
              const monthlySetting = document.createElement('div');
              monthlySetting.className = 'setting';
              monthlySetting.innerHTML = '<label>Monthly Budget</label><span>$' + m.limits.maxMonthlySpend.toFixed(2) + '</span>';
              settingsDiv.appendChild(monthlySetting);
              
              card.appendChild(settingsDiv);
              modelsList.appendChild(card);
            }
            contentDiv.appendChild(modelsList);
          }
          
          // Add model button
          const addButton = document.createElement('button');
          addButton.className = 'add-button';
          addButton.textContent = '+ Add Model';
          addButton.onclick = () => openAddModelModal(providerKey);
          contentDiv.appendChild(addButton);
          
          section.appendChild(headerDiv);
          section.appendChild(contentDiv);
          container.appendChild(section);
        }
      } catch (e) {
        console.error('[loadProviders] Error:', e.message, e.stack);
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

    async function setAsDefault(nametag) {
      try {
        const response = await fetch('/models/api/managers/setdefault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nametag })
        });

        if (response.ok) {
          loadProviders();
        } else {
          const error = await response.text();
          alert('Error setting default model: ' + error);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function testModel(nametag, evt) {
      const button = evt ? evt.target : event.target;
      button.disabled = true;
      button.textContent = '⏳ Testing...';
      
      try {
        const response = await fetch('/models/api/managers/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nametag })
        });

        const result = await response.json();
        
        if (response.ok && result.success) {
          alert('✅ Model test successful!\\n\\nResponse: ' + (result.response || 'OK'));
          button.textContent = '✅ Working';
          setTimeout(() => { button.textContent = '🧪 Test'; button.disabled = false; }, 2000);
        } else {
          alert('❌ Model test failed:\\n\\n' + (result.error || 'Unknown error'));
          button.textContent = '❌ Failed';
          setTimeout(() => { button.textContent = '🧪 Test'; button.disabled = false; }, 2000);
        }
      } catch (e) {
        alert('❌ Error testing model:\\n\\n' + e.message);
        button.textContent = '❌ Error';
        setTimeout(() => { button.textContent = '🧪 Test'; button.disabled = false; }, 2000);
      }
    }

    function closeModal() {
      document.getElementById('edit-modal').classList.remove('show');
    }

    // Provider management functions
    async function loadProvidersTab() {
      console.log('[loadProvidersTab] Starting...');
      try {
        console.log('[loadProvidersTab] Fetching providers...');
        const providersResp = await fetch('/models/api/managers/providers');
        if (!providersResp.ok) {
          throw new Error('Failed to load providers: ' + providersResp.status);
        }
        const providers = await providersResp.json();
        console.log('[loadProvidersTab] Got providers:', Object.keys(providers).length);
        
        const container = document.getElementById('providers-list');
        if (!container) {
          throw new Error('Container element not found');
        }
        container.innerHTML = '';

        for (const [providerKey, provider] of Object.entries(providers)) {
          const card = document.createElement('div');
          card.className = 'provider-card';
          
          const h3 = document.createElement('h3');
          h3.textContent = providerKey;
          card.appendChild(h3);
          
          const infoDiv = document.createElement('div');
          infoDiv.className = 'provider-info';
          
          const typeItem = document.createElement('div');
          typeItem.className = 'provider-info-item';
          typeItem.innerHTML = '<label>Type</label><span>' + (provider.type || 'N/A') + '</span>';
          infoDiv.appendChild(typeItem);
          
          const baseUrlItem = document.createElement('div');
          baseUrlItem.className = 'provider-info-item';
          baseUrlItem.innerHTML = '<label>Base URL</label><span>' + (provider.baseUrl || 'N/A') + '</span>';
          infoDiv.appendChild(baseUrlItem);
          
          const keyEnvItem = document.createElement('div');
          keyEnvItem.className = 'provider-info-item';
          keyEnvItem.innerHTML = '<label>API Key Env</label><span>' + (provider.apiKeyEnv || 'N/A') + '</span>';
          infoDiv.appendChild(keyEnvItem);
          
          const descItem = document.createElement('div');
          descItem.className = 'provider-info-item';
          descItem.innerHTML = '<label>Description</label><span>' + (provider.description || 'N/A') + '</span>';
          infoDiv.appendChild(descItem);
          
          card.appendChild(infoDiv);
          
          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'provider-actions';
          
          const editBtn = document.createElement('button');
          editBtn.className = 'btn';
          editBtn.textContent = '⚙️ Edit';
          editBtn.onclick = () => openEditProviderModal(providerKey);
          actionsDiv.appendChild(editBtn);
          
          const removeBtn = document.createElement('button');
          removeBtn.className = 'btn btn-danger';
          removeBtn.textContent = '🗑️ Remove';
          removeBtn.onclick = () => removeProvider(providerKey);
          actionsDiv.appendChild(removeBtn);
          
          card.appendChild(actionsDiv);
          container.appendChild(card);
        }
      } catch (e) {
        console.error('[loadProvidersTab] Error:', e.message);
        document.getElementById('providers-list').innerHTML = '<p class="loading">Error: ' + e.message + '</p>';
      }
    }

    function switchTab(tabName) {
      // Hide all tabs
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
      });
      document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
      });

      // Show selected tab
      document.getElementById(tabName + '-tab').classList.add('active');
      event.target.classList.add('active');

      // Load data if switching to providers tab
      if (tabName === 'providers') {
        loadProvidersTab();
      }
    }

    function openAddProviderModal() {
      document.getElementById('provider-name').value = '';
      document.getElementById('provider-name').disabled = false;
      document.getElementById('provider-name').style.opacity = '1';
      document.getElementById('provider-type').value = '';
      document.getElementById('provider-baseUrl').value = '';
      document.getElementById('provider-apiKeyEnv').value = '';
      document.getElementById('provider-description').value = '';
      document.getElementById('provider-modal-title').textContent = 'Add Provider';
      editingProvider = null;
      document.getElementById('provider-modal').classList.add('show');
    }

    function closeProviderModal() {
      document.getElementById('provider-modal').classList.remove('show');
    }

    async function saveProvider() {
      try {
        const name = document.getElementById('provider-name').value.trim();
        const type = document.getElementById('provider-type').value;
        
        if (!name || !type) {
          alert('Provider name and type are required');
          return;
        }

        const updates = {
          name,
          type,
          baseUrl: document.getElementById('provider-baseUrl').value,
          apiKeyEnv: document.getElementById('provider-apiKeyEnv').value,
          description: document.getElementById('provider-description').value,
        };

        const response = await fetch('/models/api/managers/provider/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });

        if (response.ok) {
          closeProviderModal();
          loadProvidersTab();
        } else {
          const error = await response.json();
          alert('Error: ' + error.error);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    function openEditProviderModal(providerName) {
      editingProvider = providerName;
      fetch('/models/api/managers/providers')
        .then(r => r.json())
        .then(providers => {
          const provider = providers[providerName];
          document.getElementById('edit-provider-baseUrl').value = provider.baseUrl || '';
          document.getElementById('edit-provider-apiKeyEnv').value = provider.apiKeyEnv || '';
          document.getElementById('edit-provider-description').value = provider.description || '';
          document.getElementById('edit-provider-modal').classList.add('show');
        });
    }

    function closeEditProviderModal() {
      document.getElementById('edit-provider-modal').classList.remove('show');
    }

    async function saveEditProvider() {
      try {
        const updates = {
          baseUrl: document.getElementById('edit-provider-baseUrl').value,
          apiKeyEnv: document.getElementById('edit-provider-apiKeyEnv').value,
          description: document.getElementById('edit-provider-description').value,
        };

        const response = await fetch('/models/api/managers/provider/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editingProvider, updates })
        });

        if (response.ok) {
          closeEditProviderModal();
          loadProvidersTab();
        } else {
          const error = await response.json();
          alert('Error: ' + error.error);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function removeProvider(providerName) {
      if (!confirm('Remove provider: ' + providerName + '?\\n\\nThis provider must have no models.')) return;
      
      try {
        const response = await fetch('/models/api/managers/provider/remove?name=' + encodeURIComponent(providerName), {
          method: 'DELETE'
        });

        if (response.ok) {
          loadProvidersTab();
        } else {
          const error = await response.json();
          alert('Error: ' + error.error);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    // Model addition functions
    let addingToProvider = null;

    function openAddModelModal(providerName) {
      addingToProvider = providerName;
      document.getElementById('add-model-title').textContent = 'Add Model to ' + providerName;
      document.getElementById('add-model-displayName').value = '';
      document.getElementById('add-model-nametag').value = '';
      document.getElementById('add-model-description').value = '';
      document.getElementById('add-model-maxTokens').value = '4096';
      document.getElementById('add-model-temperature').value = '0.7';
      document.getElementById('add-model-costPerMTok').value = '0';
      document.getElementById('add-model-costPerOTok').value = '0';
      document.getElementById('add-model-maxDailySpend').value = '0';
      document.getElementById('add-model-maxMonthlySpend').value = '0';
      document.getElementById('add-model-modal').classList.add('show');
    }

    function closeAddModelModal() {
      document.getElementById('add-model-modal').classList.remove('show');
    }

    async function saveNewModel() {
      try {
        const nametag = document.getElementById('add-model-nametag').value.trim();
        const displayName = document.getElementById('add-model-displayName').value.trim();
        
        if (!nametag || !displayName) {
          alert('Model name and ID are required');
          return;
        }

        const modelConfig = {
          provider: addingToProvider,
          modelId: nametag,
          nametag,
          displayName,
          description: document.getElementById('add-model-description').value,
          tags: [],
          isDefault: false,
          limits: {
            costPerMTok: parseFloat(document.getElementById('add-model-costPerMTok').value) || 0,
            costPerOTok: parseFloat(document.getElementById('add-model-costPerOTok').value) || 0,
            maxDailySpend: parseFloat(document.getElementById('add-model-maxDailySpend').value) || 0,
            maxMonthlySpend: parseFloat(document.getElementById('add-model-maxMonthlySpend').value) || 0,
            maxConcurrent: 5,
            maxTokensPerRequest: parseInt(document.getElementById('add-model-maxTokens').value),
            rateLimit: {
              requestsPerMinute: 60,
              tokensPerMinute: 100000
            }
          },
          config: {
            temperature: parseFloat(document.getElementById('add-model-temperature').value),
            topP: 0.9
          }
        };

        const response = await fetch('/models/api/managers/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nametag, config: modelConfig })
        });

        if (response.ok) {
          closeAddModelModal();
          loadProviders();
        } else {
          const error = await response.json();
          alert('Error: ' + error.error);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
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

  private async handleAddProvider(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { name, type, baseUrl, apiKeyEnv, description } = body;

      if (!name || !type) {
        throw new Error("name and type required");
      }

      const registry = await this.api.plugins.call("model-selector", "loadRegistry");
      registry.providers[name] = {
        type,
        baseUrl: baseUrl || "",
        apiKeyEnv: apiKeyEnv || "",
        description: description || "",
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
        },
      };

      await this.api.plugins.call("model-selector", "saveRegistry", registry);
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

  private async handleUpdateProvider(req: Request): Promise<Response> {
    try {
      const body = await req.json();
      const { name, updates } = body;

      if (!name || !updates) {
        throw new Error("name and updates required");
      }

      const registry = await this.api.plugins.call("model-selector", "loadRegistry");
      if (!registry.providers[name]) {
        throw new Error(`Provider ${name} not found`);
      }

      registry.providers[name] = {
        ...registry.providers[name],
        ...updates,
      };

      await this.api.plugins.call("model-selector", "saveRegistry", registry);
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

  private async handleRemoveProvider(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const name = url.searchParams.get("name");

      if (!name) {
        throw new Error("name required");
      }

      const registry = await this.api.plugins.call("model-selector", "loadRegistry");
      
      // Check if any models use this provider
      const modelsUsingProvider = Object.values(registry.models).filter(
        (m: any) => m.provider === name
      );
      
      if (modelsUsingProvider.length > 0) {
        throw new Error(`Cannot remove provider with ${modelsUsingProvider.length} model(s)`);
      }

      delete registry.providers[name];
      await this.api.plugins.call("model-selector", "saveRegistry", registry);
      
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

  private async handleSetDefault(req: Request): Promise<Response> {
    try {
      const body = await req.json() as { nametag: string };
      const { nametag } = body;

      if (!nametag) {
        throw new Error("nametag required");
      }

      const registry = await this.api.plugins.call("model-selector", "loadRegistry");
      if (!registry.models[nametag]) {
        throw new Error(`Model ${nametag} not found`);
      }

      registry.default = nametag;
      await this.api.plugins.call("model-selector", "saveRegistry", registry);

      return new Response(JSON.stringify({ success: true, default: nametag }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleTestModel(req: Request): Promise<Response> {
    try {
      const body = await req.json() as { nametag: string };
      const { nametag } = body;

      if (!nametag) {
        throw new Error("nametag required");
      }

      const model = await this.api.plugins.call("model-selector", "getModel", nametag);
      if (!model) {
        throw new Error(`Model ${nametag} not found`);
      }

      // Try to call the model with a simple test prompt
      const testPrompt = "Say 'Hello, Ronin!' and nothing else.";
      
      try {
        // Use the model-selector plugin to get the provider and model details
        const registry = await this.api.plugins.call("model-selector", "loadRegistry");
        const provider = registry.providers[model.provider];

        if (!provider) {
          throw new Error(`Provider ${model.provider} not configured`);
        }

        // Check if we have API key for remote providers
        if (provider.type === "remote" && provider.apiKeyEnv) {
          const apiKey = process.env[provider.apiKeyEnv];
          if (!apiKey) {
            throw new Error(`API key not set for environment variable: ${provider.apiKeyEnv}. Please set this environment variable and restart Ronin.`);
          }
        }

        // Make a simple test call
        let response: Response;
        
        if (provider.type === "local") {
          // For local models (Ollama, LM Studio), use the local API
          response = await fetch(`${provider.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: model.modelId,
              prompt: testPrompt,
              stream: false,
            }),
          });
        } else {
          // For remote models, use OpenAI-compatible API
          const apiKey = process.env[provider.apiKeyEnv!];
          response = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: model.modelId,
              messages: [{ role: "user", content: testPrompt }],
              max_tokens: 50,
            }),
          });
        }

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API returned ${response.status}: ${error}`);
        }

        const result = await response.json();
        let testResponse = "";

        if (provider.type === "local" && result.response) {
          testResponse = result.response;
        } else if (result.choices?.[0]?.message?.content) {
          testResponse = result.choices[0].message.content;
        } else {
          testResponse = "Model responded but format was unexpected";
        }

        return new Response(
          JSON.stringify({
            success: true,
            response: testResponse.slice(0, 200),
            provider: model.provider,
            model: model.modelId,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (testError) {
        throw new Error(`Failed to test model: ${testError instanceof Error ? testError.message : String(testError)}`);
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: String(e), success: false }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
}
