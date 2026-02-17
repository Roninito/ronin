/**
 * CircuitBreaker
 * Detects suspicious activity and automatically blocks access
 * Sends notifications when triggered
 */

import type { AuditLog } from './types.js';

interface CircuitBreakerConfig {
  maxFailedRequests: number;
  timeWindow: number; // milliseconds
  blockDuration: number; // milliseconds
}

interface BlockedIP {
  ip: string;
  blockedUntil: number;
  reason: string;
  failedAttempts: number;
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private blockedIPs: Map<string, BlockedIP> = new Map();
  private failedAttempts: Map<string, number[]> = new Map(); // IP -> timestamps

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      maxFailedRequests: 10,
      timeWindow: 60000, // 1 minute
      blockDuration: 900000, // 15 minutes
      ...config
    };
  }

  /**
   * Check if IP is currently blocked
   */
  isBlocked(ip: string): { blocked: boolean; reason?: string; unblockAt?: number } {
    const blocked = this.blockedIPs.get(ip);
    
    if (!blocked) {
      return { blocked: false };
    }

    // Check if block has expired
    if (Date.now() > blocked.blockedUntil) {
      this.blockedIPs.delete(ip);
      return { blocked: false };
    }

    return {
      blocked: true,
      reason: blocked.reason,
      unblockAt: blocked.blockedUntil
    };
  }

  /**
   * Record a failed request
   */
  recordFailure(ip: string, reason: string): { blocked: boolean; reason?: string } {
    const now = Date.now();
    
    // Get recent failures for this IP
    let failures = this.failedAttempts.get(ip) || [];
    
    // Remove failures outside time window
    failures = failures.filter(timestamp => now - timestamp < this.config.timeWindow);
    
    // Add current failure
    failures.push(now);
    this.failedAttempts.set(ip, failures);

    // Check if threshold exceeded
    if (failures.length >= this.config.maxFailedRequests) {
      const blockReason = this.generateBlockReason(failures.length, reason);
      this.blockIP(ip, blockReason);
      
      return {
        blocked: true,
        reason: blockReason
      };
    }

    return { blocked: false };
  }

  /**
   * Record a successful request (resets failures)
   */
  recordSuccess(ip: string): void {
    this.failedAttempts.delete(ip);
  }

  /**
   * Block an IP address
   */
  blockIP(ip: string, reason: string): void {
    const blockedUntil = Date.now() + this.config.blockDuration;
    
    const failures = this.failedAttempts.get(ip) || [];
    
    this.blockedIPs.set(ip, {
      ip,
      blockedUntil,
      reason,
      failedAttempts: failures.length
    });

    console.warn(`[CircuitBreaker] Blocked IP ${ip}: ${reason}`);
    console.warn(`[CircuitBreaker] Unblocks at: ${new Date(blockedUntil).toISOString()}`);
  }

  /**
   * Manually unblock an IP
   */
  unblockIP(ip: string): boolean {
    if (this.blockedIPs.has(ip)) {
      this.blockedIPs.delete(ip);
      this.failedAttempts.delete(ip);
      console.log(`[CircuitBreaker] Manually unblocked IP ${ip}`);
      return true;
    }
    return false;
  }

  /**
   * Get all currently blocked IPs
   */
  getBlockedIPs(): BlockedIP[] {
    const now = Date.now();
    const active: BlockedIP[] = [];

    for (const [ip, blocked] of this.blockedIPs.entries()) {
      if (now < blocked.blockedUntil) {
        active.push(blocked);
      } else {
        // Clean up expired blocks
        this.blockedIPs.delete(ip);
      }
    }

    return active;
  }

  /**
   * Analyze audit log for suspicious patterns
   */
  analyzeAuditLog(logs: AuditLog[]): { suspicious: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    // Count failed requests by path
    const pathFailures = new Map<string, number>();
    for (const log of logs) {
      if (!log.allowed) {
        const count = pathFailures.get(log.path) || 0;
        pathFailures.set(log.path, count + 1);
      }
    }

    // Check for repeated attempts on blocked paths
    for (const [path, count] of pathFailures.entries()) {
      if (count > 5) {
        reasons.push(`Multiple attempts (${count}) on blocked path: ${path}`);
      }
    }

    // Check for rapid fire requests
    const ipCounts = new Map<string, number>();
    for (const log of logs) {
      // Use a placeholder since we don't have real IPs yet
      const key = log.sourceIP || 'unknown';
      const count = ipCounts.get(key) || 0;
      ipCounts.set(key, count + 1);
    }

    for (const [ip, count] of ipCounts.entries()) {
      if (count > 50) {
        reasons.push(`High request volume from ${ip}: ${count} requests`);
      }
    }

    return {
      suspicious: reasons.length > 0,
      reasons
    };
  }

  /**
   * Generate block reason message
   */
  private generateBlockReason(failureCount: number, lastReason: string): string {
    return `Too many failed requests (${failureCount}) in ${this.config.timeWindow / 1000}s. ` +
           `Last failure: ${lastReason}`;
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    blockedIPCount: number;
    totalFailedAttempts: number;
    config: CircuitBreakerConfig;
  } {
    let totalFailedAttempts = 0;
    for (const blocked of this.blockedIPs.values()) {
      totalFailedAttempts += blocked.failedAttempts;
    }

    return {
      blockedIPCount: this.blockedIPs.size,
      totalFailedAttempts,
      config: this.config
    };
  }
}
