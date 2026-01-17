import type { Plugin } from "../src/plugins/base.js";

interface RealmConfig {
  discoveryUrl: string;
  callSign: string;
  token?: string;
  localWsPort?: number;
  heartbeatInterval?: number;
  stunServers?: RTCIceServer[];
  turnServers?: RTCIceServer[];
}

interface PeerConnection {
  callSign: string;
  ws?: WebSocket;
  pc?: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  connectionType?: "websocket" | "webrtc";
  messageQueue: Array<{ type: string; payload: unknown }>;
}

interface RealmMessage {
  type: string;
  callSign?: string;
  wsAddress?: string;
  token?: string;
  target?: string;
  requestId?: string;
  online?: boolean;
  to?: string;
  from?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  eventType?: string;
  payload?: unknown;
  content?: string;
  error?: string;
}

// Global state (shared across plugin instances)
let discoveryWs: WebSocket | null = null;
let localWsServer: ReturnType<typeof Bun.serve> | null = null;
let peerConnections: Map<string, PeerConnection> = new Map();
let config: RealmConfig | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let currentExternalIp: string | null = null;
let pendingQueries: Map<string, { resolve: (value: unknown) => void; reject: (reason?: any) => void }> = new Map();
let eventsAPI: any = null; // Will be set during initialization

/**
 * Realm plugin for peer-to-peer communication between Ronin instances
 */
