/**
 * Mesh Network Types
 */

import type { ServiceAdvertisement, DiscoveredProvider } from "./MeshDiscoveryService.js";

/**
 * Mesh network configuration
 */
export interface MeshConfig {
  /** Enable mesh networking */
  enabled: boolean;
  
  /** Mesh mode */
  mode: "local-only" | "wide-area" | "hybrid";
  
  /** Local mesh configuration */
  localMesh: {
    enabled: boolean;
    groupId: string;
    discoveryPort: number;
    dataPort: number;
  };
  
  /** Private network configuration */
  privateNetwork: {
    enabled: boolean;
    sharedKey?: string;
    networkName?: string;
  };
  
  /** Wide-area configuration */
  wideArea: {
    enabled: boolean;
    discoveryScope: "link" | "admin" | "site" | "organisation" | "global";
  };
  
  /** Instance configuration */
  instance: {
    name: string;
    description?: string;
    advertisedServices?: string[];
  };
}

/**
 * Mesh API surface exposed to agents
 */
export interface MeshAPI {
  /**
   * Discover services on the mesh
   */
  discoverServices(
    query?: string,
    options?: {
      serviceType?: "skill" | "agent" | "tool";
      maxDistance?: number;
      minReliability?: number;
    }
  ): DiscoveredProvider[];
  
  /**
   * Execute a service on a remote instance
   */
  executeRemoteService(
    instanceId: string,
    serviceName: string,
    params: Record<string, any>
  ): Promise<any>;
  
  /**
   * Advertise services on the mesh
   */
  advertise(services: any[]): Promise<void>;
  
  /**
   * Get mesh statistics
   */
  getStats(): {
    instanceCount: number;
    serviceCount: number;
    cacheSize: number;
  };
  
  /**
   * Get all cached advertisements
   */
  getCache(): ServiceAdvertisement[];
}

/**
 * Mesh network status
 */
export interface MeshStatus {
  /** Mesh is enabled and initialized */
  enabled: boolean;
  
  /** Current mode */
  mode: string;
  
  /** Connected to local mesh */
  localMeshConnected: boolean;
  
  /** Connected to wide-area mesh */
  wideAreaConnected: boolean;
  
  /** Number of discovered peers */
  peerCount: number;
  
  /** Number of advertised services */
  serviceCount: number;
  
  /** Our identity hash */
  identityHash?: string;
}
