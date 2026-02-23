/**
 * Reticulum Plugin
 * 
 * Decentralized mesh network communication via Reticulum Network Stack.
 * Enables Ronin-to-Ronin communication over local mesh (LAN), wide-area mesh,
 * and private networks with shared key authentication.
 * 
 * Features:
 * - Local mesh auto-discovery (zero-config via IPv6 multicast)
 * - Private networks with shared secret authentication
 * - Wide-area mesh connectivity
 * - LXMF messaging with delivery confirmation
 * - Identity management
 * 
 * @example
 * // Initialize with local mesh enabled
 * await api.reticulum?.init({
 *   enableLocalMesh: true,
 *   groupId: "my-home-mesh"
 * });
 * 
 * @example
 * // Send a message to a peer
 * await api.reticulum?.sendMessage("abc123...", "Hello from Ronin!");
 * 
 * @packageDocumentation
 */

import type { Plugin } from "../src/plugins/base.js";
import type { PythonBackendHandle } from "./python-bridge.js";
import { join } from "path";
import { existsSync } from "fs";

/**
 * Reticulum identity information
 */
export interface IdentityInfo {
  hash: string;
  createdAt?: number;
}

/**
 * Reticulum destination information
 */
export interface DestinationInfo {
  hash: string;
  appName: string;
  aspects: string[];
}

/**
 * LXMF message
 */
export interface LXMFMessage {
  hash: string;
  content?: string;
  title?: string;
  fields?: Record<string, any>;
  timestamp: number;
  source?: string;
  direction: "inbound" | "outbound";
}

/**
 * LXMF message receipt
 */
export interface LXMFReceipt {
  hash: string;
  status: "queued" | "sent" | "delivered" | "failed";
  timestamp?: number;
}

/**
 * Network peer information
 */
export interface PeerInfo {
  identityHash: string;
  lastHeard: number;
  rssi?: number;
  interface?: string;
}

/**
 * Network status
 */
export interface NetworkStatus {
  available: boolean;
  identity?: string;
  destination?: string;
  interfaces: string[];
  peerCount: number;
}

/**
 * Initialization options
 */
export interface ReticulumOptions {
  /** Enable local network auto-discovery (AutoInterface) */
  enableLocalMesh?: boolean;
  
  /** Network group ID for local mesh (default: "ronin-mesh") */
  groupId?: string;
  
  /** Shared secret for private network (Base64-encoded) */
  sharedKey?: string;
  
  /** Name for private network */
  networkName?: string;
  
  /** Enable wide-area mesh discovery */
  enableWideArea?: boolean;
  
  /** Discovery scope: "link", "admin", "site", "organisation", "global" */
  discoveryScope?: string;
  
  /** Path to Reticulum config directory */
  configPath?: string;
  
  /** Application name for destinations (default: "ronin") */
  appName?: string;
}

/**
 * Reticulum Plugin State
 */
interface ReticulumState {
  backend: PythonBackendHandle | null;
  identity: IdentityInfo | null;
  destination: DestinationInfo | null;
  initialized: boolean;
}

const state: ReticulumState = {
  backend: null,
  identity: null,
  destination: null,
  initialized: false,
};

/**
 * Get the Python backend, initializing if necessary
 */
async function getBackend(): Promise<PythonBackendHandle> {
  if (!state.backend) {
    throw new Error(
      "Reticulum not initialized. Call init() first to initialize the network."
    );
  }
  return state.backend;
}

/**
 * Reticulum Plugin
 */
