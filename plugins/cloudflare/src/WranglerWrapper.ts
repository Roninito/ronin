/**
 * WranglerWrapper
 * Wraps Cloudflare Wrangler CLI for tunnel and deployment management
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { TunnelConfig, AuthToken } from './types.js';

const CREDENTIALS_PATH = join(homedir(), '.ronin', 'cloudflare.json');
const MAX_TEMP_TTL = 86400; // 24 hours in seconds

export class WranglerWrapper {
  private wranglerPath: string = 'wrangler';

  /**
   * Check if Wrangler is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      execSync('which wrangler', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install Wrangler via npm
   */
  async install(): Promise<boolean> {
    try {
      console.log('[Wrangler] Installing...');
      execSync('npm install -g wrangler', { stdio: 'inherit' });
      return true;
    } catch (error) {
      console.error('[Wrangler] Failed to install:', error);
      return false;
    }
  }

  /**
   * Ensure Wrangler is available
   */
  async ensureInstalled(): Promise<boolean> {
    if (await this.isInstalled()) {
      return true;
    }
    
    console.log('[Wrangler] Not found. Attempting to install...');
    return await this.install();
  }

  /**
   * Authenticate with Cloudflare
   */
  async login(): Promise<AuthToken | null> {
    try {
      console.log('[Wrangler] Opening browser for authentication...');
      execSync('wrangler login', { stdio: 'inherit' });
      
      // Get account info
      const accountOutput = execSync('wrangler whoami', { encoding: 'utf-8' });
      
      // Parse email and account ID from output
      const emailMatch = accountOutput.match(/Email:\s*(.+)/);
      const accountMatch = accountOutput.match(/Account:\s*(.+)/);
      
      const token: AuthToken = {
        token: 'stored-in-wrangler-config', // Wrangler stores this
        accountId: accountMatch?.[1] || '',
        email: emailMatch?.[1] || '',
        expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
      };

      console.log('[Wrangler] Authenticated as', token.email);
      return token;
    } catch (error) {
      console.error('[Wrangler] Login failed:', error);
      return null;
    }
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      execSync('wrangler whoami', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new tunnel
   */
  async createTunnel(name: string): Promise<TunnelConfig | null> {
    try {
      console.log(`[Wrangler] Creating tunnel: ${name}`);
      
      // Create tunnel
      const output = execSync(`wrangler tunnel create ${name}`, {
        encoding: 'utf-8'
      });

      // Extract tunnel ID and credentials
      const idMatch = output.match(/id:\s*([a-f0-9-]+)/i);
      const tunnelId = idMatch?.[1];

      if (!tunnelId) {
        throw new Error('Failed to extract tunnel ID from output');
      }

      // Get tunnel credentials
      const credsOutput = execSync(`wrangler tunnel token ${tunnelId}`, {
        encoding: 'utf-8'
      });

      return {
        id: tunnelId,
        name,
        url: '', // Will be set when tunnel starts
        localPort: 3000, // Default
        createdAt: Date.now(),
        status: 'stopped',
        isTemporary: false
      };
    } catch (error) {
      console.error('[Wrangler] Failed to create tunnel:', error);
      return null;
    }
  }

  /**
   * Start a tunnel
   */
  async startTunnel(
    config: TunnelConfig,
    localPort: number = 3000
  ): Promise<boolean> {
    try {
      console.log(`[Wrangler] Starting tunnel: ${config.name}`);

      // Start tunnel in background
      const process = spawn('wrangler', [
        'tunnel',
        'run',
        config.id,
        '--url',
        `http://localhost:${localPort}`
      ], {
        detached: true,
        stdio: 'ignore'
      });

      process.unref();

      // Wait a moment for tunnel to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get tunnel URL
      config.url = `https://${config.name}.trycloudflare.com`;
      config.localPort = localPort;
      config.status = 'active';

      console.log(`[Wrangler] Tunnel active: ${config.url}`);
      return true;
    } catch (error) {
      console.error('[Wrangler] Failed to start tunnel:', error);
      config.status = 'error';
      return false;
    }
  }

  /**
   * Stop a tunnel
   */
  async stopTunnel(name: string): Promise<boolean> {
    try {
      console.log(`[Wrangler] Stopping tunnel: ${name}`);
      
      // Find and kill tunnel process
      execSync(`pkill -f "wrangler tunnel run.*${name}"`, { 
        stdio: 'ignore' 
      });
      
      return true;
    } catch {
      // Process might not be running
      return true;
    }
  }

  /**
   * Delete a tunnel
   */
  async deleteTunnel(name: string, tunnelId: string): Promise<boolean> {
    try {
      // First stop it
      await this.stopTunnel(name);
      
      // Delete from Cloudflare
      execSync(`wrangler tunnel delete ${tunnelId}`, { stdio: 'ignore' });
      
      console.log(`[Wrangler] Deleted tunnel: ${name}`);
      return true;
    } catch (error) {
      console.error('[Wrangler] Failed to delete tunnel:', error);
      return false;
    }
  }

  /**
   * List all tunnels
   */
  async listTunnels(): Promise<Array<{ id: string; name: string; created: string }>> {
    try {
      const output = execSync('wrangler tunnel list', { encoding: 'utf-8' });
      
      // Parse output (this is simplified - actual parsing would be more robust)
      const lines = output.split('\n').slice(2); // Skip header lines
      const tunnels = [];
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          tunnels.push({
            id: parts[0],
            name: parts[1],
            created: parts[2]
          });
        }
      }
      
      return tunnels;
    } catch (error) {
      console.error('[Wrangler] Failed to list tunnels:', error);
      return [];
    }
  }

  /**
   * Deploy to Cloudflare Pages
   */
  async deployPages(directory: string, project: string): Promise<{ url: string } | null> {
    try {
      console.log(`[Wrangler] Deploying ${directory} to Pages project ${project}...`);
      
      const output = execSync(
        `wrangler pages deploy ${directory} --project-name=${project}`,
        { encoding: 'utf-8' }
      );

      // Extract URL from output
      const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.pages\.dev/i);
      const url = urlMatch?.[0] || '';

      console.log(`[Wrangler] Deployed to: ${url}`);
      return { url };
    } catch (error) {
      console.error('[Wrangler] Pages deployment failed:', error);
      return null;
    }
  }

  /**
   * Validate TTL for temporary tunnels
   */
  validateTTL(ttl: number): number {
    // Max 24 hours
    return Math.min(Math.max(ttl, 300), MAX_TEMP_TTL); // Min 5 minutes, max 24 hours
  }
}