const realmPlugin: Plugin = {
  name: "realm",
  description: "Peer-to-peer communication and discovery via Realm server with WebSocket and WebRTC support",
  methods: {
    /**
     * Initialize and connect to Realm discovery server
     */
    init: async (
      discoveryUrl: string,
      callSign: string,
      options?: {
        token?: string;
        localWsPort?: number;
        heartbeatInterval?: number;
        stunServers?: RTCIceServer[];
        turnServers?: RTCIceServer[];
      }
    ): Promise<void> => {
      config = {
        discoveryUrl,
        callSign,
        token: options?.token,
        localWsPort: options?.localWsPort || 4000,
        heartbeatInterval: options?.heartbeatInterval || 30000,
        stunServers: options?.stunServers || [
          { urls: "stun:stun.l.google.com:19302" },
        ],
        turnServers: options?.turnServers || [],
      };

      // Fetch external IP
      currentExternalIp = await fetchExternalIp();

      // Start local WebSocket server for incoming connections
      startLocalWsServer();

      // Connect to discovery server
      await connectToDiscovery();

      console.log(`[realm] Initialized for call sign: ${callSign}`);
    },

    /**
     * Disconnect from Realm and cleanup
     */
    disconnect: (): void => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      // Close all peer connections
      for (const [callSign, conn] of peerConnections.entries()) {
        if (conn.ws) conn.ws.close();
        if (conn.pc) conn.pc.close();
        peerConnections.delete(callSign);
      }

      if (discoveryWs) {
        discoveryWs.close();
        discoveryWs = null;
      }

      if (localWsServer) {
        localWsServer.stop();
        localWsServer = null;
      }

      config = null;
      console.log("[realm] Disconnected");
    },

    /**
     * Send a text message to a peer
     */
    sendMessage: async (to: string, content: string): Promise<void> => {
      if (!config) {
        throw new Error("Realm not initialized. Call init() first.");
      }

      await beam(to, "text-message", { content });
    },

    /**
     * Beam (fire-and-forget) data to peer(s)
     */
    beam: async (
      target: string | string[],
      eventType: string,
      payload: unknown
    ): Promise<void> => {
      if (!config) {
        throw new Error("Realm not initialized. Call init() first.");
      }

      const targets = Array.isArray(target) ? target : [target];

      for (const t of targets) {
        const conn = await getOrCreateConnection(t);
        const message: RealmMessage = {
          type: "beam",
          eventType,
          payload,
          from: config.callSign,
        };

        if (conn.connectionType === "websocket" && conn.ws?.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify(message));
        } else if (conn.connectionType === "webrtc" && conn.dataChannel?.readyState === "open") {
          conn.dataChannel.send(JSON.stringify(message));
        } else {
          // Queue message if not connected
          conn.messageQueue.push({ type: eventType, payload });
          // Try to connect
          await connectToPeer(t);
        }
      }
    },

    /**
     * Query a peer and wait for response
     */
    query: async (
      target: string,
      queryType: string,
      payload: unknown,
      timeout: number = 5000
    ): Promise<unknown> => {
      if (!config) {
        throw new Error("Realm not initialized. Call init() first.");
      }

      return new Promise((resolve, reject) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        pendingQueries.set(requestId, { resolve, reject });

        const timer = setTimeout(() => {
          pendingQueries.delete(requestId);
          reject(new Error(`Query timeout after ${timeout}ms`));
        }, timeout);

        // Override reject to clear timer
        const originalReject = pendingQueries.get(requestId)!.reject;
        pendingQueries.get(requestId)!.reject = (reason) => {
          clearTimeout(timer);
          originalReject(reason);
        };

        getOrCreateConnection(target).then((conn) => {
          const message: RealmMessage = {
            type: "query",
            queryType,
            payload,
            requestId,
            from: config!.callSign,
          };

          if (conn.connectionType === "websocket" && conn.ws?.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify(message));
          } else if (conn.connectionType === "webrtc" && conn.dataChannel?.readyState === "open") {
            conn.dataChannel.send(JSON.stringify(message));
          } else {
            // Queue and try to connect
            conn.messageQueue.push({ type: queryType, payload });
            connectToPeer(target).then(() => {
              // Retry after connection
              if (conn.connectionType === "websocket" && conn.ws?.readyState === WebSocket.OPEN) {
                conn.ws.send(JSON.stringify(message));
              } else if (conn.connectionType === "webrtc" && conn.dataChannel?.readyState === "open") {
                conn.dataChannel.send(JSON.stringify(message));
              } else {
                clearTimeout(timer);
                pendingQueries.delete(requestId);
                reject(new Error("Failed to establish connection"));
              }
            });
          }
        });
      });
    },

    /**
     * Get peer status (online/offline)
     */
    getPeerStatus: async (callSign: string): Promise<{ online: boolean; wsAddress?: string }> => {
      if (!config || !discoveryWs) {
        throw new Error("Realm not initialized. Call init() first.");
      }

      return new Promise((resolve) => {
        const requestId = `status-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const handler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data.toString()) as RealmMessage;
            if (data.type === "peerInfo" && data.requestId === requestId) {
              discoveryWs!.removeEventListener("message", handler);
              resolve({
                online: data.online || false,
                wsAddress: data.wsAddress,
              });
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        discoveryWs.addEventListener("message", handler);
        discoveryWs.send(
          JSON.stringify({
            type: "getPeer",
            target: callSign,
            requestId,
          })
        );

        // Timeout after 5 seconds
        setTimeout(() => {
          discoveryWs?.removeEventListener("message", handler);
          resolve({ online: false });
        }, 5000);
      });
    },

    /**
     * Send media stream to peer (WebRTC only)
     */
    sendMedia: async (to: string, stream: MediaStream): Promise<void> => {
      if (!config) {
        throw new Error("Realm not initialized. Call init() first.");
      }

      if (typeof RTCPeerConnection === "undefined" || typeof MediaStream === "undefined") {
        throw new Error("WebRTC MediaStream APIs not available in this environment");
      }

      const conn = await getOrCreateConnection(to);

      // Ensure WebRTC connection
      if (conn.connectionType !== "webrtc" || !conn.pc) {
        // Close existing connection and create WebRTC
        if (conn.ws) {
          conn.ws.close();
        }
        await createWebRTCConnection(to, conn);
      }

      if (!conn.pc) {
        throw new Error("Failed to create WebRTC connection");
      }

      // Add tracks to peer connection
      stream.getTracks().forEach((track) => {
        conn.pc!.addTrack(track, stream);
      });
    },

    /**
     * Set events API reference (called internally by Ronin)
     */
    setEventsAPI: (api: any): void => {
      eventsAPI = api;
    },
  },
};

/**
 * Fetch external IP address
 */
async function fetchExternalIp(): Promise<string> {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip;
  } catch (error) {
    console.error("[realm] Failed to fetch external IP:", error);
    return "unknown";
  }
}

/**
 * Start local WebSocket server for incoming peer connections
 */
function startLocalWsServer(): void {
  if (localWsServer || !config) return;

  const port = config.localWsPort!;
  localWsServer = Bun.serve({
    port,
    fetch: (req, server) => {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not a WebSocket endpoint", { status: 400 });
    },
    websocket: {
      open: (ws) => {
        // Peer will identify themselves in first message
        console.log("[realm] Incoming peer connection");
      },
      message: (ws, message) => {
        try {
          const data = JSON.parse(message.toString()) as RealmMessage;
          handleIncomingMessage(ws, data);
        } catch (error) {
          console.error("[realm] Error handling incoming message:", error);
        }
      },
      close: (ws) => {
        // Find and remove connection
        for (const [callSign, conn] of peerConnections.entries()) {
          if (conn.ws === ws) {
            peerConnections.delete(callSign);
            console.log(`[realm] Peer disconnected: ${callSign}`);
            break;
          }
        }
      },
      error: (ws, error) => {
        console.error("[realm] WebSocket error:", error);
      },
    },
  });

  console.log(`[realm] Local WebSocket server running on port ${port}`);
}

/**
 * Connect to Realm discovery server
 */
async function connectToDiscovery(): Promise<void> {
  if (!config || discoveryWs) return;

  return new Promise((resolve, reject) => {
    discoveryWs = new WebSocket(config!.discoveryUrl);

    discoveryWs.onopen = () => {
      console.log("[realm] Connected to Realm discovery server");

      // Register with current IP
      const wsAddress = `ws://${currentExternalIp}:${config!.localWsPort}`;
      discoveryWs!.send(
        JSON.stringify({
          type: "register",
          callSign: config!.callSign,
          wsAddress,
          token: config!.token,
        })
      );

      // Start heartbeats
      startHeartbeats();
      resolve();
    };

    discoveryWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data.toString()) as RealmMessage;
        handleDiscoveryMessage(data);
      } catch (error) {
        console.error("[realm] Error handling discovery message:", error);
      }
    };

    discoveryWs.onerror = (error) => {
      console.error("[realm] Discovery connection error:", error);
      reject(error);
    };

    discoveryWs.onclose = () => {
      console.log("[realm] Discovery connection closed, reconnecting...");
      discoveryWs = null;
      setTimeout(() => connectToDiscovery(), 5000);
    };
  });
}

