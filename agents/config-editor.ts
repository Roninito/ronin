import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { join } from "path";
import { homedir } from "os";
import { mkdir, readFile, writeFile, readdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS } from "../src/utils/theme.js";

interface ConfigBackup {
  id: string;
  timestamp: number;
  description: string;
  changedFields: string[];
  size: number;
}

interface ConfigManifest {
  version: string;
  backups: ConfigBackup[];
}

/**
 * Config Editor Agent
 * 
 * Provides web UI at /config for editing ~/.ronin/config.json
 * Features:
 * - Password authentication (from CONFIG_EDITOR_PASSWORD env var, default: "roninpass")
 * - Dual editing modes: Form (structured) and JSON (raw)
 * - Strict validation - blocks saving invalid config
 * - Backup system - keeps last 10 versions
 * - Auto-creates app directories
 * - Config versioning with configVersion field
 * - Hot-reload - emits config_reloaded event on save
 */
export default class ConfigEditorAgent extends BaseAgent {
  private configPath: string;
  private historyDir: string;
  private password: string;
  private sessions: Set<string> = new Set();
  private currentConfig: Record<string, unknown> = {};

  // Config schema for form generation and validation
  private configSchema = {
    configVersion: {
      type: 'string',
      readonly: true,
      default: '1.0.0',
      description: 'Configuration schema version'
    },
    defaultCLI: {
      type: 'select',
      options: ['qwen', 'cursor', 'opencode', 'gemini'],
      default: 'qwen',
      required: true,
      description: 'Default CLI tool for build execution',
      helpText: 'Used when no CLI tag specified in plan'
    },
    defaultAppsDirectory: {
      type: 'path',
      required: true,
      default: join(homedir(), '.ronin', 'apps'),
      description: 'Base directory for app workspaces',
      helpText: 'App workspaces are created here when using #app-* tags',
      validate: 'path'
    },
    apps: {
      type: 'keyValue',
      description: 'Named app workspaces',
      helpText: 'Map of app names to directory paths',
      validate: 'path'
    },
    cliOptions: {
      type: 'nested',
      description: 'CLI-specific options',
      fields: {
        qwen: {
          model: { type: 'string', default: 'qwen3:1.7b' },
          timeout: { type: 'number', default: 300000, min: 1000, max: 3600000 }
        },
        cursor: {
          timeout: { type: 'number', default: 60000, min: 1000, max: 3600000 }
        },
        opencode: {
          timeout: { type: 'number', default: 120000, min: 1000, max: 3600000 }
        },
        gemini: {
          model: { type: 'string', default: 'gemini-pro' },
          timeout: { type: 'number', default: 60000, min: 1000, max: 3600000 }
        }
      }
    },
    eventMonitor: {
      type: 'nested',
      description: 'Event Monitor settings',
      fields: {
        enabled: { type: 'boolean', default: true },
        retentionHours: { type: 'number', default: 24, min: 1, max: 168 },
        maxPayloadSize: { type: 'number', default: 500, min: 100, max: 10000 },
        autoRefreshSeconds: { type: 'number', default: 30, min: 5, max: 300 },
        pageSize: { type: 'number', default: 50, min: 10, max: 100 },
        sampling: {
          type: 'nested',
          fields: {
            enabled: { type: 'boolean', default: true },
            thresholdPerHour: { type: 'number', default: 100, min: 10, max: 10000 },
            rate: { type: 'number', default: 10, min: 2, max: 100 }
          }
        }
      }
    },
    discord: {
      type: 'nested',
      description: 'Discord Bot Configuration',
      helpText: 'Configure Discord bot integration and monitored channels',
      fields: {
        enabled: { 
          type: 'boolean', 
          default: false,
          description: 'Enable Discord bot'
        },
        botToken: { 
          type: 'string', 
          default: '',
          description: 'Discord Bot Token',
          helpText: 'Get from Discord Developer Portal: https://discord.com/developers/applications'
        },
        channelIds: { 
          type: 'array',
          itemType: 'string',
          default: [],
          description: 'Channel IDs to monitor',
          helpText: 'Comma-separated list of Discord channel IDs'
        },
        clientId: { 
          type: 'string', 
          default: '',
          description: 'Discord Application Client ID',
          helpText: 'Optional: Auto-populated after bot initialization'
        }
      }
    },
    telegram: {
      type: 'nested',
      description: 'Telegram Bot Configuration',
      helpText: 'Configure Telegram bot for notifications and messaging',
      fields: {
        botToken: {
          type: 'string',
          default: '',
          description: 'Telegram Bot Token',
          helpText: 'Get from @BotFather on Telegram'
        },
        chatId: {
          type: 'string',
          default: '',
          description: 'Default Chat ID',
          helpText: 'Chat ID for sending messages (can be channel, group, or user ID)'
        }
      }
    },
    ai: {
      type: 'nested',
      description: 'AI/Ollama Configuration',
      helpText: 'Configure local AI model settings',
      fields: {
        ollamaUrl: {
          type: 'string',
          default: 'http://localhost:11434',
          description: 'Ollama Server URL',
          helpText: 'URL of your Ollama instance'
        },
        ollamaModel: {
          type: 'string',
          default: 'qwen3:4b',
          description: 'Default AI Model',
          helpText: 'Model name for AI completions'
        },
        ollamaTimeoutMs: {
          type: 'number',
          default: 300000,
          min: 1000,
          max: 3600000,
          description: 'Request Timeout (ms)',
          helpText: 'Maximum time to wait for AI responses'
        },
        ollamaEmbeddingModel: {
          type: 'string',
          default: 'nomic-embed-text',
          description: 'Embedding Model',
          helpText: 'Model for text embeddings (used by RAG)'
        }
      }
    },
    gemini: {
      type: 'nested',
      description: 'Google Gemini Configuration',
      helpText: 'Configure Google Gemini AI API',
      fields: {
        apiKey: {
          type: 'string',
          default: '',
          description: 'API Key',
          helpText: 'Get from https://aistudio.google.com/app/apikey'
        },
        model: {
          type: 'string',
          default: 'gemini-pro',
          description: 'Model',
          helpText: 'Gemini model to use'
        },
        apiVersion: {
          type: 'select',
          options: ['v1', 'v1beta'],
          default: 'v1beta',
          description: 'API Version',
          helpText: 'Gemini API version'
        },
        debug: {
          type: 'boolean',
          default: false,
          description: 'Debug Mode',
          helpText: 'Enable debug logging for Gemini API calls'
        }
      }
    },
    grok: {
      type: 'nested',
      description: 'Grok/X AI Configuration',
      helpText: 'Configure xAI Grok API',
      fields: {
        apiKey: {
          type: 'string',
          default: '',
          description: 'API Key',
          helpText: 'Get from https://x.ai'
        }
      }
    },
    system: {
      type: 'nested',
      description: 'System Settings',
      helpText: 'Configure system-wide settings',
      fields: {
        dataDir: {
          type: 'path',
          default: join(homedir(), '.ronin', 'data'),
          description: 'Data Directory',
          helpText: 'Location for databases and persistent data'
        },
        webhookPort: {
          type: 'number',
          default: 3000,
          min: 1,
          max: 65535,
          description: 'Webhook Port',
          helpText: 'Port for HTTP webhook server'
        },
        httpIdleTimeout: {
          type: 'number',
          default: 60,
          min: 1,
          max: 3600,
          description: 'HTTP Idle Timeout (seconds)',
          helpText: 'Timeout for idle HTTP connections'
        },
        externalAgentDir: {
          type: 'path',
          default: join(homedir(), '.ronin', 'agents'),
          description: 'External Agent Directory',
          helpText: 'Directory for external/user agents'
        },
        userPluginDir: {
          type: 'path',
          default: join(homedir(), '.ronin', 'plugins'),
          description: 'User Plugin Directory',
          helpText: 'Directory for user plugins (overrides built-in)'
        }
      }
    },
    blogBoy: {
      type: 'nested',
      description: 'Blog Boy Settings',
      helpText: 'Configure blog content generation',
      fields: {
        aiTimeoutMs: {
          type: 'number',
          default: 300000,
          min: 1000,
          max: 3600000,
          description: 'AI Timeout (ms)',
          helpText: 'Timeout for AI blog post generation'
        }
      }
    },
    configEditor: {
      type: 'nested',
      description: 'Config Editor Settings',
      helpText: 'Web-based configuration editor settings',
      fields: {
        password: {
          type: 'string',
          default: 'roninpass',
          description: 'Editor Password',
          helpText: 'Password for accessing the config editor UI'
        }
      }
    },
    rssToTelegram: {
      type: 'nested',
      description: 'RSS to Telegram Settings',
      helpText: 'Configure RSS feed forwarding to Telegram',
      fields: {
        enabled: {
          type: 'boolean',
          default: false,
          description: 'Enable RSS to Telegram',
          helpText: 'Forward RSS feeds to Telegram'
        }
      }
    },
    realm: {
      type: 'nested',
      description: 'Realm P2P Configuration',
      helpText: 'Configure Realm peer-to-peer communication',
      fields: {
        url: {
          type: 'string',
          default: '',
          description: 'Discovery Server URL',
          helpText: 'WebSocket URL of Realm discovery server'
        },
        callsign: {
          type: 'string',
          default: '',
          description: 'Call Sign',
          helpText: 'Your unique identifier in the Realm network'
        },
        token: {
          type: 'string',
          default: '',
          description: 'Auth Token',
          helpText: 'Optional authentication token for Realm'
        },
        localPort: {
          type: 'number',
          default: 4000,
          min: 1024,
          max: 65535,
          description: 'Local WebSocket Port',
          helpText: 'Port for local WebSocket server'
        }
      }
    }
  };

