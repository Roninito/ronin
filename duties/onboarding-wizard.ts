import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { kiosaTheme } from "../src/utils/theme.js";
import { getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaStylesheetLink } from "../src/utils/kiosa.js";

/**
 * Onboarding Wizard Agent
 * 
 * Provides a web-based setup wizard for first-time configuration.
 * Guides users through essential setup steps with visual progress indicators.
 */
export default class OnboardingWizardAgent extends BaseDuty {
  static webhook = "/onboarding";
  
  private configDir: string;
  private setupFile: string;

  constructor(api: DutyAPI) {
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
          ai: { ollamaModel: 'ministral-3:3b', openaiKey: '', provider: 'ollama' },
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
          // Persist Brave Search API key if provided
          const braveSearchApiKey = formData.get("braveSearchApiKey") as string;
          if (braveSearchApiKey && braveSearchApiKey.trim()) {
            try {
              const configPath = join(this.configDir, "config.json");
              let fileConfig: Record<string, unknown> = {};
              try {
                await access(configPath);
                const content = await readFile(configPath, "utf-8");
                fileConfig = JSON.parse(content);
              } catch {
                // File doesn't exist or invalid, start fresh
              }
              if (!fileConfig.braveSearch || typeof fileConfig.braveSearch !== "object") {
                fileConfig.braveSearch = { apiKey: "" };
              }
              (fileConfig.braveSearch as Record<string, string>).apiKey = braveSearchApiKey.trim();
              await writeFile(configPath, JSON.stringify(fileConfig, null, 2), "utf-8");
            } catch (err) {
              console.error("[onboarding-wizard] Failed to save Brave Search API key:", err);
            }
          }
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
    const config = this.api.config.getAll();
    const authFile = join(homedir(), ".ronin", "auth.json");
    
    return {
      verifyPassword: (pwd: string) => pwd === (config.configEditor?.password || "roninpass"),
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
      const config = this.api.config.getAll();
      
      // Check CLI tools
      const cliTools = await this.checkCliToolsInstalled();
      
      return {
        telegram: {
          botToken: config.telegram?.botToken || '',
          enabled: !!config.telegram?.botToken
        },
        discord: {
          botToken: config.discord?.botToken || '',
          enabled: config.discord?.enabled || false
        },
        ai: {
          ollamaModel: config.ai?.ollamaModel || 'ministral-3:3b',
          openaiKey: config.ai?.openai?.apiKey || '',
          provider: config.ai?.provider || 'ollama'
        },
        braveSearch: {
          apiKey: config.braveSearch?.apiKey || ''
        },
        cliTools
      };
    } catch (error) {
      console.error("[onboarding-wizard] Error loading config:", error);
      return {
        telegram: { botToken: '', enabled: false },
        discord: { botToken: '', enabled: false },
        ai: { ollamaModel: 'ministral-3:3b', openaiKey: '', provider: 'ollama' },
        braveSearch: { apiKey: '' },
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
    
    const accent = getKiosaAccentForPath("/onboarding");
    const accentHex = kiosaTheme.colors.accent;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Setup</title>
  ${getKiosaStylesheetLink(accent)}
  <style>

    body {
      margin: 0;
      min-height: 100vh;
    }

    .kiosa-wrap {
      max-width: 760px;
      margin: 0 auto;
      padding: 22px;
    }

    .kiosa-header {
      margin-bottom: 22px;
      padding-bottom: 16px;
      border-bottom: 1px solid ${kiosaTheme.colors.border};
    }

    .kiosa-header h1 {
      font-family: ${kiosaTheme.fonts.primary};
      font-size: 26px;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }

    .subtitle {
      color: ${kiosaTheme.colors.textSecondary};
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .progress-bar {
      background: ${kiosaTheme.colors.border};
      height: 4px;
      margin: 16px 0;
      border-radius: 1px;
      overflow: hidden;
    }

    .progress-fill {
      background: ${accentHex};
      height: 100%;
      box-shadow: 0 0 8px ${accentHex};
      transition: width 0.3s ease;
    }

    .steps {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .step {
      background: ${kiosaTheme.colors.backgroundSecondary};
      border: 1px solid ${kiosaTheme.colors.border};
      border-radius: 3px;
      transition: border-color 150ms ease, background 150ms ease;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .step:hover {
      border-color: ${kiosaTheme.colors.borderHover};
    }

    .step.complete {
      border-color: color-mix(in srgb, ${kiosaTheme.colors.success} 50%, transparent);
      background: color-mix(in srgb, ${kiosaTheme.colors.success} 5%, ${kiosaTheme.colors.backgroundSecondary});
    }

    .step-header {
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }

    .step-number {
      width: 22px;
      height: 22px;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      background: ${kiosaTheme.colors.backgroundTertiary};
      color: ${kiosaTheme.colors.textSecondary};
      font-family: ${kiosaTheme.fonts.mono};
      border: 1px solid ${kiosaTheme.colors.border};
    }

    .step.complete .step-number {
      background: color-mix(in srgb, ${kiosaTheme.colors.success} 15%, transparent);
      border-color: color-mix(in srgb, ${kiosaTheme.colors.success} 50%, transparent);
      color: ${kiosaTheme.colors.success};
    }

    .step-title {
      flex: 1;
    }

    .step-title h3 {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 2px;
      font-family: ${kiosaTheme.fonts.primary};
    }

    .step-title p {
      color: ${kiosaTheme.colors.textTertiary};
      font-size: 10px;
      letter-spacing: 0.08em;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .step-status {
      font-size: 9px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${kiosaTheme.colors.textTertiary};
      font-family: ${kiosaTheme.fonts.mono};
    }

    .step.complete .step-status {
      color: ${kiosaTheme.colors.success};
    }

    .step-content {
      padding: 0 12px 12px;
      display: none;
    }

    .step-content.active {
      display: block;
    }

    .form-group {
      margin-bottom: 12px;
    }

    .form-group label {
      display: block;
      margin-bottom: 5px;
      color: ${kiosaTheme.colors.textSecondary};
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .form-group input,
    .form-group select {
      width: 100%;
      padding: 8px;
      background: ${kiosaTheme.colors.background};
      border: 1px solid ${kiosaTheme.colors.border};
      color: ${kiosaTheme.colors.textPrimary};
      font-size: 12px;
      font-family: ${kiosaTheme.fonts.mono};
      border-radius: 2px;
      box-sizing: border-box;
    }

    .form-group input:focus,
    .form-group select:focus {
      outline: none;
      border-color: ${accentHex};
      box-shadow: 0 0 8px color-mix(in srgb, ${accentHex} 25%, transparent);
    }

    .btn {
      padding: 6px 10px;
      background: ${kiosaTheme.colors.backgroundSecondary};
      border: 1px solid ${kiosaTheme.colors.border};
      color: ${kiosaTheme.colors.textSecondary};
      font-size: 10px;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      border-radius: 2px;
      font-family: ${kiosaTheme.fonts.mono};
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .btn:hover {
      background: ${kiosaTheme.colors.backgroundTertiary};
      border-color: ${kiosaTheme.colors.borderHover};
      color: ${kiosaTheme.colors.textPrimary};
    }

    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-primary {
      background: color-mix(in srgb, ${accentHex} 15%, transparent);
      border-color: ${accentHex};
      color: ${accentHex};
    }

    .btn-primary:hover:not(:disabled) {
      background: ${accentHex};
      color: ${kiosaTheme.colors.background};
    }

    .password-section {
      padding: 12px;
      background: ${kiosaTheme.colors.background};
      border: 1px solid ${kiosaTheme.colors.border};
      margin-bottom: 12px;
      border-radius: 3px;
    }

    .password-section h4 {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 10px;
      color: ${kiosaTheme.colors.textPrimary};
      font-family: ${kiosaTheme.fonts.primary};
    }

    .info-box {
      padding: 10px;
      background: ${kiosaTheme.colors.background};
      border-left: 2px solid ${accentHex};
      margin-bottom: 12px;
      font-size: 11px;
      color: ${kiosaTheme.colors.textSecondary};
      font-family: ${kiosaTheme.fonts.mono};
      line-height: 1.5;
    }

    small {
      font-size: 10px;
      color: ${kiosaTheme.colors.textTertiary};
      display: block;
      margin-top: 4px;
      font-family: ${kiosaTheme.fonts.mono};
    }

    code {
      font-family: ${kiosaTheme.fonts.mono};
      font-size: 10px;
      background: ${kiosaTheme.colors.backgroundTertiary};
      padding: 2px 5px;
      border-radius: 2px;
      color: ${accentHex};
    }

    .checkbox-group input[type="checkbox"] {
      width: auto;
    }
  </style>
</head>
<body>
  ${getKiosaTopbarHTML({ title: "RONIN", subtitle: "SETUP / ONBOARDING", rightMeta: `PROGRESS ${this.calculateProgress(status, steps)}%` })}
  <div class="kiosa-wrap">
    <div class="kiosa-header">
      <h1>SETUP WIZARD</h1>
      <p class="subtitle">Configure your AI agent system</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${this.calculateProgress(status, steps)}%"></div>
      </div>
    </div>
    
    ${status.completed ? `
    <div style="text-align: center; padding: 24px; border: 1px solid color-mix(in srgb, ${kiosaTheme.colors.success} 50%, transparent); background: color-mix(in srgb, ${kiosaTheme.colors.success} 5%, transparent); border-radius: 3px;">
      <h2 style="font-size: 16px; font-weight: 700; color: ${kiosaTheme.colors.success}; margin-bottom: 8px; letter-spacing: .04em; text-transform: uppercase; font-family: ${kiosaTheme.fonts.primary};">Setup Complete</h2>
      <p style="color: ${kiosaTheme.colors.textSecondary}; margin-bottom: 18px; font-family: ${kiosaTheme.fonts.mono}; font-size: 11px;">Your Ronin system is configured and ready to use.</p>
      <a href="/" class="btn btn-primary" style="text-decoration: none;">GO TO DASHBOARD</a>
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
           <div style="display: flex; gap: 8px; margin-bottom: 12px; font-family: ${kiosaTheme.fonts.mono};">
            <div style="flex: 1; padding: 10px; background: ${kiosaTheme.colors.background}; border: 1px solid ${config.cliTools.opencode ? `color-mix(in srgb, ${kiosaTheme.colors.success} 50%, transparent)` : kiosaTheme.colors.border}; border-radius: 2px;">
              <div style="font-size: 11px; margin-bottom: 4px; letter-spacing: .1em; text-transform: uppercase;">Opencode</div>
              <div style="font-size: 10px; color: ${config.cliTools.opencode ? kiosaTheme.colors.success : kiosaTheme.colors.textTertiary};">${config.cliTools.opencode ? '[OK] Installed' : 'Not installed'}</div>
            </div>
            <div style="flex: 1; padding: 10px; background: ${kiosaTheme.colors.background}; border: 1px solid ${config.cliTools.cursor ? `color-mix(in srgb, ${kiosaTheme.colors.success} 50%, transparent)` : kiosaTheme.colors.border}; border-radius: 2px;">
              <div style="font-size: 11px; margin-bottom: 4px; letter-spacing: .1em; text-transform: uppercase;">Cursor</div>
              <div style="font-size: 10px; color: ${config.cliTools.cursor ? kiosaTheme.colors.success : kiosaTheme.colors.textTertiary};">${config.cliTools.cursor ? '[OK] Installed' : 'Not installed'}</div>
            </div>
            <div style="flex: 1; padding: 10px; background: ${kiosaTheme.colors.background}; border: 1px solid ${config.cliTools.qwen ? `color-mix(in srgb, ${kiosaTheme.colors.success} 50%, transparent)` : kiosaTheme.colors.border}; border-radius: 2px;">
              <div style="font-size: 11px; margin-bottom: 4px; letter-spacing: .1em; text-transform: uppercase;">Qwen</div>
              <div style="font-size: 10px; color: ${config.cliTools.qwen ? kiosaTheme.colors.success : kiosaTheme.colors.textTertiary};">${config.cliTools.qwen ? '[OK] Installed' : 'Not installed'}</div>
            </div>
          </div>

          ${!config.cliTools.anyInstalled ? `
          <div style="padding: 10px; background: color-mix(in srgb, ${kiosaTheme.colors.warning} 9%, transparent); border: 1px solid color-mix(in srgb, ${kiosaTheme.colors.warning} 45%, transparent); border-radius: 2px; margin-bottom: 12px; font-size: 11px; color: ${kiosaTheme.colors.warning}; font-family: ${kiosaTheme.fonts.mono}; line-height: 1.5;">
            No CLI tools detected. Install at least one: <code style="background: ${kiosaTheme.colors.backgroundTertiary}; padding: 2px 5px;">npm install -g opencode</code> or <code style="background: ${kiosaTheme.colors.backgroundTertiary}; padding: 2px 5px;">npm install -g @anthropic-ai/qwen-cli</code>
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
             
             <div class="form-group">
               <label>Brave Search API Key (Optional)</label>
               <input type="password" name="braveSearchApiKey" placeholder="Get from brave.com/search/api" value="${config.braveSearch?.apiKey ? '••••••••••••' : ''}">
               <small>Enables web search via MCP. Add with: ronin mcp add brave-search</small>
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
    ${getKiosaFooterHTML("RONIN · SETUP", "ONBOARDING · V0.1")}
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