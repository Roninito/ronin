import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Onboarding Wizard Agent
 * 
 * Provides a web-based setup wizard for first-time configuration.
 * Guides users through essential setup steps with visual progress indicators.
 */
export default class OnboardingWizardAgent extends BaseAgent {
  static webhook = "/onboarding";
  
  private configDir: string;
  private setupFile: string;

  constructor(api: AgentAPI) {
    super(api);
    
    this.configDir = join(homedir(), ".ronin");
    this.setupFile = join(this.configDir, "setup.json");
    
    console.log("[onboarding-wizard] Onboarding Wizard Agent initialized");
    
    // Register routes
    this.registerRoutes();
    
    // Check if setup is needed on startup
    this.checkSetupNeeded();
  }

  /**
   * Register HTTP routes for the onboarding wizard
   */
  private registerRoutes(): void {
    // Main onboarding page
    this.api.http.registerRoute("/onboarding", async (req: Request) => {
      if (req.method === "GET") {
        return this.renderOnboardingPage();
      }
      
      if (req.method === "POST") {
        return this.handleSetupSubmission(req);
      }
      
      return new Response("Method not allowed", { status: 405 });
    });

    // API endpoints
    this.api.http.registerRoute("/api/setup/status", async (req: Request) => {
      if (req.method === "GET") {
        return this.getSetupStatus();
      }
      return new Response("Method not allowed", { status: 405 });
    });

    this.api.http.registerRoute("/api/setup/complete", async (req: Request) => {
      if (req.method === "POST") {
        return this.completeSetup(req);
      }
      return new Response("Method not allowed", { status: 405 });
    });

    console.log("[onboarding-wizard] Routes registered: /onboarding, /api/setup/*");
  }

  /**
   * Check if setup is needed and show warning
   */
  private async checkSetupNeeded(): Promise<void> {
    try {
      const status = await this.loadSetupStatus();
      
      if (!status.completed) {
        console.log("⚠️  [onboarding-wizard] SETUP REQUIRED: Visit http://localhost:3000/onboarding");
        console.log("⚠️  [onboarding-wizard] Some features may be disabled until setup is complete");
      }
    } catch (error) {
      console.error("[onboarding-wizard] Error checking setup status:", error);
    }
  }

  /**
   * Load setup status from file
   */
  private async loadSetupStatus(): Promise<any> {
    try {
      await access(this.setupFile);
      const content = await readFile(this.setupFile, "utf-8");
      return JSON.parse(content);
    } catch {
      // No setup file means setup not completed
      return { completed: false, steps: {} };
    }
  }

  /**
   * Save setup status to file
   */
  private async saveSetupStatus(status: any): Promise<void> {
    try {
      // Ensure config directory exists
      await mkdir(this.configDir, { recursive: true });
      await writeFile(this.setupFile, JSON.stringify(status, null, 2), "utf-8");
      console.log("[onboarding-wizard] Setup status saved successfully");
    } catch (error) {
      console.error("[onboarding-wizard] Error saving setup status:", error);
      throw error;
    }
  }

  /**
   * Get setup status API
   */
  private async getSetupStatus(): Promise<Response> {
    try {
      const status = await this.loadSetupStatus();
      const configValues = this.loadConfigValues();
      
      // Check which steps are complete (combine setup status + config)
      const steps = {
        adminUser: steps.adminUser || false,
        cliTools: steps.cliTools || false,
        aiConfig: steps.aiConfig || !!(configValues.ai.provider && configValues.ai.ollamaModel),
        platforms: steps.platforms || !!(configValues.telegram.enabled || configValues.discord.enabled)
      };
      
      return Response.json({
        completed: status.completed || (steps.adminUser && steps.cliTools && steps.aiConfig && steps.platforms),
        steps,
        config: configValues,
        progress: Object.values(steps).filter(Boolean).length / Object.values(steps).length
      });
    } catch (error) {
      return Response.json({ error: "Failed to load status" }, { status: 500 });
    }
  }

