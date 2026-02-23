/**
 * Mesh Network Module
 * 
 * Enables Ronin instances to discover and communicate with each other
 * over local and wide-area mesh networks.
 */

export { MeshDiscoveryService, createMeshDiscovery } from "./MeshDiscoveryService.js";
export type {
  ServiceAdvertisement,
  ServiceInfo,
  DiscoveredProvider,
  MeshDiscoveryConfig,
} from "./MeshDiscoveryService.js";
export type {
  MeshConfig,
  MeshAPI,
  MeshStatus,
} from "./types.js";