/**
 * Start heartbeat mechanism
 */
function startHeartbeats(): void {
  if (heartbeatTimer || !config || !discoveryWs) return;

  heartbeatTimer = setInterval(async () => {
    if (!config || !discoveryWs) return;

    const freshIp = await fetchExternalIp();
    if (freshIp !== currentExternalIp) {
      currentExternalIp = freshIp;
      const wsAddress = `ws://${currentExternalIp}:${config.localWsPort}`;
      discoveryWs.send(
        JSON.stringify({
          type: "update",
          callSign: config.callSign,
          wsAddress,
        })
      );
    } else {
      discoveryWs.send(
        JSON.stringify({
          type: "heartbeat",
          callSign: config.callSign,
        })
      );
    }
  }, config.heartbeatInterval);
}

/**
 * Handle messages from discovery server
 */
function handleDiscoveryMessage(msg: RealmMessage): void {
  switch (msg.type) {
    case "registered":
      console.log(`[realm] Registered with Realm: ${msg.callSign}`);
      break;
    case "peerInfo":
      if (msg.requestId && pendingQueries.has(msg.requestId)) {
        const { resolve } = pendingQueries.get(msg.requestId)!;
        pendingQueries.delete(msg.requestId);
        resolve({ online: msg.online, wsAddress: msg.wsAddress });
      }
      break;
    case "webrtc-signal":
      handleWebRTCSignal(msg);
      break;
  }
}

