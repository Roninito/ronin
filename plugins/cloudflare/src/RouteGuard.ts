/**
 * RouteGuard Middleware
 * Intercepts all HTTP requests and enforces security policy
 * CRITICAL: Must be installed BEFORE any routes
 */

import type { RoutePolicy, RouteConfig, AuditLog } from './types.js';
import { PolicyValidator } from './config/validator.js';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const POLICY_PATH = join(homedir(), '.ronin', 'cloudflare.routes.json');
const AUDIT_LOG_PATH = join(homedir(), '.ronin', 'cloudflare.audit.log');

export class RouteGuard {
  private policy: RoutePolicy | null = null;
  private validator: PolicyValidator;
  private lastPolicyLoad: number = 0;
  private policyReloadInterval: number = 5000; // Reload every 5 seconds

  constructor() {
    this.validator = new PolicyValidator();
  }

  /**
   * Load and validate route policy
   */
  async loadPolicy(): Promise<RoutePolicy | null> {
    // Check if we need to reload
    const now = Date.now();
    if (this.policy && (now - this.lastPolicyLoad) < this.policyReloadInterval) {
      return this.policy;
    }

    if (!existsSync(POLICY_PATH)) {
      return null;
    }

    try {
      const content = readFileSync(POLICY_PATH, 'utf-8');
      const policy = JSON.parse(content);
      
      const validation = this.validator.validate(policy);
      if (!validation.valid) {
        console.error('[RouteGuard] Policy validation failed:', validation.errors);
        return null;
      }

      this.policy = policy;
      this.lastPolicyLoad = now;
      return policy;
    } catch (error) {
      console.error('[RouteGuard] Failed to load policy:', error);
      return null;
    }
  }

  /**
   * Check if policy exists
   */
  async hasPolicy(): Promise<boolean> {
    const policy = await this.loadPolicy();
    return policy !== null;
  }

