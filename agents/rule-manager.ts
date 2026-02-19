import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

/**
 * Rule Manager Agent
 * 
 * Provides a web-based editor for managing the Ronin security rulebook.
 * Creates a route at /rules for viewing and editing rulebook.md
 */
export default class RuleManagerAgent extends BaseAgent {
  static webhook = "/rules";
  
  private rulebookPath: string;
  private defaultRulebookPath: string;

  constructor(api: AgentAPI) {
    super(api);
    
    // Rulebook locations
    this.rulebookPath = join(homedir(), ".ronin", "rulebook.md");
    this.defaultRulebookPath = join(homedir(), ".ronin", "rulebook.md");
    
    console.log("[rule-manager] Rule Manager Agent initialized");
    console.log(`[rule-manager] Rulebook path: ${this.rulebookPath}`);
    
    // Register routes
    this.registerRoutes();

    // Analytics: report lifecycle
    this.api.events.emit("agent.lifecycle", {
      agent: "rule-manager", status: "started", timestamp: Date.now(),
    }, "rule-manager");
  }

  /**
   * Register HTTP routes for the rule editor
   */
  private registerRoutes(): void {
    // Main rules page - GET /rules
    this.api.http.registerRoute("/rules", async (req: Request) => {
      if (req.method === "GET") {
        return this.renderRulesPage();
      }
      
      if (req.method === "POST") {
        return this.handleSaveRules(req);
      }
      
      return new Response("Method not allowed", { status: 405 });
    });

    // API endpoint for rules - GET/POST /api/rules
    this.api.http.registerRoute("/api/rules", async (req: Request) => {
      if (req.method === "GET") {
        return this.handleGetRules();
      }
      
      if (req.method === "POST") {
        return this.handleUpdateRules(req);
      }
      
      return new Response("Method not allowed", { status: 405 });
    });

    // Reset rules to default - POST /api/rules/reset
    this.api.http.registerRoute("/api/rules/reset", async (req: Request) => {
      if (req.method === "POST") {
        return this.handleResetRules();
      }
      
      return new Response("Method not allowed", { status: 405 });
    });

    console.log("[rule-manager] Routes registered: /rules, /api/rules, /api/rules/reset");
  }

  /**
   * Read the current rulebook content
   */
  private async readRulebook(): Promise<string> {
    try {
      // Check if custom rulebook exists
      try {
        await access(this.rulebookPath);
        const content = await readFile(this.rulebookPath, "utf-8");
        return content;
      } catch {
        // Fall back to default
        try {
          await access(this.defaultRulebookPath);
          const content = await readFile(this.defaultRulebookPath, "utf-8");
          return content;
        } catch {
          return this.getDefaultRules();
        }
      }
    } catch (error) {
      console.error("[rule-manager] Error reading rulebook:", error);
      return this.getDefaultRules();
    }
  }

  /**
   * Get default rules content
   */
  private getDefaultRules(): string {
    return `# Ronin Security Rulebook

## Core Security Principles

### 1. Authentication & Authorization
- **NEVER** process commands from unauthorized users
- Each communication platform has its own authorized user list
- Users are identified by their platform-specific IDs (not usernames)

### 2. Communication Platform Authorization
- Telegram: Check msg.from.id against telegramAuthUserAccounts
- Discord: Check message.author.id against discordAuthUserAccounts
- WhatsApp: Check phone number against whatsappAuthUserAccounts
- iMessage: Check handle against imessageAuthUserAccounts

### 3. Command Authorization
#### Always Reject
- Commands from unauthorized users
- Commands containing password/API key patterns
- Commands attempting to extract credentials

### 4. Response Security
- NEVER include API keys, passwords, tokens in responses
- Use generic messages for auth failures
- No hints about why access was denied

### 5. AI Context Security
- Security rules injected into ALL AI communications
- NEVER generate code that outputs credentials

---
*Edit this file to customize security rules for your Ronin instance*
`;
  }

  /**
   * Save rules to the rulebook
   */
  private async saveRules(content: string): Promise<void> {
    try {
      await writeFile(this.rulebookPath, content, "utf-8");
      console.log("[rule-manager] Rules saved successfully");
    } catch (error) {
      console.error("[rule-manager] Error saving rules:", error);
      throw error;
    }
  }

