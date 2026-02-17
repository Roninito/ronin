/**
 * Cloudflare Plugin Types
 * Type definitions for route policies, tunnel config, and events
 */

export interface RouteConfig {
  path: string;
  methods: string[];
  auth: 'none' | 'token' | 'jwt';
  expires: string | null;
  allowedEvents?: string[];
  availableBetween?: {
    start: string;
    end: string;
  };
}

export interface ProjectionConfig {
  fields: string[];
}

export interface RoutePolicy {
  version: string;
  mode: 'strict' | 'dev';
  routes: RouteConfig[];
  blockedPaths: string[];
  projections: Record<string, ProjectionConfig>;
}

export interface TunnelConfig {
  id: string;
  name: string;
  url: string;
  localPort: number;
  createdAt: number;
  status: 'active' | 'stopped' | 'error';
  expires?: number;
  isTemporary: boolean;
}

export interface AuthToken {
  token: string;
  accountId: string;
  email: string;
  expiresAt: number;
}

export interface AuditLog {
  timestamp: number;
  method: string;
  path: string;
  sourceIP: string;
  allowed: boolean;
  reason?: string;
  tunnelName: string;
}

// Event Payloads
export interface CreateTunnelEvent {
  name: string;
  temporary?: boolean;
  ttl?: number; // seconds, max 86400 (24 hours)
}

export interface TunnelActiveEvent {
  name: string;
  url: string;
  localPort: number;
  status: string;
  expires?: number;
}

export interface RouteBlockedEvent {
  path: string;
  reason: string;
  sourceIP: string;
  timestamp: number;
}

export interface CircuitBreakerEvent {
  tunnelName: string;
  reason: string;
  blockedUntil: number;
}