  /**
   * Main middleware handler
   * Returns Response if request should be blocked, null if allowed
   */
  async handle(req: Request, tunnelName: string): Promise<Response | null> {
    const policy = await this.loadPolicy();
    
    if (!policy) {
      await this.logAudit({
        timestamp: Date.now(),
        method: req.method,
        path: new URL(req.url).pathname,
        sourceIP: 'unknown',
        allowed: false,
        reason: 'No policy loaded',
        tunnelName
      });
      
      return new Response('Forbidden - No route policy configured', { 
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    const url = new URL(req.url);
    const path = this.validator.sanitizePath(url.pathname);

    // 1. Check if path is in blocked list
    if (this.validator.matchesBlockedPath(path, policy.blockedPaths)) {
      await this.logAudit({
        timestamp: Date.now(),
        method: req.method,
        path,
        sourceIP: 'unknown',
        allowed: false,
        reason: 'Path in blocked list',
        tunnelName
      });
      
      return new Response('Forbidden - Path blocked', { 
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // 2. Find matching route
    const route = policy.routes.find(r => 
      this.matchesRoute(r.path, path)
    );

    if (!route) {
      await this.logAudit({
        timestamp: Date.now(),
        method: req.method,
        path,
        sourceIP: 'unknown',
        allowed: false,
        reason: 'Route not in whitelist',
        tunnelName
      });
      
      return new Response('Forbidden - Route not whitelisted', { 
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // 3. Check HTTP method
    if (!route.methods.includes(req.method)) {
      await this.logAudit({
        timestamp: Date.now(),
        method: req.method,
        path,
        sourceIP: 'unknown',
        allowed: false,
        reason: 'Method not allowed',
        tunnelName
      });
      
      return new Response('Method Not Allowed', { 
        status: 405,
        headers: { 
          'Content-Type': 'text/plain',
          'Allow': route.methods.join(', ')
        }
      });
    }

    // 4. Check expiration
    if (route.expires) {
      const expiresAt = new Date(route.expires).getTime();
      if (Date.now() > expiresAt) {
        await this.logAudit({
          timestamp: Date.now(),
          method: req.method,
          path,
          sourceIP: 'unknown',
          allowed: false,
          reason: 'Route expired',
          tunnelName
        });
        
        return new Response('Forbidden - Route expired', { 
          status: 403,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }

    // 5. Check time restrictions
    if (route.availableBetween) {
      if (!this.isWithinHours(route.availableBetween)) {
        await this.logAudit({
          timestamp: Date.now(),
          method: req.method,
          path,
          sourceIP: 'unknown',
          allowed: false,
          reason: 'Outside allowed hours',
          tunnelName
        });
        
        return new Response(`Forbidden - Only available between ${route.availableBetween.start} and ${route.availableBetween.end}`, { 
          status: 403,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }

    // 6. Check authentication
    const authResult = await this.validateAuth(req, route);
    if (!authResult.valid) {
      await this.logAudit({
        timestamp: Date.now(),
        method: req.method,
        path,
        sourceIP: 'unknown',
        allowed: false,
        reason: authResult.reason,
        tunnelName
      });
      
      return new Response(`Unauthorized - ${authResult.reason}`, { 
        status: 401,
        headers: { 
          'Content-Type': 'text/plain',
          'WWW-Authenticate': route.auth === 'jwt' ? 'Bearer' : 'Token'
        }
      });
    }

    // Request passed all checks - log success
    await this.logAudit({
      timestamp: Date.now(),
      method: req.method,
      path,
      sourceIP: 'unknown',
      allowed: true,
      tunnelName
    });

    // Store route config in request for downstream use
    (req as any).routeConfig = route;

    return null; // Allow request to proceed
  }

  /**
   * Check if path matches route pattern
   */
  private matchesRoute(routePath: string, requestPath: string): boolean {
    // Exact match
    if (routePath === requestPath) {
      return true;
    }

    // Prefix match (e.g., /dashboard matches /dashboard/tasks)
    if (requestPath.startsWith(routePath + '/')) {
      return true;
    }

    // Wildcard match (e.g., /api/* matches /api/tasks)
    if (routePath.endsWith('/*')) {
      const prefix = routePath.slice(0, -2);
      return requestPath.startsWith(prefix);
    }

    return false;
  }

  /**
   * Check if current time is within allowed hours
   */
  private isWithinHours(availableBetween: { start: string; end: string }): boolean {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const [startHour, startMin] = availableBetween.start.split(':').map(Number);
    const [endHour, endMin] = availableBetween.end.split(':').map(Number);
    
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    if (startTime <= endTime) {
      // Same day (e.g., 09:00 to 17:00)
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Overnight (e.g., 22:00 to 06:00)
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  /**
   * Validate authentication
   */
  private async validateAuth(
    req: Request, 
    route: RouteConfig
  ): Promise<{ valid: boolean; reason?: string }> {
    // No auth required
    if (route.auth === 'none') {
      return { valid: true };
    }

    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      return { valid: false, reason: 'No authorization header' };
    }

    if (route.auth === 'token') {
      // Simple token auth - check against stored token
      const expectedToken = await this.getStoredToken();
      const providedToken = authHeader.replace('Bearer ', '').replace('Token ', '');
      
      if (providedToken !== expectedToken) {
        return { valid: false, reason: 'Invalid token' };
      }
      
      return { valid: true };
    }

    if (route.auth === 'jwt') {
      // JWT validation would go here
      // For now, just check format
      if (!authHeader.startsWith('Bearer ')) {
        return { valid: false, reason: 'JWT must use Bearer scheme' };
      }
      
      // TODO: Implement actual JWT validation
      return { valid: true };
    }

    return { valid: false, reason: 'Unknown auth type' };
  }

  /**
   * Get stored auth token
   */
  private async getStoredToken(): Promise<string | null> {
    // TODO: Implement secure token storage
    // For now, check environment or config
    return process.env.CLOUDFLARE_ROUTE_TOKEN || null;
  }

  /**
   * Log audit entry to file
   */
  private async logAudit(log: AuditLog): Promise<void> {
    try {
      const line = JSON.stringify(log) + '\n';
      appendFileSync(AUDIT_LOG_PATH, line);
    } catch (error) {
      console.error('[RouteGuard] Failed to write audit log:', error);
    }
  }

  /**
   * Get recent audit logs
   */
  async getAuditLogs(limit: number = 100): Promise<AuditLog[]> {
    try {
      if (!existsSync(AUDIT_LOG_PATH)) {
        return [];
      }

      const content = readFileSync(AUDIT_LOG_PATH, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      return lines
        .slice(-limit)
        .map(line => JSON.parse(line));
    } catch (error) {
      console.error('[RouteGuard] Failed to read audit logs:', error);
      return [];
    }
  }
}
