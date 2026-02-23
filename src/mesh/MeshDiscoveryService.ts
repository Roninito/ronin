/**
 * Mesh Discovery Service
 * 
 * Enables service advertisement and discovery across the Reticulum mesh network.
 * Ronin instances can discover and execute services on other instances seamlessly.
 * 
 * @packageDocumentation
 */

import type { AgentAPI } from "../types/index.js";
import type { ToolDefinition } from "../tools/types.js";

/**
 * Service advertisement broadcast on mesh
 */
export interface ServiceAdvertisement {
  /** Unique instance identifier */
  instanceId: string;
  
  /** Human-readable instance name */
  instanceName: string;
  
  /** Reticulum identity hash */
  identityHash: string;
  
  /** Available services */
  services: ServiceInfo[];
  
  /** Network type */
  networkType: "local" | "private" | "wide-area";
  
  /** Last seen timestamp */
  lastSeen: number;
  
  /** Instance metadata */
  metadata?: {
    version?: string;
    capabilities?: string[];
    location?: string;
  };
}

/**
 * Service information
 */
export interface ServiceInfo {
  /** Service name */
  name: string;
  
  /** Service type */
  type: "skill" | "agent" | "tool" | "capability";
  
  /** Service description */
  description: string;
  
  /** Service capabilities/abilities */
  capabilities: string[];
  
  /** Service metadata */
  metadata?: {
    version?: string;
    cost?: "free" | "credits" | "reciprocal";
    avgExecutionTimeMs?: number;
  };
}

/**
 * Discovered service provider
 */
export interface DiscoveredProvider {
  /** Provider instance */
  instance: ServiceAdvertisement;
  
  /** Service offered */
  service: ServiceInfo;
  
  /** Distance in mesh hops (estimated) */
  distance: number;
  
  /** Last response time in ms */
  latencyMs?: number;
  
  /** Historical reliability (0-1) */
  reliability: number;
}

/**
 * Mesh discovery configuration
 */
export interface MeshDiscoveryConfig {
  /** Enable service advertisement */
  advertiseServices: boolean;
  
  /** Enable service discovery */
  enableDiscovery: boolean;
  
  /** Advertisement interval in ms */
  advertisementInterval: number;
  
  /** Service cache TTL in ms */
  cacheTTL: number;
  
  /** Maximum cached services */
  maxCachedServices: number;
}

/**
 * Mesh Discovery Service
 */
export class MeshDiscoveryService {
  private api: AgentAPI;
  private registry: Map<string, ServiceAdvertisement> = new Map();
  private advertisementTimer: NodeJS.Timeout | null = null;
  private config: MeshDiscoveryConfig;
  private identityHash: string | null = null;

  constructor(api: AgentAPI, config?: Partial<MeshDiscoveryConfig>) {
    this.api = api;
    this.config = {
      advertiseServices: true,
      enableDiscovery: true,
      advertisementInterval: 30000, // 30 seconds
      cacheTTL: 300000, // 5 minutes
      maxCachedServices: 100,
      ...config,
    };

    this.listenForAdvertisements();
    this.startCacheCleanup();
  }

  /**
   * Initialize mesh discovery
   */
  async initialize(): Promise<void> {
    // Get our identity
    this.identityHash = await this.api.reticulum?.getIdentityHash() || null;

    // Start advertising if enabled
    if (this.config.advertiseServices) {
      this.startAdvertisement();
    }
  }

  /**
   * Advertise our services on the mesh
   */
  async advertise(services: ServiceInfo[]): Promise<void> {
    if (!this.identityHash) {
      throw new Error("Identity not available. Initialize Reticulum first.");
    }

    const advertisement: ServiceAdvertisement = {
      instanceId: await this.getInstanceId(),
      instanceName: this.getInstanceName(),
      identityHash: this.identityHash,
      services,
      networkType: "local",
      lastSeen: Date.now(),
      metadata: {
        version: "1.0.0",
        capabilities: services.flatMap(s => s.capabilities),
      },
    };

    // Broadcast on mesh
    await this.api.reticulum?.announce({
      type: "ronin:service:advertise",
      ...advertisement,
    });

    console.log(
      `[mesh] Advertised ${services.length} services as ${advertisement.instanceName}`
    );
  }

  /**
   * Discover services on the mesh
   * 
   * @param query - Optional search query
   * @param options - Discovery options
   * @returns List of discovered providers
   */
  discoverServices(
    query?: string,
    options?: {
      serviceType?: "skill" | "agent" | "tool";
      maxDistance?: number;
      minReliability?: number;
    }
  ): DiscoveredProvider[] {
    let providers: DiscoveredProvider[] = [];

    for (const [instanceId, ad] of this.registry.entries()) {
      for (const service of ad.services) {
        // Filter by type
        if (options?.serviceType && service.type !== options.serviceType) {
          continue;
        }

        // Filter by query
        if (query) {
          const queryLower = query.toLowerCase();
          const matchesQuery =
            service.name.toLowerCase().includes(queryLower) ||
            service.description.toLowerCase().includes(queryLower) ||
            service.capabilities.some(c => c.toLowerCase().includes(queryLower));

          if (!matchesQuery) continue;
        }

        providers.push({
          instance: ad,
          service,
          distance: 1, // Simplified - would calculate from mesh topology
          reliability: 0.95, // Default reliability
        });
      }
    }

    // Filter by reliability
    if (options?.minReliability) {
      providers = providers.filter(
        p => p.reliability >= options.minReliability!
      );
    }

    // Filter by distance
    if (options?.maxDistance) {
      providers = providers.filter(p => p.distance <= options.maxDistance!);
    }

    // Sort by reliability then last seen
    providers.sort((a, b) => {
      if (b.reliability !== a.reliability) {
        return b.reliability - a.reliability;
      }
      return b.instance.lastSeen - a.instance.lastSeen;
    });

    return providers;
  }