  /**
   * Handle GET /api/rules
   */
  private async handleGetRules(): Promise<Response> {
    try {
      const content = await this.readRulebook();
      return Response.json({ 
        success: true, 
        content,
        path: this.rulebookPath
      });
    } catch (error) {
      console.error("[rule-manager] Error getting rules:", error);
      return Response.json({
        success: false,
        error: "Failed to read rules"
      }, { status: 500 });
    }
  }

  /**
   * Handle POST /api/rules
   */
  private async handleUpdateRules(req: Request): Promise<Response> {
    const taskId = crypto.randomUUID();
    const taskStart = Date.now();
    this.api.events.emit("agent.task.started", {
      agent: "rule-manager", taskId, taskName: "save-rules", timestamp: taskStart,
    }, "rule-manager");

    try {
      const body = await req.json();
      const { content } = body;
      
      if (!content || typeof content !== "string") {
        return Response.json({
          success: false,
          error: "Invalid content provided"
        }, { status: 400 });
      }
      
      await this.saveRules(content);

      // Analytics: task completed
      this.api.events.emit("agent.task.completed", {
        agent: "rule-manager", taskId, duration: Date.now() - taskStart, timestamp: Date.now(),
      }, "rule-manager");
      
      return Response.json({
        success: true,
        message: "Rules updated successfully"
      });
    } catch (error) {
      // Analytics: task failed (failureNotes/request for SkillMaker)
      this.api.events.emit("agent.task.failed", {
        agent: "rule-manager", taskId, duration: Date.now() - taskStart,
        error: (error as Error).message, timestamp: Date.now(),
        failureNotes: (error as Error).message,
        request: "save-rules",
        description: "Update rules content",
      }, "rule-manager");
      console.error("[rule-manager] Error updating rules:", error);
      return Response.json({
        success: false,
        error: "Failed to update rules"
      }, { status: 500 });
    }
  }

  /**
   * Handle POST /api/rules/reset
   */
  private async handleResetRules(): Promise<Response> {
    try {
      const defaultContent = this.getDefaultRules();
      await this.saveRules(defaultContent);
      
      return Response.json({
        success: true,
        message: "Rules reset to defaults",
        content: defaultContent
      });
    } catch (error) {
      console.error("[rule-manager] Error resetting rules:", error);
      return Response.json({
        success: false,
        error: "Failed to reset rules"
      }, { status: 500 });
    }
  }