/**
 * Get or create peer connection
 */
async function getOrCreateConnection(callSign: string): Promise<PeerConnection> {
  if (peerConnections.has(callSign)) {
    return peerConnections.get(callSign)!;
  }

  const conn: PeerConnection = {
    callSign,
    messageQueue: [],
  };
  peerConnections.set(callSign, conn);

  await connectToPeer(callSign);
  return conn;
}

/**
 * Connect to a peer (try WebSocket first, fallback to WebRTC)
 */
async function connectToPeer(callSign: string): Promise<void> {
  if (!config || !discoveryWs) {
    throw new Error("Realm not initialized");
  }

  const conn = peerConnections.get(callSign);
  if (!conn) {
    throw new Error(`No connection object for ${callSign}`);
  }

  // Discover peer address
  const status = await (realmPlugin.methods.getPeerStatus as any)(callSign);
  if (!status.online || !status.wsAddress) {
    throw new Error(`Peer ${callSign} is offline`);
  }

  // Try WebSocket first
  try {
    await connectWebSocket(callSign, status.wsAddress, conn);
    return;
  } catch (error) {
    console.log(`[realm] WebSocket connection failed for ${callSign}, trying WebRTC...`);
  }

  // Fallback to WebRTC
  try {
    await createWebRTCConnection(callSign, conn);
  } catch (error) {
    console.error(`[realm] WebRTC connection failed for ${callSign}:`, error);
    throw new Error(`Failed to connect to ${callSign} via WebSocket or WebRTC`);
  }
}

/**
 * Connect via WebSocket
 */
function connectWebSocket(
  callSign: string,
  wsAddress: string,
  conn: PeerConnection
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsAddress);

    ws.onopen = () => {
      conn.ws = ws;
      conn.connectionType = "websocket";
      console.log(`[realm] WebSocket connected to ${callSign}`);

      // Send queued messages
      while (conn.messageQueue.length > 0) {
        const queued = conn.messageQueue.shift()!;
        ws.send(JSON.stringify({ type: "beam", eventType: queued.type, payload: queued.payload }));
      }

      resolve();
    };

    ws.onmessage = (event) => {
      handleIncomingMessage(ws, JSON.parse(event.data.toString()));
    };

    ws.onerror = (error) => {
      reject(error);
    };

    ws.onclose = () => {
      if (conn.ws === ws) {
        conn.ws = undefined;
        conn.connectionType = undefined;
      }
    };
  });
}

/**
 * Create WebRTC connection
 */
async function createWebRTCConnection(
  callSign: string,
  conn: PeerConnection
): Promise<void> {
  if (!config) throw new Error("Config not set");

  // Check if WebRTC is available
  if (typeof RTCPeerConnection === "undefined") {
    throw new Error("WebRTC not available in this environment. RTCPeerConnection is not defined.");
  }

  const pc = new RTCPeerConnection({
    iceServers: [...(config.stunServers || []), ...(config.turnServers || [])],
  });

  conn.pc = pc;
  conn.connectionType = "webrtc";

  // Create data channel for messaging
  const dataChannel = pc.createDataChannel("messages", { ordered: true });
  conn.dataChannel = dataChannel;

  dataChannel.onopen = () => {
    console.log(`[realm] WebRTC data channel open with ${callSign}`);
    // Send queued messages
    while (conn.messageQueue.length > 0) {
      const queued = conn.messageQueue.shift()!;
      dataChannel.send(JSON.stringify({ type: "beam", eventType: queued.type, payload: queued.payload }));
    }
  };

  dataChannel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as RealmMessage;
      handleIncomingMessage(dataChannel as any, data);
    } catch (error) {
      console.error("[realm] Error handling data channel message:", error);
    }
  };

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && discoveryWs) {
      discoveryWs.send(
        JSON.stringify({
          type: "webrtc-signal",
          to: callSign,
          from: config!.callSign,
          candidate: event.candidate.toJSON(),
        })
      );
    }
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Send offer via Realm
  if (discoveryWs) {
    discoveryWs.send(
      JSON.stringify({
        type: "webrtc-signal",
        to: callSign,
        from: config!.callSign,
        sdp: offer,
      })
    );
  }

  // Wait for answer (handled in handleWebRTCSignal)
}

