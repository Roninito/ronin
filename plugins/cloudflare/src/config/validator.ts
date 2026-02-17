/**
 * Route Policy Schema and Validator
 * Ensures route policies are valid and secure
 */

import type { RoutePolicy, RouteConfig } from '../types.js';

export const DEFAULT_POLICY: RoutePolicy = {
  version: '1.0',
  mode: 'strict',
  routes: [],
  blockedPaths: [
    '/disk/**',
    '/admin/**', 
    '/internal/**',
    '/api/os-bridge/**',
    '/.ronin/**',
    '**/*.env',
    '**/config.json'
  ],
  projections: {}
};

export class PolicyValidator {
  private errors: string[] = [];

  validate(policy: any): { valid: boolean; errors: string[] } {
    this.errors = [];

    // Check version
    if (!policy.version || policy.version !== '1.0') {
      this.errors.push('Policy version must be "1.0"');
    }

    // Check mode
    if (!policy.mode || !['strict', 'dev'].includes(policy.mode)) {
      this.errors.push('Mode must be "strict" or "dev"');
    }

    // Check routes array
    if (!Array.isArray(policy.routes)) {
      this.errors.push('Routes must be an array');
    } else {
      policy.routes.forEach((route: any, index: number) => {
        this.validateRoute(route, index);
      });
    }

    // Check blocked paths
    if (!Array.isArray(policy.blockedPaths)) {
      this.errors.push('blockedPaths must be an array');
    }

    // Check projections
    if (typeof policy.projections !== 'object') {
      this.errors.push('projections must be an object');
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors
    };
  }

  private validateRoute(route: any, index: number): void {
    const prefix = `Route ${index + 1}`;

    // Check path
    if (!route.path || typeof route.path !== 'string') {
      this.errors.push(`${prefix}: path is required and must be a string`);
    } else {
      // Ensure path starts with /
      if (!route.path.startsWith('/')) {
        this.errors.push(`${prefix}: path must start with /`);
      }
      
      // Check for dangerous paths
      if (route.path.includes('..') || route.path.includes('//')) {
        this.errors.push(`${prefix}: path contains dangerous characters`);
      }
    }

    // Check methods
    if (!Array.isArray(route.methods) || route.methods.length === 0) {
      this.errors.push(`${prefix}: methods must be a non-empty array`);
    } else {
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
      route.methods.forEach((method: string) => {
        if (!validMethods.includes(method)) {
          this.errors.push(`${prefix}: invalid method "${method}"`);
        }
      });
    }

    // Check auth
    if (!route.auth || !['none', 'token', 'jwt'].includes(route.auth)) {
      this.errors.push(`${prefix}: auth must be "none", "token", or "jwt"`);
    }

    // Check expires format
    if (route.expires !== null && route.expires !== undefined) {
      if (typeof route.expires === 'string') {
        const date = new Date(route.expires);
        if (isNaN(date.getTime())) {
          this.errors.push(`${prefix}: expires must be a valid ISO date string`);
        }
      } else {
        this.errors.push(`${prefix}: expires must be a string or null`);
      }
    }

    // Check availableBetween
    if (route.availableBetween) {
      if (!route.availableBetween.start || !route.availableBetween.end) {
        this.errors.push(`${prefix}: availableBetween requires start and end`);
      } else {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(route.availableBetween.start)) {
          this.errors.push(`${prefix}: availableBetween.start must be HH:MM format`);
        }
        if (!timeRegex.test(route.availableBetween.end)) {
          this.errors.push(`${prefix}: availableBetween.end must be HH:MM format`);
        }
      }
    }

    // Check allowedEvents
    if (route.allowedEvents !== undefined) {
      if (!Array.isArray(route.allowedEvents)) {
        this.errors.push(`${prefix}: allowedEvents must be an array`);
      } else {
        // Check for dangerous events
        const dangerousEvents = [
          'disk.delete', 'disk.format',
          'agent.reload', 'agent.uninstall',
          'cloudflare.tunnel.delete',
          'system.exec', 'system.shell',
          'config.update', 'config.delete',
          'memory.clear', 'plugins.uninstall'
        ];
        
        route.allowedEvents.forEach((event: string) => {
          if (dangerousEvents.includes(event)) {
            this.errors.push(`${prefix}: cannot allow dangerous event "${event}"`);
          }
        });
      }
    }
  }

  sanitizePath(path: string): string {
    // Remove trailing slash except for root
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    // Normalize multiple slashes
    path = path.replace(/\/+/g, '/');
    
    return path;
  }

  matchesBlockedPath(path: string, blockedPaths: string[]): boolean {
    return blockedPaths.some(pattern => {
      // Simple glob matching
      if (pattern.includes('**')) {
        const prefix = pattern.replace('/**', '');
        return path.startsWith(prefix);
      } else if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(path);
      } else {
        return path === pattern || path.startsWith(pattern + '/');
      }
    });
  }
}