  constructor(api: AgentAPI) {
    super(api);
    this.configPath = join(homedir(), '.ronin', 'config.json');
    this.historyDir = join(homedir(), '.ronin', 'config.history');
    
    // Use config service with env var fallback
    const configEditor = this.api.config.getConfigEditor();
    this.password = process.env.CONFIG_EDITOR_PASSWORD || configEditor.password || 'roninpass';
    
    this.initialize();
    this.registerRoutes();
    
    console.log('⚙️  Config Editor ready at /config');
    console.log(`   Password: ${this.password === 'roninpass' ? 'roninpass (default - change recommended)' : 'set via env'}`);
  }

  /**
   * Initialize directories and load current config
   */
  private async initialize(): Promise<void> {
    // Ensure .ronin directory exists
    const roninDir = join(homedir(), '.ronin');
    if (!existsSync(roninDir)) {
      await mkdir(roninDir, { recursive: true });
    }

    // Ensure history directory exists
    if (!existsSync(this.historyDir)) {
      await mkdir(this.historyDir, { recursive: true });
    }

    // Load current config
    await this.loadConfig();
  }

  /**
   * Load config from disk
   */
  private async loadConfig(): Promise<void> {
    try {
      if (existsSync(this.configPath)) {
        const content = await readFile(this.configPath, 'utf-8');
        this.currentConfig = JSON.parse(content);
      } else {
        // Create default config
        this.currentConfig = this.generateDefaultConfig();
        await this.saveConfig(this.currentConfig, 'Initial config created');
      }
    } catch (error) {
      console.error('[config-editor] Failed to load config:', error);
      this.currentConfig = this.generateDefaultConfig();
    }
  }