/**
 * Handle WebRTC signaling
 */
function handleWebRTCSignal(msg: RealmMessage): void {
  if (!config || !msg.from) return;

  const conn = peerConnections.get(msg.from);
  if (!conn || !conn.pc) {
    // Incoming connection - create new peer connection
    if (typeof RTCPeerConnection === "undefined") {
      console.error("[realm] WebRTC not available, cannot handle incoming WebRTC connection");
      return;
    }

    const newConn: PeerConnection = {
      callSign: msg.from,
      messageQueue: [],
    };
    peerConnections.set(msg.from, newConn);

    const pc = new RTCPeerConnection({
      iceServers: [...(config.stunServers || []), ...(config.turnServers || [])],
    });
    newConn.pc = pc;
    newConn.connectionType = "webrtc";

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      newConn.dataChannel = channel;
      channel.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as RealmMessage;
          handleIncomingMessage(channel as any, data);
        } catch (error) {
          console.error("[realm] Error handling data channel message:", error);
        }
      };
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && discoveryWs) {
        discoveryWs.send(
          JSON.stringify({
            type: "webrtc-signal",
            to: msg.from,
            from: config!.callSign,
            candidate: event.candidate.toJSON(),
          })
        );
      }
    };

    if (msg.sdp) {
      pc.setRemoteDescription(msg.sdp).then(() => {
        return pc.createAnswer();
      }).then((answer) => {
        return pc.setLocalDescription(answer);
      }).then(() => {
        if (discoveryWs && msg.from) {
          discoveryWs.send(
            JSON.stringify({
              type: "webrtc-signal",
              to: msg.from,
              from: config!.callSign,
              sdp: pc.localDescription,
            })
          );
        }
      });
    }

    if (msg.candidate) {
      pc.addIceCandidate(msg.candidate);
    }
  } else {
    // Existing connection - handle SDP/ICE
    if (msg.sdp) {
      conn.pc!.setRemoteDescription(msg.sdp);
    }
    if (msg.candidate) {
      conn.pc!.addIceCandidate(msg.candidate);
    }
  }
}

/**
 * Handle incoming messages from peers
 */
function handleIncomingMessage(source: WebSocket | RTCDataChannel, msg: RealmMessage): void {
  if (!eventsAPI) return;

  switch (msg.type) {
    case "beam":
      if (msg.eventType && msg.payload) {
        eventsAPI.emit(`realm:beam:${msg.eventType}`, msg.payload);
        if (msg.eventType === "text-message") {
          eventsAPI.emit("realm:message", {
            from: msg.from,
            content: (msg.payload as any).content,
          });
        }
      }
      break;
    case "query":
      // Handle query and send response
      if (msg.queryType && msg.requestId) {
        eventsAPI.query("", msg.queryType, msg.payload).then((response) => {
          const responseMsg: RealmMessage = {
            type: "response",
            requestId: msg.requestId,
            payload: response,
          };
          if (source instanceof WebSocket) {
            source.send(JSON.stringify(responseMsg));
          } else {
            source.send(JSON.stringify(responseMsg));
          }
        }).catch((error) => {
          const responseMsg: RealmMessage = {
            type: "response",
            requestId: msg.requestId,
            error: error.message,
          };
          if (source instanceof WebSocket) {
            source.send(JSON.stringify(responseMsg));
          } else {
            source.send(JSON.stringify(responseMsg));
          }
        });
      }
      break;
    case "response":
      if (msg.requestId && pendingQueries.has(msg.requestId)) {
        const { resolve, reject } = pendingQueries.get(msg.requestId)!;
        pendingQueries.delete(msg.requestId);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.payload);
        }
      }
      break;
  }
}

export default realmPlugin;