  /**
   * Handle POST /rules (form submission)
   */
  private async handleSaveRules(req: Request): Promise<Response> {
    try {
      const formData = await req.formData();
      const content = formData.get("content") as string;
      
      if (!content) {
        return new Response("Content is required", { status: 400 });
      }
      
      await this.saveRules(content);
      
      // Redirect back to the rules page with success message
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/rules?saved=true"
        }
      });
    } catch (error) {
      console.error("[rule-manager] Error saving rules:", error);
      return new Response("Failed to save rules", { status: 500 });
    }
  }

  /**
   * Render the rules editor page
   */
  private async renderRulesPage(): Promise<Response> {
    try {
      const content = await this.readRulebook();
      
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Security Rules</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

    body {
      padding: 0;
      margin: 0;
      font-size: 0.8125rem;
    }

    .page-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.xl};
    }

    .toolbar {
      display: flex;
      gap: ${roninTheme.spacing.sm};
      margin-bottom: ${roninTheme.spacing.lg};
      padding: ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
    }

    .btn-primary {
      background: ${roninTheme.colors.accent};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
    }
    .btn-primary:hover { background: ${roninTheme.colors.accentHover}; border-color: ${roninTheme.colors.borderHover}; }

    .btn-secondary {
      background: ${roninTheme.colors.backgroundTertiary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
    }
    .btn-secondary:hover { background: ${roninTheme.colors.accent}; color: ${roninTheme.colors.textPrimary}; }

    .btn-danger {
      background: ${roninTheme.colors.error}30;
      border: 1px solid ${roninTheme.colors.error};
      color: ${roninTheme.colors.error};
    }
    .btn-danger:hover { background: ${roninTheme.colors.error}50; color: ${roninTheme.colors.textPrimary}; }

    .editor-container {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      overflow: hidden;
      margin-bottom: ${roninTheme.spacing.lg};
    }

    .editor-header {
      background: ${roninTheme.colors.backgroundTertiary};
      padding: ${roninTheme.spacing.md} ${roninTheme.spacing.lg};
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid ${roninTheme.colors.border};
    }

    .editor-header h2 {
      font-size: 0.9375rem;
      font-weight: 300;
      color: ${roninTheme.colors.textSecondary};
    }

    .status {
      font-size: 0.75rem;
      padding: ${roninTheme.spacing.xs} ${roninTheme.spacing.sm};
      border-radius: ${roninTheme.borderRadius.sm};
    }
    .status.saved { background: ${roninTheme.colors.success}30; color: ${roninTheme.colors.success}; }
    .status.unsaved { background: ${roninTheme.colors.warning}30; color: ${roninTheme.colors.warning}; }

    textarea {
      width: 100%;
      min-height: 480px;
      padding: ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.background};
      color: ${roninTheme.colors.textPrimary};
      border: none;
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.8125rem;
      line-height: 1.6;
      resize: vertical;
      outline: none;
    }
    textarea:focus { background: ${roninTheme.colors.background}; }

    .preview {
      padding: ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.background};
      border-top: 1px solid ${roninTheme.colors.border};
      max-height: 400px;
      overflow-y: auto;
    }

    .preview-content {
      font-family: ${roninTheme.fonts.mono};
      white-space: pre-wrap;
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.8125rem;
    }
    .preview-content h3 { color: ${roninTheme.colors.link}; margin: ${roninTheme.spacing.md} 0 ${roninTheme.spacing.sm} 0; font-size: 1rem; }
    .preview-content strong { color: ${roninTheme.colors.link}; }
    .preview-content code { background: ${roninTheme.colors.backgroundSecondary}; padding: 2px 6px; border-radius: ${roninTheme.borderRadius.sm}; font-size: 0.75rem; }

    .info-box {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      padding: ${roninTheme.spacing.lg};
      border-radius: ${roninTheme.borderRadius.lg};
      margin-bottom: ${roninTheme.spacing.lg};
    }
    .info-box h3 { color: ${roninTheme.colors.link}; margin-bottom: ${roninTheme.spacing.sm}; font-size: 0.9375rem; }
    .info-box ul { margin-left: ${roninTheme.spacing.lg}; color: ${roninTheme.colors.textSecondary}; }
    .info-box li { margin-bottom: ${roninTheme.spacing.xs}; }

    .success-message {
      background: ${roninTheme.colors.success}20;
      border: 1px solid ${roninTheme.colors.success}50;
      color: ${roninTheme.colors.success};
      padding: ${roninTheme.spacing.md};
      border-radius: ${roninTheme.borderRadius.md};
      margin-bottom: ${roninTheme.spacing.lg};
      display: none;
    }
    .success-message.show { display: block; }

    .tabs { display: flex; gap: ${roninTheme.spacing.xs}; margin-bottom: ${roninTheme.spacing.lg}; }

    .tab {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
      cursor: pointer;
      border-radius: ${roninTheme.borderRadius.md} ${roninTheme.borderRadius.md} 0 0;
      font-size: 0.8125rem;
    }
    .tab.active { background: ${roninTheme.colors.backgroundTertiary}; color: ${roninTheme.colors.textPrimary}; border-bottom-color: transparent; }

    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>🔐 Ronin Security Rules</h1>
    <div class="header-meta">Manage security rules for AI and agent behaviors</div>
  </div>

  <div class="page-content">
    <div class="success-message" id="successMessage">
      ✅ Rules saved successfully!
    </div>
    
    <div class="info-box">
      <h3>📋 About Security Rules</h3>
      <ul>
        <li>Rules are injected into ALL AI context windows</li>
        <li>Enforce authentication and authorization requirements</li>
        <li>Prevent credential leaks in responses</li>
        <li>Control which users can execute commands</li>
        <li>Changes take effect immediately after saving</li>
      </ul>
    </div>
    
    <div class="tabs">
      <button class="tab active" onclick="switchTab('editor')">✏️ Editor</button>
      <button class="tab" onclick="switchTab('preview')">👁️ Preview</button>
    </div>
    
    <div class="toolbar">
      <button class="btn-primary" onclick="saveRules()">💾 Save Changes</button>
      <button class="btn-secondary" onclick="loadRules()">🔄 Reload</button>
      <button class="btn-danger" onclick="resetRules()">⚠️ Reset to Defaults</button>
    </div>
    
    <div id="editor-tab" class="tab-content active">
      <div class="editor-container">
        <div class="editor-header">
          <h2>rulebook.md</h2>
          <span class="status unsaved" id="status">Unsaved changes</span>
        </div>
        <form id="rulesForm" method="POST" action="/rules">
          <textarea 
            id="rulesContent" 
            name="content" 
            placeholder="Loading rules..."
            oninput="markUnsaved()"
          >${this.escapeHtml(content)}</textarea>
        </form>
      </div>
    </div>
    
    <div id="preview-tab" class="tab-content">
      <div class="editor-container">
        <div class="editor-header">
          <h2>Rendered Preview</h2>
        </div>
        <div class="preview">
          <div class="preview-content" id="previewContent"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let originalContent = document.getElementById('rulesContent').value;
    
    function markUnsaved() {
      const status = document.getElementById('status');
      const currentContent = document.getElementById('rulesContent').value;
      
      if (currentContent !== originalContent) {
        status.textContent = 'Unsaved changes';
        status.className = 'status unsaved';
      } else {
        status.textContent = 'Saved';
        status.className = 'status saved';
      }
      
      updatePreview();
    }
    
    function markSaved() {
      const status = document.getElementById('status');
      originalContent = document.getElementById('rulesContent').value;
      status.textContent = 'Saved';
      status.className = 'status saved';
    }
    
    async function saveRules() {
      const content = document.getElementById('rulesContent').value;
      
      try {
        const response = await fetch('/api/rules', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ content })
        });
        
        const result = await response.json();
        
        if (result.success) {
          markSaved();
          showSuccess('Rules saved successfully!');
        } else {
          alert('Error: ' + result.error);
        }
      } catch (error) {
        console.error('Error saving rules:', error);
        alert('Failed to save rules');
      }
    }
    
    async function loadRules() {
      try {
        const response = await fetch('/api/rules');
        const result = await response.json();
        
        if (result.success) {
          document.getElementById('rulesContent').value = result.content;
          markSaved();
          updatePreview();
        } else {
          alert('Error: ' + result.error);
        }
      } catch (error) {
        console.error('Error loading rules:', error);
        alert('Failed to load rules');
      }
    }
    
    async function resetRules() {
      if (!confirm('⚠️ WARNING: This will reset ALL rules to defaults.\\n\\nAny custom rules will be lost.\\n\\nAre you sure you want to continue?')) {
        return;
      }
      
      try {
        const response = await fetch('/api/rules/reset', {
          method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
          document.getElementById('rulesContent').value = result.content;
          markSaved();
          updatePreview();
          showSuccess('Rules reset to defaults');
        } else {
          alert('Error: ' + result.error);
        }
      } catch (error) {
        console.error('Error resetting rules:', error);
        alert('Failed to reset rules');
      }
    }
    
    function switchTab(tabName) {
      // Hide all tabs
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
      });
      document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
      });
      
      // Show selected tab
      document.getElementById(tabName + '-tab').classList.add('active');
      event.target.classList.add('active');
      
      if (tabName === 'preview') {
        updatePreview();
      }
    }
    
    function updatePreview() {
      const content = document.getElementById('rulesContent').value;
      // Simple markdown-like preview
      const html = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/^#{1,6}\\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^\\*\\s+(.+)$/gm, '• $1')
        .replace(/^\\d+\\.\\s+(.+)$/gm, '$1')
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        .replace(/\`(.+?)\`/g, '<code>$1</code>')
        .replace(/\\n\\n/g, '<br><br>');
      
      document.getElementById('previewContent').innerHTML = html;
    }
    
    function showSuccess(message) {
      const msg = document.getElementById('successMessage');
      msg.textContent = '✅ ' + message;
      msg.classList.add('show');
      setTimeout(() => {
        msg.classList.remove('show');
      }, 3000);
    }
    
    // Check for saved parameter in URL
    if (window.location.search.includes('saved=true')) {
      showSuccess('Rules saved successfully!');
      // Clean URL
      window.history.replaceState({}, document.title, '/rules');
    }
    
    // Initialize preview
    updatePreview();
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveRules();
      }
    });
  </script>
</body>
</html>`;
      
      return new Response(html, {
        headers: { "Content-Type": "text/html" }
      });
    } catch (error) {
      console.error("[rule-manager] Error rendering rules page:", error);
      return new Response("Error loading rules editor", { status: 500 });
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = { replace: (str: string) => str };
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async execute(): Promise<void> {
    // This agent is webhook-based, scheduled execution not needed
    console.log("[rule-manager] Rule Manager Agent running");
  }
}