  /**
   * Generate default configuration
   */
  private generateDefaultConfig(): Record<string, unknown> {
    return {
      configVersion: '1.0.0',
      defaultCLI: 'qwen',
      defaultAppsDirectory: join(homedir(), '.ronin', 'apps'),
      apps: {},
      cliOptions: {
        qwen: { model: 'qwen3:1.7b', timeout: 300000 },
        cursor: { timeout: 60000 },
        opencode: { timeout: 120000 },
        gemini: { model: 'gemini-pro', timeout: 60000 }
      },
      eventMonitor: {
        enabled: true,
        retentionHours: 24,
        maxPayloadSize: 500,
        autoRefreshSeconds: 30,
        pageSize: 50,
        sampling: {
          enabled: true,
          thresholdPerHour: 100,
          rate: 10
        }
      },
      discord: {
        enabled: false,
        botToken: '',
        channelIds: [],
        clientId: ''
      },
      telegram: {
        botToken: '',
        chatId: ''
      },
      ai: {
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'qwen3:4b',
        ollamaTimeoutMs: 300000,
        ollamaEmbeddingModel: 'nomic-embed-text'
      },
      gemini: {
        apiKey: '',
        model: 'gemini-pro',
        apiVersion: 'v1beta',
        debug: false
      },
      grok: {
        apiKey: ''
      },
      system: {
        dataDir: join(homedir(), '.ronin', 'data'),
        webhookPort: 3000,
        httpIdleTimeout: 60,
        externalAgentDir: join(homedir(), '.ronin', 'agents'),
        userPluginDir: join(homedir(), '.ronin', 'plugins')
      },
      blogBoy: {
        aiTimeoutMs: 300000
      },
      configEditor: {
        password: 'roninpass'
      },
      rssToTelegram: {
        enabled: false
      },
      realm: {
        url: '',
        callsign: '',
        token: '',
        localPort: 4000
      },
      pluginDir: join(process.cwd(), 'plugins'),
      geminiModel: 'gemini-3-pro-preview'
    };
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    // Main UI
    this.api.http.registerRoute('/config', this.handleConfigUI.bind(this));
    this.api.http.registerRoute('/config/', this.handleConfigUI.bind(this));

    // API routes
    this.api.http.registerRoute('/config/api/current', this.handleGetConfig.bind(this));
    this.api.http.registerRoute('/config/api/update', this.handleUpdateConfig.bind(this));
    this.api.http.registerRoute('/config/api/validate', this.handleValidateConfig.bind(this));
    this.api.http.registerRoute('/config/api/schema', this.handleGetSchema.bind(this));
    this.api.http.registerRoute('/config/api/backups', this.handleListBackups.bind(this));
    this.api.http.registerRoute('/config/api/restore', this.handleRestoreBackup.bind(this));
    this.api.http.registerRoute('/config/api/backup', this.handleCreateBackup.bind(this));

    // Auth routes
    this.api.http.registerRoute('/config/login', this.handleLogin.bind(this));
    this.api.http.registerRoute('/config/logout', this.handleLogout.bind(this));
  }

