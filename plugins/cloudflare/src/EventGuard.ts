/**
 * EventGuard
 * Validates events before allowing remote execution
 * Prevents dangerous internal events from being triggered externally
 */

import type { RouteConfig } from './types.js';

export class EventGuard {
  // Events that should NEVER be allowed remotely
  private dangerousEvents: string[] = [
    // Disk operations
    'disk.delete',
    'disk.format',
    'disk.wipe',
    
    // Agent management
    'agent.reload',
    'agent.uninstall',
    'agent.delete',
    'agent.stop',
    
    // Cloudflare control (prevent tunnel self-destruction)
    'cloudflare.tunnel.delete',
    'cloudflare.tunnel.stop',
    'cloudflare.auth.logout',
    
    // System execution
    'system.exec',
    'system.shell',
    'system.spawn',
    'system.sudo',
    
    // Config manipulation
    'config.update',
    'config.delete',
    'config.reset',
    
    // Memory/data destruction
    'memory.clear',
    'memory.delete',
    'db.drop',
    
    // Plugin management
    'plugins.uninstall',
    'plugins.delete',
    
    // OS Bridge control
    'os.clipboard.start',
    'os.shortcut.register',
    
    // Internal Ronin control
    'ronin.shutdown',
    'ronin.restart'
  ];

  /**
   * Validate if an event is allowed on a route
   */
  async validateEvent(
    event: string,
    payload: any,
    routeConfig: RouteConfig
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check if route allows any events
    if (!routeConfig.allowedEvents || routeConfig.allowedEvents.length === 0) {
      return {
        allowed: false,
        reason: 'Events not allowed on this route'
      };
    }

    // Check if specific event is in whitelist
    if (!routeConfig.allowedEvents.includes(event)) {
      return {
        allowed: false,
        reason: `Event '${event}' not in route whitelist`
      };
    }

    // Check if event is globally dangerous
    if (this.dangerousEvents.includes(event)) {
      return {
        allowed: false,
        reason: `Event '${event}' is restricted and cannot be executed remotely`
      };
    }

    // Additional payload validation
    const payloadValidation = this.validatePayload(event, payload);
    if (!payloadValidation.valid) {
      return {
        allowed: false,
        reason: payloadValidation.reason
      };
    }

    return { allowed: true };
  }

  /**
   * Validate event payload for security issues
   */
  private validatePayload(
    event: string,
    payload: any
  ): { valid: boolean; reason?: string } {
    if (!payload || typeof payload !== 'object') {
      return { valid: true }; // No payload is fine
    }

    // Check for dangerous patterns in payload
    const payloadStr = JSON.stringify(payload).toLowerCase();
    
    const dangerousPatterns = [
      'rm -rf',
      'sudo',
      'chmod 777',
      'drop table',
      'delete from',
      'exec(',
      'eval(',
      'system(',
      'spawn(',
      '__proto__',
      'constructor',
      'prototype'
    ];

    for (const pattern of dangerousPatterns) {
      if (payloadStr.includes(pattern)) {
        return {
          valid: false,
          reason: `Payload contains dangerous pattern: ${pattern}`
        };
      }
    }

    // Check path traversal attempts
    if (payload.path || payload.file || payload.directory) {
      const paths = [payload.path, payload.file, payload.directory]
        .filter(Boolean)
        .map(p => String(p));
      
      for (const path of paths) {
        if (path.includes('..') || path.includes('//')) {
          return {
            valid: false,
            reason: 'Payload contains path traversal attempt'
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Check if an event is dangerous (for logging/warning)
   */
  isDangerousEvent(event: string): boolean {
    return this.dangerousEvents.includes(event);
  }

  /**
   * Get list of dangerous events (for documentation)
   */
  getDangerousEvents(): string[] {
    return [...this.dangerousEvents];
  }

  /**
   * Add custom dangerous events
   */
  addDangerousEvents(events: string[]): void {
    this.dangerousEvents.push(...events);
  }
}
