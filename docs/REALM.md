# Realm Plugin Documentation

Realm enables peer-to-peer communication between Ronin instances using WebSocket connections with WebRTC fallback for NAT traversal.

## Architecture

Realm consists of three main components:

1. **Realm Discovery Server** (separate project at `../realm-server/`) - Central registry for peer discovery
2. **Realm Plugin** (`plugins/realm.ts`) - Ronin plugin for peer connections
3. **Voice Messaging Agent** (`agents/voice-messaging.ts`) - Example agent using Realm

## Quick Start

### 1. Start Realm Server

The Realm server is a separate project located alongside Ronin. To start it:

```bash
cd ../realm-server
bun install
bun run src/index.ts
```

Or from the Ronin directory:

```bash
cd ../../realm-server
bun install
bun run src/index.ts
```

The server will run on port 3033 by default.

### 2. Connect Ronin to Realm

```bash
ronin realm connect --url ws://localhost:3033 --callsign Leerie
```

### 3. Discover Peers

```bash
ronin realm discover Tyro
```

### 4. Send Messages

In your agent code:

```typescript
// Initialize Realm (usually done once at startup)
await this.api.realm?.init("ws://realm.example.com:3000", "Leerie");

// Send a message
await this.api.realm?.sendMessage("Tyro", "I'll be there around 3 on Thursday");

// Beam data (fire-and-forget)
await this.api.realm?.beam("Tyro", "fishing-data", { location: "NY Harbor", species: "Bass" });

// Query peer (request-response)
const response = await this.api.realm?.query("Tyro", "get-status", {});
```

## Connection Strategy

1. **WebSocket First**: Attempts direct WebSocket connection using peer's registered address
2. **WebRTC Fallback**: If WebSocket fails (NAT/firewall), automatically falls back to WebRTC
3. **Message Queuing**: Messages are queued if peer is offline and sent when connection is established

## API Reference

### `realm.init(discoveryUrl, callSign, options?)`

Initialize Realm connection.

```typescript
await api.realm?.init("ws://realm.example.com:3000", "Leerie", {
  token: "optional-auth-token",
  localWsPort: 4000,
  heartbeatInterval: 30000,
  stunServers: [{ urls: "stun:stun.l.google.com:19302" }],
  turnServers: [],
});
```

### `realm.disconnect()`

Disconnect from Realm and cleanup all connections.

### `realm.sendMessage(to, content)`

Send a text message to a peer.

```typescript
await api.realm?.sendMessage("Tyro", "Hello!");
```

### `realm.beam(target, eventType, payload)`

Beam (fire-and-forget) data to peer(s).

```typescript
await api.realm?.beam("Tyro", "fishing-data", { location: "NY Harbor" });
await api.realm?.beam(["Tyro", "Alice"], "group-update", { message: "Hello all" });
```

### `realm.query(target, queryType, payload, timeout?)`

Query a peer and wait for response.

```typescript
const status = await api.realm?.query("Tyro", "get-status", {}, 5000);
```

### `realm.getPeerStatus(callSign)`

Check if a peer is online.

```typescript
const status = await api.realm?.getPeerStatus("Tyro");
// { online: true, wsAddress: "ws://192.168.1.100:4000" }
```

### `realm.sendMedia(to, stream)`

Send media stream (audio/video) via WebRTC.

```typescript
// Requires browser MediaStream API
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
await api.realm?.sendMedia("Tyro", stream);
```

## Events

Realm emits events via `api.events`:

- `realm:message` - Incoming text message
  ```typescript
  api.events.on("realm:message", (data: { from: string; content: string }) => {
    console.log(`Message from ${data.from}: ${data.content}`);
  });
  ```

- `realm:beam:<eventType>` - Incoming beam data
  ```typescript
  api.events.on("realm:beam:fishing-data", (payload) => {
    console.log("Fishing data:", payload);
  });
  ```

## Voice Messaging Agent

The `voice-messaging.ts` agent demonstrates:

- Receiving messages via Realm
- Queuing messages until user is available
- Parsing voice commands (template for STT integration)
- Relaying messages (template for TTS integration)

### Usage

```typescript
// In your agent
const agent = new VoiceMessagingAgent(api);

// Handle voice command (when STT is integrated)
await agent.handleVoiceCommand("Hey Ronin, send Tyro a message: I'll be there around 3");
```

## WebRTC Support

WebRTC is used as a fallback when direct WebSocket connections fail. Note:

- **Browser Environment**: Full WebRTC support (RTCPeerConnection, MediaStream, etc.)
- **Node.js/Bun**: May require polyfills or external libraries (e.g., `wrtc` package)
- **STUN/TURN**: Configure STUN servers for NAT traversal, TURN servers for strict NATs

## Security Considerations

- Use token-based authentication for Realm registration
- WebRTC connections are encrypted by default
- Consider rate limiting on Realm server
- Validate peer call signs before accepting connections

## Troubleshooting

### "Realm plugin not found"
- Ensure `plugins/realm.ts` exists
- Check plugin directory path: `--plugin-dir ./plugins`

### "WebRTC not available"
- WebRTC APIs may not be available in Bun/Node.js
- WebSocket connections will still work for same-network peers
- For WebRTC, consider using browser environment or `wrtc` package

### "Peer offline"
- Check Realm server is running
- Verify peer has connected: `ronin realm discover <callsign>`
- Check network connectivity and firewall settings

### Connection Timeouts
- Ensure Realm server is accessible
- Check firewall allows WebSocket connections
- Verify external IP detection is working (check `api.ipify.org` access)

## Example: Complete Messaging Flow

```typescript
// Agent A (Leerie)
await api.realm?.init("ws://realm.example.com:3000", "Leerie");
await api.realm?.sendMessage("Tyro", "Hello from Leerie!");

// Agent B (Tyro) - receives via event
api.events.on("realm:message", (data) => {
  console.log(`Received: ${data.content} from ${data.from}`);
});
```

## Future Enhancements

- Group messaging/channels
- End-to-end encryption
- File transfer via WebRTC DataChannel
- Presence/status updates
- Message history/persistence
- Federation between Realm servers