const reticulumPlugin: Plugin = {
  name: "reticulum",
  description: "Decentralized mesh network communication via Reticulum. Enables Ronin-to-Ronin communication over local mesh (LAN), wide-area mesh, and private networks with shared key authentication.",
  methods: {
    /**
     * Initialize Reticulum network
     * 
     * @param options - Initialization options
     * @returns Network status
     * 
     * @example
     * // Local mesh only
     * await api.reticulum?.init({
     *   enableLocalMesh: true,
     *   groupId: "my-home-mesh"
     * });
     * 
     * @example
     * // Private network with shared key
     * await api.reticulum?.init({
     *   sharedKey: "xK9mP2vL8nQ4wR7tY3uI6oA5sD1fG0hJ",
     *   networkName: "home-mesh"
     * });
     * 
     * @example
     * // Hybrid (local + wide-area)
     * await api.reticulum?.init({
     *   enableLocalMesh: true,
     *   enableWideArea: true,
     *   discoveryScope: "link"
     * });
     */
    init: async (options?: ReticulumOptions): Promise<NetworkStatus> => {
      // Check if already initialized
      if (state.initialized) {
        return await (await getBackend()).call("get_status") as NetworkStatus;
      }

      // Find backend script
      const backendScript = join(
        __dirname,
        "python/examples/reticulum_backend.py"
      );

      if (!existsSync(backendScript)) {
        throw new Error(
          `Reticulum backend not found: ${backendScript}. ` +
          "Ensure the Python backend script exists."
        );
      }

      // Spawn Python backend
      state.backend = await (await import("./python-bridge.js")).default.methods.spawn(
        backendScript,
        {
          env: options?.configPath ? { RETICULUM_CONFIG: options.configPath } : undefined,
        }
      );

      // Initialize Reticulum
      const result = await state.backend.call("init", {
        enable_auto_interface: options?.enableLocalMesh ?? true,
        group_id: options?.groupId || "ronin-mesh",
        shared_key: options?.sharedKey,
        network_name: options?.networkName,
        enable_wide_area: options?.enableWideArea ?? false,
        discovery_scope: options?.discoveryScope || "link",
      }) as any;

      // Store identity
      if (result.identity_hash) {
        state.identity = {
          hash: result.identity_hash,
          createdAt: result.created_at,
        };
      }

      state.initialized = true;

      console.log(
        `[reticulum] Initialized with identity: ${state.identity?.hash.slice(0, 16)}...`
      );

      return await state.backend.call("get_status") as NetworkStatus;
    },

    /**
     * Disconnect from Reticulum network and cleanup
     */
    disconnect: async (): Promise<void> => {
      if (!state.backend) return;

      try {
        await state.backend.call("shutdown");
        await state.backend.terminate();
      } catch (error) {
        console.error("[reticulum] Error during disconnect:", error);
      } finally {
        state.backend = null;
        state.identity = null;
        state.destination = null;
        state.initialized = false;
      }
    },

    /**
     * Create a new Reticulum identity
     * 
     * @returns Identity information
     * 
     * @example
     * const identity = await api.reticulum?.createIdentity();
     * console.log("Identity hash:", identity?.hash);
     */
    createIdentity: async (): Promise<IdentityInfo> => {
      const backend = await getBackend();
      const result = await backend.call("create_identity") as any;
      
      state.identity = {
        hash: result.hash,
        createdAt: result.created_at,
      };
      
      return state.identity;
    },

    /**
     * Load an existing identity from file
     * 
     * @param path - Path to identity file
     * @returns Identity information
     * 
     * @example
     * const identity = await api.reticulum?.loadIdentity("~/.ronin/reticulum/identity");
     */
    loadIdentity: async (path: string): Promise<IdentityInfo> => {
      const backend = await getBackend();
      const result = await backend.call("load_identity", { path }) as any;
      
      state.identity = {
        hash: result.hash,
      };
      
      return state.identity;
    },

    /**
     * Get the current identity
     * 
     * @returns Identity information or null if not initialized
     */
    getIdentity: async (): Promise<IdentityInfo | null> => {
      if (!state.identity) {
        const backend = await getBackend();
        const result = await backend.call("get_identity") as any;
        
        if (result.hash) {
          state.identity = { hash: result.hash };
        }
      }
      
      return state.identity;
    },

    /**
     * Create a destination for receiving messages
     * 
     * @param aspects - List of aspect strings
     * @param appName - Application name (default: "ronin")
     * @returns Destination information
     * 
     * @example
     * const dest = await api.reticulum?.createDestination(["messaging", "v1"]);
     * console.log("Destination hash:", dest?.hash);
     */
    createDestination: async (
      aspects: string[],
      appName?: string
    ): Promise<DestinationInfo> => {
      const backend = await getBackend();
      const result = await backend.call("create_destination", {
        aspects,
        app_name: appName || "ronin",
      }) as any;
      
      state.destination = {
        hash: result.hash,
        appName: result.app_name,
        aspects: result.aspects,
      };
      
      return state.destination;
    },

    /**
     * Announce the destination on the network
     * 
     * @param appData - Optional application data to include
     * @returns Status
     * 
     * @example
     * await api.reticulum?.announce({
     *   type: "ronin-instance",
     *   services: ["messaging", "skills"]
     * });
     */
    announce: async (appData?: Record<string, any>): Promise<void> => {
      const backend = await getBackend();
      await backend.call("announce", {
        app_data: JSON.stringify(appData),
      });
    },

    /**
     * Send a raw packet to a destination
     * 
     * @param destinationHash - Destination hash (hex string)
     * @param data - Data to send (Uint8Array or hex string)
     * @returns Receipt information
     * 
     * @example
     * const data = new TextEncoder().encode("Hello!");
     * await api.reticulum?.sendPacket("abc123...", data);
     */
    sendPacket: async (
      destinationHash: string,
      data: Uint8Array | string
    ): Promise<any> => {
      const backend = await getBackend();
      
      const dataHex = typeof data === "string"
        ? data
        : Buffer.from(data).toString("hex");
      
      return await backend.call("send_packet", {
        destination: destinationHash,
        data: dataHex,
      });
    },

    /**
     * Send an LXMF message
     * 
     * @param destinationHash - Destination hash (hex string)
     * @param content - Message content
     * @param options - Message options
     * @returns Message receipt
     * 
     * @example
     * await api.reticulum?.sendMessage("abc123...", "Hello from Ronin!");
     * 
     * @example
     * await api.reticulum?.sendMessage("abc123...", "Important message", {
     *   title: "Alert",
     *   fields: { priority: "high" }
     * });
     */
    sendMessage: async (
      destinationHash: string,
      content: string,
      options?: { title?: string; fields?: Record<string, any> }
    ): Promise<LXMFReceipt> => {
      const backend = await getBackend();
      const result = await backend.call("send_lxmf_message", {
        destination: destinationHash,
        content,
        title: options?.title,
        fields: options?.fields,
      }) as any;
      
      return {
        hash: result.hash,
        status: result.status,
        timestamp: Date.now(),
      };
    },

    /**
     * Receive an LXMF message
     * 
     * @param timeout - Timeout in milliseconds (default: 5000)
     * @returns Message or null if no messages
     * 
     * @example
     * const message = await api.reticulum?.receiveMessage();
     * if (message) {
     *   console.log(`From ${message.source}: ${message.content}`);
     * }
     */
    receiveMessage: async (timeout?: number): Promise<LXMFMessage | null> => {
      const backend = await getBackend();
      const result = await backend.call("receive_lxmf_message", {
        timeout: timeout || 5000,
      }) as any;
      
      if (!result) return null;
      
      return {
        hash: result.hash,
        content: result.content,
        title: result.title,
        fields: result.fields,
        timestamp: result.timestamp,
        source: result.source,
        direction: "inbound",
      };
    },

    /**
     * Get network status
     * 
     * @returns Network status information
     */
    getStatus: async (): Promise<NetworkStatus> => {
      const backend = await getBackend();
      return await backend.call("get_status") as NetworkStatus;
    },

    /**
     * Get list of discovered peers
     * 
     * @returns List of peer information
     */
    getPeers: async (): Promise<PeerInfo[]> => {
      const backend = await getBackend();
      return await backend.call("get_peers") as PeerInfo[];
    },

    /**
     * Get identity hash (convenience method)
     * 
     * @returns Identity hash or null
     */
    getIdentityHash: async (): Promise<string | null> => {
      const identity = await reticulumPlugin.methods.getIdentity();
      return identity?.hash || null;
    },

    /**
     * Generate a shared key for private network
     * 
     * @returns Base64-encoded shared key
     * 
     * @example
     * const key = await api.reticulum?.generateSharedKey();
     * console.log("Share this key with other instances:", key);
     */
    generateSharedKey: async (): Promise<string> => {
      // Generate random 32-byte key
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      return Buffer.from(bytes).toString("base64");
    },
  },
};

export default reticulumPlugin;