  /**
   * Execute a service on a remote instance
   * 
   * @param instanceId - Target instance ID
   * @param serviceName - Service name to execute
   * @param params - Service parameters
   * @returns Service execution result
   */
  async executeRemoteService(
    instanceId: string,
    serviceName: string,
    params: Record<string, any>
  ): Promise<any> {
    const instance = this.registry.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    // Verify service exists
    const service = instance.services.find(s => s.name === serviceName);
    if (!service) {
      throw new Error(
        `Service not found: ${serviceName} on instance ${instanceId}`
      );
    }

    // Execute via Reticulum query
    const result = await this.api.reticulum?.query(
      instance.identityHash,
      "ronin:service:execute",
      {
        serviceName,
        params,
        requesterId: this.identityHash,
      },
      30000 // 30 second timeout
    );

    return result;
  }

  /**
   * Get instance ID (unique identifier for this Ronin instance)
   */
  private async getInstanceId(): Promise<string> {
    // Use identity hash if available, otherwise generate
    if (this.identityHash) {
      return this.identityHash.slice(0, 16);
    }

    // Fallback to hostname + random
    const hostname = await this.getHostname();
    return `${hostname}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Get instance name (human-readable)
   */
  private getInstanceName(): string {
    // Try to get from config, otherwise use hostname
    try {
      const systemConfig = this.api.config.getSystem();
      return systemConfig.externalAgentDir.split("/").pop() || "ronin";
    } catch {
      return this.getHostnameSync();
    }
  }

  /**
   * Get hostname asynchronously
   */
  private async getHostname(): Promise<string> {
    try {
      const { exec } = await import("./python-bridge.js");
      // Use shell to get hostname
      return (await this.api.shell?.exec("hostname")).stdout.trim() || "ronin-instance";
    } catch {
      return "ronin-instance";
    }
  }

  /**
   * Get hostname synchronously (fallback)
   */
  private getHostnameSync(): string {
    try {
      return require("os").hostname() || "ronin-instance";
    } catch {
      return "ronin-instance";
    }
  }

  /**
   * Listen for service advertisements from other instances
   */
  private listenForAdvertisements(): void {
    this.api.events.on(
      "reticulum:beam:ronin:service:advertise",
      (data: any) => {
        const ad = data as ServiceAdvertisement;
        
        // Validate advertisement
        if (!ad.instanceId || !ad.identityHash || !ad.services) {
          console.warn("[mesh] Invalid service advertisement received");
          return;
        }

        // Update registry
        this.registry.set(ad.instanceId, {
          ...ad,
          lastSeen: Date.now(),
        });

        console.log(
          `[mesh] Discovered: ${ad.instanceName} (${ad.services.length} services)`
        );
      }
    );
  }

  /**
   * Start periodic service advertisement
   */
  private startAdvertisement(): void {
    if (this.advertisementTimer) {
      clearInterval(this.advertisementTimer);
    }

    this.advertisementTimer = setInterval(async () => {
      try {
        // Re-advertise to keep services fresh
        // Actual advertisement happens in advertise() method
        // This is just a heartbeat
        await this.api.reticulum?.announce({
          type: "ronin:service:heartbeat",
          instanceId: this.identityHash,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error("[mesh] Error sending heartbeat:", error);
      }
    }, this.config.advertisementInterval);
  }

  /**
   * Start cache cleanup to remove stale entries
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const ttl = this.config.cacheTTL;

      for (const [instanceId, ad] of this.registry.entries()) {
        if (now - ad.lastSeen > ttl) {
          this.registry.delete(instanceId);
          console.log(`[mesh] Removed stale entry: ${ad.instanceName}`);
        }
      }
    }, 60000); // Clean every minute
  }

  /**
   * Get all cached advertisements
   */
  getCache(): ServiceAdvertisement[] {
    return Array.from(this.registry.values());
  }

  /**
   * Clear the service cache
   */
  clearCache(): void {
    this.registry.clear();
  }

  /**
   * Remove a specific instance from cache
   */
  removeInstance(instanceId: string): void {
    this.registry.delete(instanceId);
  }

  /**
   * Get statistics about the mesh
   */
  getStats(): {
    instanceCount: number;
    serviceCount: number;
    cacheSize: number;
  } {
    const instances = Array.from(this.registry.values());
    const services = instances.flatMap(i => i.services);

    return {
      instanceCount: instances.length,
      serviceCount: services.length,
      cacheSize: this.registry.size,
    };
  }

  /**
   * Cleanup and stop advertisement
   */
  destroy(): void {
    if (this.advertisementTimer) {
      clearInterval(this.advertisementTimer);
      this.advertisementTimer = null;
    }

    this.registry.clear();
  }
}

/**
 * Create mesh discovery service
 */
export function createMeshDiscovery(
  api: AgentAPI,
  config?: Partial<MeshDiscoveryConfig>
): MeshDiscoveryService {
  const service = new MeshDiscoveryService(api, config);
  service.initialize();
  return service;
}