  /**
   * Handle setup submission
   */
  private async handleSetupSubmission(req: Request): Promise<Response> {
    try {
      console.log("[onboarding-wizard] Processing setup submission...");
      
      const formData = await req.formData();
      const step = formData.get("step") as string;
      
      console.log(`[onboarding-wizard] Step: ${step}`);
      
      if (!step) {
        console.error("[onboarding-wizard] No step specified");
        return new Response("No step specified", { status: 400 });
      }
      
      // Verify password
      const password = formData.get("password") as string;
      const authService = this.getAuthService();
      
      console.log(`[onboarding-wizard] Password provided: ${password ? 'yes' : 'no'}`);
      
      if (!authService.verifyPassword(password)) {
        console.warn("[onboarding-wizard] Invalid password attempt");
        return new Response("Invalid password", { status: 401 });
      }
      
      console.log("[onboarding-wizard] Password verified");
      
      // Ensure config directory exists
      await mkdir(this.configDir, { recursive: true });
      
      const status = await this.loadSetupStatus();
      console.log(`[onboarding-wizard] Current status:`, status);
      
      switch (step) {
        case "admin":
          console.log("[onboarding-wizard] Processing admin step");
          // Save admin users
          const telegramId = formData.get("telegramId") as string;
          const discordId = formData.get("discordId") as string;
          
          console.log(`[onboarding-wizard] Telegram ID: ${telegramId || 'none'}, Discord ID: ${discordId || 'none'}`);
          
          if (telegramId && telegramId.trim()) {
            await authService.addUser("telegram", telegramId.trim());
          }
          if (discordId && discordId.trim()) {
            await authService.addUser("discord", discordId.trim());
          }
          
          status.steps = status.steps || {};
          status.steps.adminUser = true;
          break;
          
        case "cli":
          console.log("[onboarding-wizard] Processing CLI step");
          // Mark CLI tools step as done
          status.steps = status.steps || {};
          status.steps.cliTools = true;
          break;
          
        case "ai":
          console.log("[onboarding-wizard] Processing AI step");
          // Mark AI config step as done
          status.steps = status.steps || {};
          status.steps.aiConfig = true;
          break;
          
        case "platforms":
          console.log("[onboarding-wizard] Processing platforms step");
          // Mark platforms step as done
          status.steps = status.steps || {};
          status.steps.platforms = true;
          break;
          
        default:
          console.error(`[onboarding-wizard] Unknown step: ${step}`);
          return new Response(`Unknown step: ${step}`, { status: 400 });
      }
      
      // Check if all steps are complete
      const allSteps = Object.values(status.steps || {});
      if (allSteps.length >= 4 && allSteps.every(Boolean)) {
        status.completed = true;
        console.log("✅ [onboarding-wizard] Setup completed!");
      }
      
      await this.saveSetupStatus(status);
      console.log("[onboarding-wizard] Setup status saved successfully");
      
      return new Response(null, {
        status: 302,
        headers: { "Location": "/onboarding?saved=true" }
      });
    } catch (error) {
      console.error("[onboarding-wizard] Error saving setup:", error);
      console.error("[onboarding-wizard] Error stack:", error instanceof Error ? error.stack : 'No stack');
      return new Response(`Failed to save setup: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
    }
  }

  /**
   * Complete setup
   */
  private async completeSetup(req: Request): Promise<Response> {
    try {
      const status = await this.loadSetupStatus();
      status.completed = true;
      await this.saveSetupStatus(status);
      
      return Response.json({ success: true });
    } catch (error) {
      return Response.json({ error: "Failed to complete setup" }, { status: 500 });
    }
  }

  /**
   * Get auth service reference
   */
  private getAuthService(): any {
    const config = this.api.config.get();
    const authFile = join(homedir(), ".ronin", "auth.json");
    
    return {
      verifyPassword: (pwd: string) => pwd === (config.password || "roninpass"),
      addUser: async (platform: string, userId: string) => {
        try {
          // Load existing auth data
          let authData: Record<string, string[]> = {};
          try {
            await access(authFile);
            const content = await readFile(authFile, "utf-8");
            authData = JSON.parse(content);
          } catch {
            // File doesn't exist yet, start fresh
          }
          
          // Add user to platform
          if (!authData[platform]) {
            authData[platform] = [];
          }
          
          if (!authData[platform].includes(userId)) {
            authData[platform].push(userId);
            await writeFile(authFile, JSON.stringify(authData, null, 2), "utf-8");
            console.log(`[onboarding-wizard] Added user ${userId} to ${platform}`);
          } else {
            console.log(`[onboarding-wizard] User ${userId} already exists in ${platform}`);
          }
        } catch (error) {
          console.error(`[onboarding-wizard] Error adding user:`, error);
          throw error;
        }
      }
    };
  }

  /**
   * Load config values for pre-populating form
   */
  private loadConfigValues(): any {
    try {
      const config = this.api.config.get();
      return {
        telegram: {
          botToken: config.telegram?.botToken || '',
          enabled: config.telegram?.enabled || false
        },
        discord: {
          botToken: config.discord?.botToken || '',
          enabled: config.discord?.enabled || false
        },
        ai: {
          ollamaModel: config.ai?.ollamaModel || 'qwen3:4b',
          openaiKey: config.ai?.openaiApiKey || '',
          provider: config.ai?.provider || 'ollama'
        }
      };
    } catch (error) {
      console.error("[onboarding-wizard] Error loading config:", error);
      return {
        telegram: { botToken: '', enabled: false },
        discord: { botToken: '', enabled: false },
        ai: { ollamaModel: 'qwen3:4b', openaiKey: '', provider: 'ollama' }
      };
    }
  }

  /**
   * Render the onboarding page
   */
  private async renderOnboardingPage(): Promise<Response> {
    const status = await this.loadSetupStatus();
    const config = this.loadConfigValues();
    
    // Compute step statuses based on both setup file and config
    const steps = {
      adminUser: status.steps?.adminUser || false,
      cliTools: status.steps?.cliTools || false,
      aiConfig: status.steps?.aiConfig || !!(config.ai.provider && config.ai.ollamaModel),
      platforms: status.steps?.platforms || !!(config.telegram.enabled || config.discord.enabled)
    };
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Setup Wizard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #eee;
      line-height: 1.6;
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    
    header {
      text-align: center;
      margin-bottom: 40px;
      padding: 40px 20px;
      background: rgba(233, 69, 96, 0.1);
      border-radius: 16px;
      border: 2px solid #e94560;
    }
    
    h1 {
      font-size: 2.5rem;
      color: #e94560;
      margin-bottom: 10px;
    }
    
    .subtitle {
      color: #888;
      font-size: 1.1rem;
    }
    
    .progress-bar {
      background: #16213e;
      height: 8px;
      border-radius: 4px;
      margin: 20px 0;
      overflow: hidden;
    }
    
    .progress-fill {
      background: linear-gradient(90deg, #e94560, #ff6b6b);
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }
    
    .steps {
      display: grid;
      gap: 20px;
    }
    
    .step {
      background: #16213e;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid transparent;
      transition: all 0.3s ease;
    }
    
    .step.pending {
      border-color: #e67e22;
    }
    
    .step.complete {
      border-color: #27ae60;
    }
    
    .step-header {
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 15px;
      cursor: pointer;
      background: #0f3460;
    }
    
    .step-number {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.2rem;
    }
    
    .step.pending .step-number {
      background: #e67e22;
      color: white;
    }
    
    .step.complete .step-number {
      background: #27ae60;
      color: white;
    }
    
    .step-title {
      flex: 1;
    }
    
    .step-title h3 {
      font-size: 1.2rem;
      margin-bottom: 5px;
    }
    
    .step-title p {
      color: #888;
      font-size: 0.9rem;
    }
    
    .step-status {
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    
    .step.pending .step-status {
      background: rgba(230, 126, 34, 0.2);
      color: #e67e22;
    }
    
    .step.complete .step-status {
      background: rgba(39, 174, 96, 0.2);
      color: #27ae60;
    }
    
    .step-content {
      padding: 20px;
      display: none;
    }
    
    .step-content.active {
      display: block;
    }
    
    .form-group {
      margin-bottom: 20px;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 8px;
      color: #ccc;
      font-weight: 500;
    }
    
    .form-group input,
    .form-group select {
      width: 100%;
      padding: 12px;
      background: #1a1a2e;
      border: 2px solid #0f3460;
      border-radius: 8px;
      color: #eee;
      font-size: 1rem;
    }
    
    .form-group input:focus,
    .form-group select:focus {
      outline: none;
      border-color: #e94560;
    }
    
    .btn {
      padding: 12px 30px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 500;
      transition: all 0.3s ease;
    }
    
    .btn-primary {
      background: #e94560;
      color: white;
    }
    
    .btn-primary:hover {
      background: #c73e54;
    }
    
    .btn-secondary {
      background: #0f3460;
      color: #eee;
    }
    
    .btn-secondary:hover {
      background: #1a4a7a;
    }
    
    .tool-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    
    .tool-card {
      background: #1a1a2e;
      padding: 20px;
      border-radius: 8px;
      border: 2px solid #0f3460;
      text-align: center;
      transition: all 0.3s ease;
    }
    
    .tool-card:hover {
      border-color: #e94560;
    }
    
    .tool-card h4 {
      margin-bottom: 10px;
      color: #eee;
    }
    
    .tool-card p {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 15px;
    }
    
    .tool-status {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 500;
    }
    
    .tool-status.installed {
      background: rgba(39, 174, 96, 0.2);
      color: #27ae60;
    }
    
    .tool-status.missing {
      background: rgba(230, 126, 34, 0.2);
      color: #e67e22;
    }
    
    .password-section {
      background: rgba(233, 69, 96, 0.1);
      border: 2px solid #e94560;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    
    .password-section h4 {
      color: #e94560;
      margin-bottom: 15px;
    }
    
    .info-box {
      background: rgba(15, 52, 96, 0.5);
      border-left: 4px solid #e94560;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 0 8px 8px 0;
    }
    
    .info-box p {
      color: #ccc;
      margin: 0;
    }
    
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 15px;
    }
    
    .checkbox-group input[type="checkbox"] {
      width: auto;
    }
    
    .complete-message {
      text-align: center;
      padding: 60px 20px;
      background: rgba(39, 174, 96, 0.1);
      border-radius: 16px;
      border: 2px solid #27ae60;
    }
    
    .complete-message h2 {
      color: #27ae60;
      font-size: 2rem;
      margin-bottom: 20px;
    }
    
    .complete-message p {
      color: #888;
      margin-bottom: 30px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 Ronin Setup Wizard</h1>
      <p class="subtitle">Configure your AI agent system</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${this.calculateProgress(status, steps)}%"></div>
      </div>
    </header>
    
    ${status.completed ? `
    <div class="complete-message">
      <h2>✅ Setup Complete!</h2>
      <p>Your Ronin system is configured and ready to use.</p>
      <a href="/" class="btn btn-primary">Go to Dashboard</a>
    </div>
    ` : `
    <div class="steps">
      <!-- Step 1: Admin Users -->
      <div class="step ${steps.adminUser ? 'complete' : 'pending'}">
        <div class="step-header" onclick="toggleStep(1)">
          <div class="step-number">1</div>
          <div class="step-title">
            <h3>Admin Users</h3>
            <p>Configure authorized users for each platform</p>
          </div>
          <div class="step-status">${steps.adminUser ? 'Complete' : 'Pending'}</div>
        </div>
        <div class="step-content ${!steps.adminUser ? 'active' : ''}" id="step-1">
          <div class="password-section">
            <h4>🔐 Authentication Required</h4>
            <p>Enter the Ronin password to modify settings:</p>
            <div class="form-group">
              <input type="password" id="password" placeholder="Enter password" required>
            </div>
          </div>
          
          <form method="POST" action="/onboarding">
            <input type="hidden" name="step" value="admin">
            <input type="hidden" name="password" id="form-password">
            
            <div class="form-group">
              <label>Telegram User ID</label>
              <input type="text" name="telegramId" placeholder="e.g., 123456789">
              <small style="color: #888; display: block; margin-top: 5px;">Your Telegram user ID (get it from @userinfobot)</small>
            </div>
            
            <div class="form-group">
              <label>Discord User ID</label>
              <input type="text" name="discordId" placeholder="e.g., 123456789012345678">
              <small style="color: #888; display: block; margin-top: 5px;">Your Discord user ID (enable Developer Mode in settings)</small>
            </div>
            
            <div class="info-box">
              <p>💡 <strong>Security Note:</strong> These users will have full control over your Ronin system. Only add trusted accounts.</p>
            </div>
            
            <button type="submit" class="btn btn-primary" onclick="return validatePassword()">Save Admin Users</button>
          </form>
        </div>
      </div>
      
      <!-- Step 2: CLI Tools -->
      <div class="step ${steps.cliTools ? 'complete' : 'pending'}">
        <div class="step-header" onclick="toggleStep(2)">
          <div class="step-number">2</div>
          <div class="step-title">
            <h3>CLI Tools</h3>
            <p>Install and configure code generation tools</p>
          </div>
          <div class="step-status">${steps.cliTools ? 'Complete' : 'Pending'}</div>
        </div>
        <div class="step-content ${steps.adminUser && !steps.cliTools ? 'active' : ''}" id="step-2">
          <div class="tool-grid">
            <div class="tool-card">
              <h4>Opencode</h4>
              <p>Open-source code generation</p>
              <span class="tool-status installed">✓ Installed</span>
            </div>
            <div class="tool-card">
              <h4>Cursor CLI</h4>
              <p>AI-powered editor</p>
              <span class="tool-status missing">⚠ Not installed</span>
            </div>
            <div class="tool-card">
              <h4>Qwen CLI</h4>
              <p>Qwen model integration</p>
              <span class="tool-status installed">✓ Installed</span>
            </div>
          </div>
          
          <form method="POST" action="/onboarding">
            <input type="hidden" name="step" value="cli">
            <input type="hidden" name="password" value="roninpass">
            
            <div class="checkbox-group">
              <input type="checkbox" id="skip-cli" name="skip" checked>
              <label for="skip-cli">Skip for now (can be installed later)</label>
            </div>
            
            <button type="submit" class="btn btn-primary">Continue</button>
          </form>
        </div>
      </div>
      
      <!-- Step 3: AI Configuration -->
      <div class="step ${steps.aiConfig ? 'complete' : 'pending'}">
        <div class="step-header" onclick="toggleStep(3)">
          <div class="step-number">3</div>
          <div class="step-title">
            <h3>AI Configuration</h3>
            <p>Set up your preferred AI models</p>
          </div>
          <div class="step-status">${steps.aiConfig ? 'Complete' : 'Pending'}</div>
        </div>
        <div class="step-content ${steps.cliTools && !steps.aiConfig ? 'active' : ''}" id="step-3">
          <form method="POST" action="/onboarding">
            <input type="hidden" name="step" value="ai">
            <input type="hidden" name="password" value="roninpass">
            
            <div class="form-group">
              <label>Primary AI Model</label>
              <select name="aiModel">
                <option value="ollama" ${config.ai.provider === 'ollama' ? 'selected' : ''}>Ollama (Local)</option>
                <option value="openai" ${config.ai.provider === 'openai' ? 'selected' : ''}>OpenAI GPT</option>
                <option value="anthropic" ${config.ai.provider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
              </select>
              <small style="color: #888; display: block; margin-top: 5px;">Current: ${config.ai.ollamaModel}</small>
            </div>
            
            <div class="form-group">
              <label>API Key (Optional)</label>
              <input type="password" name="apiKey" placeholder="Leave empty to configure later" value="${config.ai.openaiKey ? '••••••••••••' : ''}">
              <small style="color: #888; display: block; margin-top: 5px;">${config.ai.openaiKey ? '✓ API key configured' : 'Only needed for cloud models. Stored securely.'}</small>
            </div>
            
            <div class="checkbox-group">
              <input type="checkbox" id="skip-ai" name="skip" checked>
              <label for="skip-ai">Configure AI later</label>
            </div>
            
            <button type="submit" class="btn btn-primary">Continue</button>
          </form>
        </div>
      </div>
      
      <!-- Step 4: Communication Platforms -->
      <div class="step ${steps.platforms ? 'complete' : 'pending'}">
        <div class="step-header" onclick="toggleStep(4)">
          <div class="step-number">4</div>
          <div class="step-title">
            <h3>Communication Platforms</h3>
            <p>Connect Telegram, Discord, and more</p>
          </div>
          <div class="step-status">${steps.platforms ? 'Complete' : 'Pending'}</div>
        </div>
        <div class="step-content ${steps.aiConfig && !steps.platforms ? 'active' : ''}" id="step-4">
          <form method="POST" action="/onboarding">
            <input type="hidden" name="step" value="platforms">
            <input type="hidden" name="password" value="roninpass">
            
            <div class="form-group">
              <label>Telegram Bot Token ${config.telegram.enabled ? '✓' : ''}</label>
              <input type="password" name="telegramToken" placeholder="Get from @BotFather" value="${config.telegram.botToken ? '••••••••••••' : ''}">
              <small style="color: #888; display: block; margin-top: 5px;">${config.telegram.enabled ? '✓ Bot configured and enabled' : 'Enter token from @BotFather to enable Telegram'}</small>
            </div>
            
            <div class="form-group">
              <label>Discord Bot Token ${config.discord.enabled ? '✓' : ''}</label>
              <input type="password" name="discordToken" placeholder="From Discord Developer Portal" value="${config.discord.botToken ? '••••••••••••' : ''}">
              <small style="color: #888; display: block; margin-top: 5px;">${config.discord.enabled ? '✓ Bot configured and enabled' : 'Enter token from Discord Developer Portal to enable Discord'}</small>
            </div>
            
            <div class="info-box">
              <p>💡 Bots allow Ronin to communicate with you through these platforms. Tokens are stored securely in your config.</p>
            </div>
            
            <div class="checkbox-group">
              <input type="checkbox" id="skip-platforms" name="skip" ${!config.telegram.enabled && !config.discord.enabled ? 'checked' : ''}>
              <label for="skip-platforms">Skip platform configuration ${config.telegram.enabled || config.discord.enabled ? '(already configured)' : ''}</label>
            </div>
            
            <button type="submit" class="btn btn-primary">Complete Setup</button>
          </form>
        </div>
      </div>
    </div>
    `}
  </div>
  
  <script>
    function toggleStep(stepNum) {
      const content = document.getElementById('step-' + stepNum);
      content.classList.toggle('active');
    }
    
    function validatePassword() {
      const password = document.getElementById('password').value;
      if (!password) {
        alert('Please enter the password');
        return false;
      }
      document.getElementById('form-password').value = password;
      return true;
    }
    
    // Auto-expand first incomplete step
    document.addEventListener('DOMContentLoaded', () => {
      const steps = document.querySelectorAll('.step');
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].classList.contains('pending')) {
          const content = steps[i].querySelector('.step-content');
          if (content) {
            content.classList.add('active');
          }
          break;
        }
      }
    });
  </script>
</body>
</html>`;
    
    return new Response(html, {
      headers: { "Content-Type": "text/html" }
    });
  }

  /**
   * Calculate setup progress percentage
   */
  private calculateProgress(status: any, steps?: any): number {
    if (status.completed) return 100;
    
    const stepData = steps || status.steps || {};
    const totalSteps = 4;
    const completedSteps = Object.values(stepData).filter(Boolean).length;
    
    return Math.round((completedSteps / totalSteps) * 100);
  }

  async execute(): Promise<void> {
    // Wizard agent, no scheduled execution
    console.log("[onboarding-wizard] Onboarding Wizard running");
  }
}