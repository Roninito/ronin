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
      
      // Load config values safely
      let configValues;
      try {
        configValues = await this.loadConfigValues();
      } catch (configError) {
        console.error("[onboarding-wizard] Error loading config in getSetupStatus:", configError);
        configValues = {
          telegram: { botToken: '', enabled: false },
          discord: { botToken: '', enabled: false },
          ai: { ollamaModel: 'qwen3:4b', openaiKey: '', provider: 'ollama' },
          cliTools: { opencode: false, cursor: false, qwen: false, anyInstalled: false }
        };
      }
      
      // Check which steps are complete (combine setup status + config)
      const steps = {
        adminUser: status.steps?.adminUser || false,
        cliTools: status.steps?.cliTools || configValues.cliTools.anyInstalled,
        aiConfig: status.steps?.aiConfig || !!(configValues.ai.provider && configValues.ai.ollamaModel),
        platforms: status.steps?.platforms || !!(configValues.telegram.enabled || configValues.discord.enabled)
      };
      
      return Response.json({
        completed: status.completed || (steps.adminUser && steps.cliTools && steps.aiConfig && steps.platforms),
        steps,
        config: configValues,
        progress: Object.values(steps).filter(Boolean).length / Object.values(steps).length
      });
    } catch (error) {
      console.error("[onboarding-wizard] Error in getSetupStatus:", error);
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
    // Use getAll() to get the full config object
    const config = this.api.config.getAll ? this.api.config.getAll() : this.api.config;
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
   * Check if at least one CLI tool is installed
   */
  private async checkCliToolsInstalled(): Promise<{ opencode: boolean; cursor: boolean; qwen: boolean; anyInstalled: boolean }> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const tools = { opencode: false, cursor: false, qwen: false, anyInstalled: false };
    
    try {
      // Check opencode
      try {
        await execAsync('which opencode');
        tools.opencode = true;
      } catch { /* not installed */ }
      
      // Check cursor
      try {
        await execAsync('which cursor');
        tools.cursor = true;
      } catch { /* not installed */ }
      
      // Check qwen
      try {
        await execAsync('which qwen');
        tools.qwen = true;
      } catch { /* not installed */ }
      
      tools.anyInstalled = tools.opencode || tools.cursor || tools.qwen;
      
      return tools;
    } catch (error) {
      console.error("[onboarding-wizard] Error checking CLI tools:", error);
      return tools;
    }
  }

  /**
   * Load config values for pre-populating form
   */
  private async loadConfigValues(): Promise<any> {
    try {
      // Use getAll() to get the full config object
      const config = this.api.config.getAll ? this.api.config.getAll() : this.api.config;
      
      // Check CLI tools
      const cliTools = await this.checkCliToolsInstalled();
      
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
        },
        cliTools
      };
    } catch (error) {
      console.error("[onboarding-wizard] Error loading config:", error);
      return {
        telegram: { botToken: '', enabled: false },
        discord: { botToken: '', enabled: false },
        ai: { ollamaModel: 'qwen3:4b', openaiKey: '', provider: 'ollama' },
        cliTools: { opencode: false, cursor: false, qwen: false, anyInstalled: false }
      };
    }
  }

  /**
   * Render the onboarding page
   */
  private async renderOnboardingPage(): Promise<Response> {
    const status = await this.loadSetupStatus();
    const config = await this.loadConfigValues();
    
    // Compute step statuses based on both setup file and config
    const steps = {
      adminUser: status.steps?.adminUser || false,
      cliTools: status.steps?.cliTools || config.cliTools.anyInstalled,
      aiConfig: status.steps?.aiConfig || !!(config.ai.provider && config.ai.ollamaModel),
      platforms: status.steps?.platforms || !!(config.telegram.enabled || config.discord.enabled)
    };
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Adobe Clean', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0a0a0a;
      color: #ffffff;
      line-height: 1.6;
      min-height: 100vh;
      padding: 2rem;
    }
    
    .container {
      max-width: 700px;
      margin: 0 auto;
    }
    
    header {
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    h1 {
      font-size: 1.75rem;
      font-weight: 300;
      margin-bottom: 0.5rem;
    }
    
    .subtitle {
      color: rgba(255, 255, 255, 0.6);
      font-size: 0.875rem;
    }
    
    .progress-bar {
      background: rgba(255, 255, 255, 0.04);
      height: 2px;
      margin: 1.5rem 0;
    }
    
    .progress-fill {
      background: #e94560;
      height: 100%;
      transition: width 0.3s ease;
    }
    
    .steps {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .step {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: all 0.2s;
    }
    
    .step:hover {
      border-color: rgba(255, 255, 255, 0.12);
    }
    
    .step.complete {
      border-color: rgba(39, 174, 96, 0.4);
    }
    
    .step-header {
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      cursor: pointer;
    }
    
    .step-number {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.6);
    }
    
    .step.complete .step-number {
      background: rgba(39, 174, 96, 0.2);
      color: #27ae60;
    }
    
    .step-title {
      flex: 1;
    }
    
    .step-title h3 {
      font-size: 0.9375rem;
      font-weight: 400;
      margin-bottom: 0.125rem;
    }
    
    .step-title p {
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.8125rem;
    }
    
    .step-status {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.4);
    }
    
    .step.complete .step-status {
      color: #27ae60;
    }
    
    .step-content {
      padding: 0 1.25rem 1.25rem;
      display: none;
    }
    
    .step-content.active {
      display: block;
    }
    
    .form-group {
      margin-bottom: 1rem;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 0.375rem;
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.8125rem;
    }
    
    .form-group input,
    .form-group select {
      width: 100%;
      padding: 0.625rem 0.875rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #ffffff;
      font-size: 0.875rem;
      font-family: inherit;
    }
    
    .form-group input:focus,
    .form-group select:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.2);
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
    
    .btn {
      padding: 0.625rem 1.25rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.8);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
    }
    
    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    
    .btn-primary {
      background: rgba(233, 69, 96, 0.15);
      border-color: rgba(233, 69, 96, 0.4);
      color: #e94560;
    }
    
    .btn-primary:hover:not(:disabled) {
      background: rgba(233, 69, 96, 0.25);
    }
    
    .password-section {
      padding: 1rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 1rem;
    }
    
    .password-section h4 {
      font-size: 0.875rem;
      font-weight: 400;
      margin-bottom: 0.75rem;
      color: rgba(255, 255, 255, 0.9);
    }
    
    .info-box {
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.02);
      border-left: 2px solid rgba(255, 255, 255, 0.2);
      margin-bottom: 1rem;
      font-size: 0.8125rem;
      color: rgba(255, 255, 255, 0.6);
    }
    
    small {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.5);
      display: block;
      margin-top: 0.25rem;
    }
    
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      background: rgba(255, 255, 255, 0.06);
      padding: 0.125rem 0.375rem;
    }
    
    .checkbox-group input[type="checkbox"] {
      width: auto;
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
    <div style="text-align: center; padding: 3rem; border: 1px solid rgba(39, 174, 96, 0.4);">
      <h2 style="font-size: 1.25rem; font-weight: 400; color: #27ae60; margin-bottom: 0.5rem;">Setup Complete</h2>
      <p style="color: rgba(255,255,255,0.6); margin-bottom: 1.5rem;">Your Ronin system is configured and ready to use.</p>
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
               <small>Your Telegram user ID (get it from @userinfobot)</small>
             </div>
             
             <div class="form-group">
               <label>Discord User ID</label>
               <input type="text" name="discordId" placeholder="e.g., 123456789012345678">
               <small>Your Discord user ID (enable Developer Mode in settings)</small>
             </div>
             
             <div class="info-box">
               Security Note: These users will have full control over your Ronin system. Only add trusted accounts.
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
            <p>At least one code generation tool required</p>
          </div>
          <div class="step-status">${steps.cliTools ? 'Complete' : 'Pending'}</div>
        </div>
        <div class="step-content ${steps.adminUser && !steps.cliTools ? 'active' : ''}" id="step-2">
          <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
            <div style="flex: 1; padding: 0.75rem; background: rgba(255,255,255,0.02); border: 1px solid ${config.cliTools.opencode ? 'rgba(39, 174, 96, 0.4)' : 'rgba(255,255,255,0.08)'};">
              <div style="font-size: 0.8125rem; margin-bottom: 0.25rem;">Opencode</div>
              <div style="font-size: 0.75rem; color: ${config.cliTools.opencode ? '#27ae60' : 'rgba(255,255,255,0.4)'};">${config.cliTools.opencode ? '✓ Installed' : 'Not installed'}</div>
            </div>
            <div style="flex: 1; padding: 0.75rem; background: rgba(255,255,255,0.02); border: 1px solid ${config.cliTools.cursor ? 'rgba(39, 174, 96, 0.4)' : 'rgba(255,255,255,0.08)'};">
              <div style="font-size: 0.8125rem; margin-bottom: 0.25rem;">Cursor</div>
              <div style="font-size: 0.75rem; color: ${config.cliTools.cursor ? '#27ae60' : 'rgba(255,255,255,0.4)'};">${config.cliTools.cursor ? '✓ Installed' : 'Not installed'}</div>
            </div>
            <div style="flex: 1; padding: 0.75rem; background: rgba(255,255,255,0.02); border: 1px solid ${config.cliTools.qwen ? 'rgba(39, 174, 96, 0.4)' : 'rgba(255,255,255,0.08)'};">
              <div style="font-size: 0.8125rem; margin-bottom: 0.25rem;">Qwen</div>
              <div style="font-size: 0.75rem; color: ${config.cliTools.qwen ? '#27ae60' : 'rgba(255,255,255,0.4)'};">${config.cliTools.qwen ? '✓ Installed' : 'Not installed'}</div>
            </div>
          </div>
          
          ${!config.cliTools.anyInstalled ? `
          <div style="padding: 0.75rem; background: rgba(230, 126, 34, 0.1); border: 1px solid rgba(230, 126, 34, 0.3); margin-bottom: 1rem; font-size: 0.8125rem; color: rgba(255,255,255,0.7);">
            No CLI tools detected. Install at least one: <code style="background: rgba(255,255,255,0.08); padding: 0.125rem 0.375rem;">npm install -g opencode</code> or <code style="background: rgba(255,255,255,0.08); padding: 0.125rem 0.375rem;">npm install -g @anthropic-ai/qwen-cli</code>
          </div>
          ` : ''}
          
          <form method="POST" action="/onboarding">
            <input type="hidden" name="step" value="cli">
            <input type="hidden" name="password" value="roninpass">
            <button type="submit" class="btn btn-primary" ${!config.cliTools.anyInstalled ? 'disabled' : ''}>Continue</button>
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
               <small>Current: ${config.ai.ollamaModel}</small>
             </div>
             
             <div class="form-group">
               <label>API Key (Optional)</label>
               <input type="password" name="apiKey" placeholder="Leave empty to configure later" value="${config.ai.openaiKey ? '••••••••••••' : ''}">
               <small>${config.ai.openaiKey ? '✓ API key configured' : 'Only needed for cloud models. Stored securely.'}</small>
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
               <small>${config.telegram.enabled ? '✓ Bot configured and enabled' : 'Enter token from @BotFather to enable Telegram'}</small>
             </div>
             
             <div class="form-group">
               <label>Discord Bot Token ${config.discord.enabled ? '✓' : ''}</label>
               <input type="password" name="discordToken" placeholder="From Discord Developer Portal" value="${config.discord.botToken ? '••••••••••••' : ''}">
               <small>${config.discord.enabled ? '✓ Bot configured and enabled' : 'Enter token from Discord Developer Portal to enable Discord'}</small>
             </div>
             
             <div class="info-box">
               Bots allow Ronin to communicate with you through these platforms. Tokens are stored securely in your config.
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