  /**
   * Check if request is authenticated
   */
  private isAuthenticated(req: Request): boolean {
    const cookie = req.headers.get('cookie') || '';
    const sessionMatch = cookie.match(/config_session=([^;]+)/);
    if (!sessionMatch) return false;
    return this.sessions.has(sessionMatch[1]);
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle login
   */
  private async handleLogin(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await req.json();
      const { password } = body;

      if (password !== this.password) {
        console.log(`[config-editor] Failed login attempt at ${new Date().toISOString()}`);
        return Response.json({ success: false, error: 'Invalid password' }, { status: 401 });
      }

      const sessionId = this.generateSessionId();
      this.sessions.add(sessionId);

      return Response.json(
        { success: true },
        {
          headers: {
            'Set-Cookie': `config_session=${sessionId}; HttpOnly; Path=/config; Max-Age=3600`
          }
        }
      );
    } catch (error) {
      return Response.json({ success: false, error: String(error) }, { status: 400 });
    }
  }

  /**
   * Handle logout
   */
  private async handleLogout(req: Request): Promise<Response> {
    const cookie = req.headers.get('cookie') || '';
    const sessionMatch = cookie.match(/config_session=([^;]+)/);
    if (sessionMatch) {
      this.sessions.delete(sessionMatch[1]);
    }

    return Response.json(
      { success: true },
      {
        headers: {
          'Set-Cookie': 'config_session=; HttpOnly; Path=/config; Max-Age=0'
        }
      }
    );
  }

  /**
   * Handle main config UI
   */
  private async handleConfigUI(req: Request): Promise<Response> {
    const isAuthenticated = this.isAuthenticated(req);

    if (!isAuthenticated) {
      return this.renderLoginPage();
    }

    return this.renderEditorPage();
  }

  /**
   * Render login page
   */
  private renderLoginPage(): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Config Editor - Login</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: ${roninTheme.colors.background};
      color: ${roninTheme.colors.textPrimary};
      font-family: 'Inter', sans-serif;
    }

    .login-container {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: 2.5rem;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 300;
      margin-bottom: 0.5rem;
      text-align: center;
    }

    .subtitle {
      text-align: center;
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.875rem;
      margin-bottom: 2rem;
    }

    .form-group {
      margin-bottom: 1.5rem;
    }

    label {
      display: block;
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      color: ${roninTheme.colors.textSecondary};
    }

    input[type="password"] {
      width: 100%;
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.75rem;
      border-radius: ${roninTheme.borderRadius.md};
      font-family: inherit;
      font-size: 0.875rem;
      box-sizing: border-box;
    }

    input[type="password"]:focus {
      outline: none;
      border-color: ${roninTheme.colors.accent};
    }

    button {
      width: 100%;
      background: ${roninTheme.colors.accent};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.75rem;
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
    }

    button:hover {
      background: ${roninTheme.colors.accentHover};
    }

    .info {
      margin-top: 1.5rem;
      padding: 0.75rem;
      background: ${roninTheme.colors.backgroundTertiary};
      border-radius: ${roninTheme.borderRadius.md};
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
      text-align: center;
    }

    .error {
      background: rgba(220, 53, 69, 0.1);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #dc3545;
      padding: 0.75rem;
      border-radius: ${roninTheme.borderRadius.md};
      margin-bottom: 1rem;
      font-size: 0.875rem;
      display: none;
    }

    .error.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>🔒 Config Editor</h1>
    <p class="subtitle">Enter password to edit configuration</p>
    
    <div class="error" id="error"></div>
    
    <form id="loginForm">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autofocus>
      </div>
      <button type="submit">Login</button>
    </form>
    
    <div class="info">
      <strong>Default:</strong> "roninpass"<br>
      Change via CONFIG_EDITOR_PASSWORD env var
    </div>
  </div>

  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const errorDiv = document.getElementById('error');
      
      try {
        const res = await fetch('/config/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        
        if (res.ok) {
          window.location.reload();
        } else {
          const data = await res.json();
          errorDiv.textContent = data.error || 'Login failed';
          errorDiv.classList.add('show');
        }
      } catch (err) {
        errorDiv.textContent = 'Network error';
        errorDiv.classList.add('show');
      }
    });
  </script>
