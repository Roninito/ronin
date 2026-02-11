import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Authentication Service
 * 
 * Centralized authentication and authorization management for all platforms.
 * Ensures only authorized users can interact with the Ronin system.
 */
export default class AuthService extends BaseAgent {
  private authDir: string;
  private authFile: string;
  private cache: Map<string, Set<string>> = new Map();
  private configPassword: string = "roninpass"; // Default, will be overridden from config

  constructor(api: AgentAPI) {
    super(api);
    
    this.authDir = join(homedir(), ".ronin");
    this.authFile = join(this.authDir, "auth.json");
    
    // Load config password
    this.loadConfigPassword();
    
    // Initialize auth storage
    this.initializeAuthStorage();
    
    console.log("[auth-service] Authentication Service initialized");
  }

  /**
   * Load password from main config
   */
  private async loadConfigPassword(): Promise<void> {
    try {
      const config = this.api.config.get();
      if (config.password) {
        this.configPassword = config.password;
      }
    } catch (error) {
      console.log("[auth-service] Using default password");
    }
  }

  /**
   * Get the authentication password
   */
  public getPassword(): string {
    return this.configPassword;
  }

  /**
   * Verify password
   */
  public verifyPassword(password: string): boolean {
    return password === this.configPassword;
  }

  /**
   * Initialize authentication storage
   */
  private async initializeAuthStorage(): Promise<void> {
    try {
      // Ensure auth directory exists
      await mkdir(this.authDir, { recursive: true });
      
      // Load existing auth data
      await this.loadAuthData();
      
      console.log("[auth-service] Auth storage initialized");
    } catch (error) {
      console.error("[auth-service] Error initializing auth storage:", error);
    }
  }

  /**
   * Load authentication data from file
   */
  private async loadAuthData(): Promise<void> {
    try {
      await access(this.authFile);
      const content = await readFile(this.authFile, "utf-8");
      const data = JSON.parse(content);
      
      // Convert arrays to Sets for efficient lookup
      for (const [platform, users] of Object.entries(data)) {
        if (Array.isArray(users)) {
          this.cache.set(platform, new Set(users as string[]));
        }
      }
      
      console.log(`[auth-service] Loaded auth data for ${this.cache.size} platforms`);
    } catch (error) {
      // File doesn't exist yet, start with empty cache
      console.log("[auth-service] No existing auth data found, starting fresh");
    }
  }

  /**
   * Save authentication data to file
   */
  private async saveAuthData(): Promise<void> {
    try {
      // Convert Sets to arrays for JSON serialization
      const data: Record<string, string[]> = {};
      for (const [platform, users] of this.cache) {
        data[platform] = Array.from(users);
      }
      
      await writeFile(this.authFile, JSON.stringify(data, null, 2), "utf-8");
      console.log("[auth-service] Auth data saved");
    } catch (error) {
      console.error("[auth-service] Error saving auth data:", error);
      throw error;
    }
  }

  /**
   * Check if a user is authorized for a specific platform
   */
  public isAuthorized(platform: string, userId: string): boolean {
    const users = this.cache.get(platform);
    if (!users) {
      return false;
    }
    return users.has(userId);
  }

  /**
   * Add a user to the authorized list for a platform
   */
  public async addUser(platform: string, userId: string): Promise<void> {
    if (!this.cache.has(platform)) {
      this.cache.set(platform, new Set());
    }
    
    const users = this.cache.get(platform)!;
    users.add(userId);
    
    await this.saveAuthData();
    console.log(`[auth-service] Added user ${userId} to ${platform}`);
  }

  /**
   * Remove a user from the authorized list for a platform
   */
  public async removeUser(platform: string, userId: string): Promise<void> {
    const users = this.cache.get(platform);
    if (users) {
      users.delete(userId);
      await this.saveAuthData();
      console.log(`[auth-service] Removed user ${userId} from ${platform}`);
    }
  }

  /**
   * List all authorized users for a platform
   */
  public listUsers(platform: string): string[] {
    const users = this.cache.get(platform);
    return users ? Array.from(users) : [];
  }

  /**
   * List all platforms with authorized users
   */
  public listPlatforms(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Check if any users are authorized for a platform
   */
  public hasAnyUsers(platform: string): boolean {
    const users = this.cache.get(platform);
    return users ? users.size > 0 : false;
  }

  /**
   * Get authorization status for all platforms
   */
  public getAuthStatus(): Record<string, { authorized: number; hasUsers: boolean }> {
    const status: Record<string, { authorized: number; hasUsers: boolean }> = {};
    
    const platforms = ["telegram", "discord", "whatsapp", "imessage"];
    
    for (const platform of platforms) {
      const users = this.cache.get(platform);
      status[platform] = {
        authorized: users ? users.size : 0,
        hasUsers: users ? users.size > 0 : false
      };
    }
    
    return status;
  }

  /**
   * Validate authorization for incoming message
   * Returns true if authorized, false otherwise
   */
  public validateMessage(platform: string, userId: string): boolean {
    // If no users are authorized for this platform, allow first user (setup mode)
    if (!this.hasAnyUsers(platform)) {
      console.log(`[auth-service] Setup mode: First user ${userId} on ${platform} allowed`);
      return true;
    }
    
    // Check if user is authorized
    const authorized = this.isAuthorized(platform, userId);
    
    if (!authorized) {
      console.warn(`[auth-service] Unauthorized access attempt: ${userId} on ${platform}`);
    }
    
    return authorized;
  }

  /**
   * Log unauthorized access attempt
   */
  public logUnauthorizedAttempt(platform: string, userId: string, message?: string): void {
    console.warn(`[auth-service] UNAUTHORIZED: ${userId} on ${platform}`);
    if (message) {
      console.warn(`[auth-service] Message: ${message.substring(0, 100)}...`);
    }
    
    // Could also log to file or database here
  }

  async execute(): Promise<void> {
    // Service agent, no scheduled execution needed
    console.log("[auth-service] Auth Service running");
  }
}