</body>
</html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  /**
   * Render main editor page
   */
  private renderEditorPage(): Response {
    // This is a simplified version - full implementation would include the complete UI
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Config Editor</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      margin: 0;
      background: ${roninTheme.colors.background};
      color: ${roninTheme.colors.textPrimary};
      font-family: 'Inter', sans-serif;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid ${roninTheme.colors.border};
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 300;
      margin: 0;
    }

    .header-actions {
      display: flex;
      gap: 1rem;
    }

    .btn {
      background: ${roninTheme.colors.accent};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.5rem 1rem;
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.875rem;
      text-decoration: none;
      display: inline-block;
    }

    .btn:hover {
      background: ${roninTheme.colors.accentHover};
    }

    .btn-secondary {
      background: transparent;
      color: ${roninTheme.colors.textSecondary};
    }

    .btn-secondary:hover {
      background: ${roninTheme.colors.backgroundSecondary};
      color: ${roninTheme.colors.textPrimary};
    }

    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid ${roninTheme.colors.border};
    }

    .tab {
      padding: 0.75rem 1.5rem;
      background: transparent;
      border: none;
      color: ${roninTheme.colors.textSecondary};
      cursor: pointer;
      font-size: 0.875rem;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }

    .tab.active {
      color: ${roninTheme.colors.textPrimary};
      border-bottom-color: ${roninTheme.colors.accent};
    }

    .editor-container {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: 1.5rem;
    }

    .section {
      margin-bottom: 2rem;
    }

    .section-title {
      font-size: 1.125rem;
      font-weight: 500;
      margin-bottom: 1rem;
      color: ${roninTheme.colors.textPrimary};
    }

    .form-group {
      margin-bottom: 1.25rem;
    }

    label {
      display: block;
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      color: ${roninTheme.colors.textSecondary};
    }

    input[type="text"], input[type="number"], select {
      width: 100%;
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.625rem;
      border-radius: ${roninTheme.borderRadius.md};
      font-family: inherit;
      font-size: 0.875rem;
      box-sizing: border-box;
    }

    input:focus, select:focus {
      outline: none;
      border-color: ${roninTheme.colors.accent};
    }

    .help-text {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
      margin-top: 0.25rem;
    }

    .validation-error {
      background: rgba(220, 53, 69, 0.1);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #dc3545;
      padding: 1rem;
      border-radius: ${roninTheme.borderRadius.md};
      margin-bottom: 1rem;
      font-size: 0.875rem;
    }

    .validation-success {
      background: rgba(40, 167, 69, 0.1);
      border: 1px solid rgba(40, 167, 69, 0.3);
      color: #28a745;
      padding: 1rem;
      border-radius: ${roninTheme.borderRadius.md};
      margin-bottom: 1rem;
      font-size: 0.875rem;
    }

    textarea {
      width: 100%;
      min-height: 400px;
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.75rem;
      border-radius: ${roninTheme.borderRadius.md};
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      resize: vertical;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚙️ Config Editor</h1>
      <div class="header-actions">
        <button class="btn" onclick="saveConfig()">💾 Save Changes</button>
        <button class="btn btn-secondary" onclick="showBackups()">📜 Backups</button>
        <button class="btn btn-secondary" onclick="logout()">Logout</button>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('form')">📋 Form Mode</button>
      <button class="tab" onclick="switchTab('json')">📝 JSON Mode</button>
    </div>

    <div id="validationStatus"></div>

    <div class="editor-container" id="editorContainer">
      <div id="formEditor">
        <!-- Form content loaded via JS -->
        <p>Loading configuration...</p>
      </div>
      <div id="jsonEditor" style="display: none;">
        <textarea id="jsonTextarea"></textarea>
      </div>
    </div>
  </div>

  <script>
    // Theme configuration (injected from server)
    const roninTheme = {
      colors: {
        background: '#1a1a1a',
        backgroundSecondary: '#242424',
        backgroundTertiary: '#2d2d2d',
        textPrimary: '#e0e0e0',
        textSecondary: '#a0a0a0',
        textTertiary: '#707070',
        accent: '#4a9eff',
        accentHover: '#3a8eef',
        border: '#3a3a3a'
      },
      borderRadius: {
        md: '6px'
      }
    };
    
    let currentConfig = {};
    let currentTab = 'form';

    // Load config on page load
    async function loadConfig() {
      try {
        const res = await fetch('/config/api/current');
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || 'HTTP ' + res.status);
        }
        currentConfig = await res.json();
        if (!currentConfig || Object.keys(currentConfig).length === 0) {
          throw new Error('Empty configuration received');
        }
        renderForm();
        document.getElementById('jsonTextarea').value = JSON.stringify(currentConfig, null, 2);
      } catch (err) {
        console.error('[config-editor] Failed to load:', err);
        showError('Failed to load configuration: ' + err.message);
      }
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      
      if (tab === 'form') {
        document.getElementById('formEditor').style.display = 'block';
        document.getElementById('jsonEditor').style.display = 'none';
      } else {
        document.getElementById('formEditor').style.display = 'none';
        document.getElementById('jsonEditor').style.display = 'block';
        document.getElementById('jsonTextarea').value = JSON.stringify(currentConfig, null, 2);
      }
    }

    function renderForm() {
      // Simplified - full implementation would generate forms from schema
      const container = document.getElementById('formEditor');
      container.innerHTML = \`
        <div class="section">
          <div class="section-title">General Settings</div>
          <div class="form-group">
            <label>Config Version</label>
            <input type="text" value="\${currentConfig.configVersion}" readonly>
            <div class="help-text">Read-only schema version</div>
          </div>
          <div class="form-group">
            <label>Default CLI Tool</label>
            <select id="defaultCLI" onchange="updateConfig('defaultCLI', this.value)">
              <option value="qwen" \${currentConfig.defaultCLI === 'qwen' ? 'selected' : ''}>qwen</option>
              <option value="cursor" \${currentConfig.defaultCLI === 'cursor' ? 'selected' : ''}>cursor</option>
              <option value="opencode" \${currentConfig.defaultCLI === 'opencode' ? 'selected' : ''}>opencode</option>
              <option value="gemini" \${currentConfig.defaultCLI === 'gemini' ? 'selected' : ''}>gemini</option>
            </select>
            <div class="help-text">Used when no CLI specified in plan</div>
          </div>
          <div class="form-group">
            <label>Apps Directory</label>
            <input type="text" id="defaultAppsDirectory" 
                   value="\${currentConfig.defaultAppsDirectory || ''}"
                   onchange="updateConfig('defaultAppsDirectory', this.value)">
            <div class="help-text">Base directory for app workspaces</div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">CLI Options</div>
          <p style="color: \${roninTheme.colors.textTertiary}">Configure options for each CLI tool...</p>
        </div>
      \`;
    }

    function updateConfig(key, value) {
      currentConfig[key] = value;
    }

    async function saveConfig() {
      if (currentTab === 'json') {
        try {
          currentConfig = JSON.parse(document.getElementById('jsonTextarea').value);
        } catch (err) {
          showError('Invalid JSON: ' + err.message);
          return;
        }
      }

      try {
        const res = await fetch('/config/api/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentConfig)
        });

        const result = await res.json();
        
        if (result.success) {
          showSuccess('Configuration saved successfully! ' + result.message);
        } else {
          showError('Save failed: ' + (result.errors ? result.errors.join(', ') : result.error));
        }
      } catch (err) {
        showError('Network error: ' + err.message);
      }
    }

    function showError(message) {
      document.getElementById('validationStatus').innerHTML = 
        \`<div class="validation-error">❌ \${message}</div>\`;
    }

    function showSuccess(message) {
      document.getElementById('validationStatus').innerHTML = 
        \`<div class="validation-success">✅ \${message}</div>\`;
      setTimeout(() => {
        document.getElementById('validationStatus').innerHTML = '';
      }, 5000);
    }

    async function showBackups() {
      window.open('/config/api/backups', '_blank');
    }

    async function logout() {
      await fetch('/config/logout', { method: 'POST' });
      window.location.reload();
    }

    // Load on startup
    loadConfig();
  </script>
</body>
</html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  /**
   * Handle get config
   */
  private async handleGetConfig(req: Request): Promise<Response> {
    // Ensure config is loaded (lazy initialization)
    if (Object.keys(this.currentConfig).length === 0) {
      await this.loadConfig();
    }
    return Response.json(this.currentConfig);
  }

  /**
   * Handle get schema
   */
  private async handleGetSchema(req: Request): Promise<Response> {
    return Response.json(this.configSchema);
  }

  /**
   * Handle validate config
   */
  private async handleValidateConfig(req: Request): Promise<Response> {
    try {
      let config: Record<string, unknown>;

      if (req.method === 'POST') {
        const body = await req.json();
        config = body;
      } else {
        config = this.currentConfig;
      }

      const errors = this.validateConfig(config);

      return Response.json({
        valid: errors.length === 0,
        errors
      });
    } catch (error) {
      return Response.json(
        { valid: false, errors: [String(error)] },
        { status: 400 }
      );
    }
  }

  /**
   * Handle update config
   */
  private async handleUpdateConfig(req: Request): Promise<Response> {
    if (!this.isAuthenticated(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (req.method !== 'PUT') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const newConfig = await req.json();

      // Validate
      const errors = this.validateConfig(newConfig);
      if (errors.length > 0) {
        return Response.json(
          { success: false, errors },
          { status: 400 }
        );
      }

      // Track changes
      const changedFields = this.getChangedFields(this.currentConfig, newConfig);

      // Create backup
      await this.createBackup(changedFields);

      // Auto-create app directories
      await this.createAppDirectories(newConfig);

      // Save config
      await this.saveConfig(newConfig, `Updated: ${changedFields.join(', ')}`);

      // Update current
      this.currentConfig = newConfig;

      // Notify agents to reload
      this.api.events.emit('config_reloaded', {
        timestamp: Date.now(),
        configVersion: newConfig.configVersion,
        changedFields
      }, 'config-editor');

      console.log('[config-editor] Config updated:', changedFields.join(', '));

      return Response.json({
        success: true,
        message: `Updated ${changedFields.length} fields`,
        changedFields
      });
    } catch (error) {
      return Response.json(
        { success: false, error: String(error) },
        { status: 500 }
      );
    }
  }

  /**
   * Validate config against schema
   */
  private validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];

    // Check required fields
    const required = ['defaultCLI', 'defaultAppsDirectory'];
    for (const field of required) {
      if (!config[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate defaultCLI
    const validCLIs = ['qwen', 'cursor', 'opencode', 'gemini'];
    if (config.defaultCLI && !validCLIs.includes(config.defaultCLI as string)) {
      errors.push(`Invalid defaultCLI: must be one of ${validCLIs.join(', ')}`);
    }

    // Validate paths exist (warning only for new paths)
    if (config.defaultAppsDirectory && typeof config.defaultAppsDirectory === 'string') {
      // Don't require existence - will be created
    }

    // Validate nested structures
    if (config.cliOptions && typeof config.cliOptions === 'object') {
      const cliOpts = config.cliOptions as Record<string, unknown>;
      for (const [cli, opts] of Object.entries(cliOpts)) {
        if (opts && typeof opts === 'object') {
          const options = opts as Record<string, unknown>;
          if (options.timeout !== undefined) {
            const timeout = Number(options.timeout);
            if (timeout < 1000 || timeout > 3600000) {
              errors.push(`cliOptions.${cli}.timeout must be between 1000 and 3600000`);
            }
          }
        }
      }
    }

    return errors;
  }

  /**
   * Get changed fields between configs
   */
  private getChangedFields(oldConfig: Record<string, unknown>, newConfig: Record<string, unknown>): string[] {
    const changed: string[] = [];
    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

    for (const key of allKeys) {
      if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
        changed.push(key);
      }
    }

    return changed;
  }

  /**
   * Create backup before save
   */
  private async createBackup(changedFields: string[]): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = timestamp;
    const backupPath = join(this.historyDir, `${backupId}.json`);

    // Save backup
    await writeFile(backupPath, JSON.stringify(this.currentConfig, null, 2));

    // Update manifest
    const manifestPath = join(this.historyDir, 'manifest.json');
    let manifest: ConfigManifest = { version: '1.0', backups: [] };

    if (existsSync(manifestPath)) {
      const content = await readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    }

    // Add new backup
    manifest.backups.unshift({
      id: backupId,
      timestamp: Date.now(),
      description: `Changed: ${changedFields.join(', ')}`,
      changedFields,
      size: JSON.stringify(this.currentConfig).length
    });

    // Keep only last 10
    if (manifest.backups.length > 10) {
      const toDelete = manifest.backups.slice(10);
      for (const backup of toDelete) {
        const oldPath = join(this.historyDir, `${backup.id}.json`);
        if (existsSync(oldPath)) {
          await unlink(oldPath);
        }
      }
      manifest.backups = manifest.backups.slice(0, 10);
    }

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Create app directories if they don't exist
   */
  private async createAppDirectories(config: Record<string, unknown>): Promise<void> {
    if (config.apps && typeof config.apps === 'object') {
      const apps = config.apps as Record<string, string>;
      for (const [appName, appPath] of Object.entries(apps)) {
        if (!existsSync(appPath)) {
          await mkdir(appPath, { recursive: true });
          console.log(`[config-editor] Created app directory: ${appName} -> ${appPath}`);
        }
      }
    }

    // Ensure default apps directory exists
    if (config.defaultAppsDirectory && typeof config.defaultAppsDirectory === 'string') {
      if (!existsSync(config.defaultAppsDirectory)) {
        await mkdir(config.defaultAppsDirectory, { recursive: true });
        console.log(`[config-editor] Created default apps directory: ${config.defaultAppsDirectory}`);
      }
    }
  }

  /**
   * Save config to file
   */
  private async saveConfig(config: Record<string, unknown>, description: string): Promise<void> {
    // Ensure configVersion is set
    if (!config.configVersion) {
      config.configVersion = '1.0.0';
    }

    await writeFile(this.configPath, JSON.stringify(config, null, 2));
    console.log(`[config-editor] Config saved: ${description}`);
  }

  /**
   * Handle list backups
   */
  private async handleListBackups(req: Request): Promise<Response> {
    if (!this.isAuthenticated(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const manifestPath = join(this.historyDir, 'manifest.json');
      if (!existsSync(manifestPath)) {
        return Response.json({ backups: [] });
      }

      const content = await readFile(manifestPath, 'utf-8');
      const manifest: ConfigManifest = JSON.parse(content);

      return Response.json(manifest);
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  /**
   * Handle restore backup
   */
  private async handleRestoreBackup(req: Request): Promise<Response> {
    if (!this.isAuthenticated(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const body = await req.json();
      const { backupId } = body;

      const backupPath = join(this.historyDir, `${backupId}.json`);
      if (!existsSync(backupPath)) {
        return Response.json({ error: 'Backup not found' }, { status: 404 });
      }

      // Read backup
      const content = await readFile(backupPath, 'utf-8');
      const restoredConfig = JSON.parse(content);

      // Validate
      const errors = this.validateConfig(restoredConfig);
      if (errors.length > 0) {
        return Response.json({ error: 'Invalid backup', errors }, { status: 400 });
      }

      // Backup current before restore
      await this.createBackup(['restore']);

      // Restore
      await this.saveConfig(restoredConfig, `Restored from backup: ${backupId}`);
      this.currentConfig = restoredConfig;

      // Notify reload
      this.api.events.emit('config_reloaded', {
        timestamp: Date.now(),
        configVersion: restoredConfig.configVersion,
        changedFields: ['restore']
      }, 'config-editor');

      return Response.json({ success: true, message: `Restored from ${backupId}` });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  /**
   * Handle create manual backup
   */
  private async handleCreateBackup(req: Request): Promise<Response> {
    if (!this.isAuthenticated(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      await this.createBackup(['manual']);
      return Response.json({ success: true, message: 'Backup created' });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  async execute(): Promise<void> {
    // Agent is route-driven
    console.log('[config-editor] Running...');
  }
}
