# Reticulum Mesh Networking

Integrate Reticulum Network Stack into Ronin for decentralized, censorship-resistant communication between Ronin instances over mesh networks.

## Overview

Reticulum is a cryptography-based networking stack for building local and wide-area networks using readily available hardware. It enables Ronin instances to:

- **Auto-discover** each other on local networks (zero-config)
- **Communicate securely** with end-to-end encryption
- **Operate offline** without internet connectivity
- **Scale globally** via mesh routing
- **Maintain privacy** with ephemeral keys and forward secrecy

## Quick Start

### 1. Install Python Dependencies

```bash
pip install reticulum lxmf
```

### 2. Initialize Reticulum

```typescript
// Initialize with local mesh enabled (auto-discovery on LAN)
await api.reticulum?.init({
  enableLocalMesh: true,
  groupId: "my-home-mesh"
});

console.log("Reticulum initialized!");
```

### 3. Create Identity

```typescript
const identity = await api.reticulum?.createIdentity();
console.log("Identity:", identity?.hash);
```

### 4. Send a Message

```typescript
// Send to another Ronin instance
await api.reticulum?.sendMessage(
  "abc123def456...",  // Destination hash
  "Hello from Ronin!"
);
```

### 5. Receive Messages

```typescript
const message = await api.reticulum?.receiveMessage();
if (message) {
  console.log(`From ${message.source}: ${message.content}`);
}
```

## Network Modes

### Local Mesh (LAN)

Auto-discover Ronin instances on your local network using IPv6 multicast.

```typescript
await api.reticulum?.init({
  enableLocalMesh: true,
  groupId: "my-home-mesh",  // Network name
});
```

**Features:**
- ✅ Zero configuration
- ✅ Auto-discovery via IPv6 multicast
- ✅ Works without internet
- ✅ UDP ports: 29716 (discovery), 42671 (data)

**Requirements:**
- Devices on same WiFi/Ethernet network
- Link-local IPv6 support (default on modern OSes)
- Firewall rules allowing UDP ports 29716, 42671

### Private Network (Shared Key)

Create a private encrypted network with shared secret authentication.

```typescript
// Generate key on first instance
const key = await api.reticulum?.generateSharedKey();
console.log("Share this key:", key);

// On all instances, join with the key
await api.reticulum?.init({
  sharedKey: key,
  networkName: "my-private-mesh"
});
```

**Features:**
- ✅ Encrypted communication
- ✅ Shared secret authentication
- ✅ Isolated from other networks
- ✅ Can span internet (wide-area)

**Security:**
- Key must be shared securely (in-person, encrypted channel, etc.)
- All instances use same key to join network
- Compromised key = compromised network

### Wide-Area Mesh

Connect to Reticulum's global mesh network.

```typescript
await api.reticulum?.init({
  enableWideArea: true,
  discoveryScope: "global"  // or "link", "admin", "site", "organisation"
});
```

**Discovery Scopes:**
- `link` - Local network segment only
- `admin` - Administrative domain
- `site` - Site-wide (e.g., campus)
- `organisation` - Organization-wide
- `global` - Global Reticulum mesh

**Requirements:**
- Internet connectivity
- May require additional configuration for NAT traversal

## API Reference

### Initialization

#### `init(options?)`

Initialize Reticulum network.

**Options:**
```typescript
interface ReticulumOptions {
  enableLocalMesh?: boolean;      // Enable LAN auto-discovery
  groupId?: string;                // Network group ID (default: "ronin-mesh")
  sharedKey?: string;              // Shared secret for private network
  networkName?: string;            // Name for private network
  enableWideArea?: boolean;        // Enable wide-area mesh
  discoveryScope?: string;         // "link", "admin", "site", "organisation", "global"
  configPath?: string;             // Path to Reticulum config directory
  appName?: string;                // Application name (default: "ronin")
}
```

**Example:**
```typescript
await api.reticulum?.init({
  enableLocalMesh: true,
  groupId: "home-mesh",
  enableWideArea: false,
});
```

### Identity Management

#### `createIdentity()`

Create a new Reticulum identity.

```typescript
const identity = await api.reticulum?.createIdentity();
console.log("Identity hash:", identity?.hash);
```

#### `loadIdentity(path)`

Load existing identity from file.

```typescript
const identity = await api.reticulum?.loadIdentity("~/.ronin/reticulum/identity");
```

#### `getIdentity()`

Get current identity.

```typescript
const identity = await api.reticulum?.getIdentity();
if (identity) {
  console.log("Identity:", identity.hash);
}
```

### Destination Management

#### `createDestination(aspects, appName?)`

Create a destination for receiving messages.

```typescript
const dest = await api.reticulum?.createDestination(
  ["messaging", "v1"],
  "ronin"
);
console.log("Destination:", dest?.hash);
```

#### `announce(appData?)`

Announce destination on the network.

```typescript
await api.reticulum?.announce({
  type: "ronin-instance",
  services: ["messaging", "skills", "backup"],
  version: "1.0.0"
});
```

### Messaging

#### `sendMessage(destinationHash, content, options?)`

Send an LXMF message.

```typescript
await api.reticulum?.sendMessage(
  "abc123...",
  "Hello!",
  {
    title: "Greeting",
    fields: { priority: "normal" }
  }
);
```

#### `receiveMessage(timeout?)`

Receive an LXMF message.

```typescript
const message = await api.reticulum?.receiveMessage(5000);
if (message) {
  console.log(`From: ${message.source}`);
  console.log(`Content: ${message.content}`);
  console.log(`Title: ${message.title}`);
}
```

### Network Status

#### `getStatus()`

Get network status.

```typescript
const status = await api.reticulum?.getStatus();
console.log("Network status:", status);
// {
//   available: true,
//   identity: "abc123...",
//   destination: "def456...",
//   interfaces: ["AutoInterface"],
//   peerCount: 3
// }
```

#### `getPeers()`

Get list of discovered peers.

```typescript
const peers = await api.reticulum?.getPeers();
for (const peer of peers) {
  console.log(`Peer: ${peer.identityHash}, last heard: ${peer.lastHeard}`);
}
```

### Utilities

#### `generateSharedKey()`

Generate a shared key for private network.

```typescript
const key = await api.reticulum?.generateSharedKey();
console.log("Private network key:", key);
```

#### `getIdentityHash()`

Get identity hash (convenience method).

```typescript
const hash = await api.reticulum?.getIdentityHash();
console.log("Identity:", hash);
```

#### `disconnect()`

Disconnect from Reticulum network.

```typescript
await api.reticulum?.disconnect();
```

## Multi-PC Setup Guide

### Scenario: Home Lab with 3 Machines

**Machines:**
- Desktop (main workstation)
- Laptop (mobile)
- Server (NAS/RPi for storage)

### Step 1: Setup Desktop (Main)

```bash
# Install Reticulum
pip install reticulum lxmf

# Initialize mesh
ronin mesh init --local --name "home-mesh"

# Generate shared key
ronin mesh generate-key
# Output: "xK9mP2vL8nQ4wR7tY3uI6oA5sD1fG0hJ"
```

### Step 2: Setup Laptop

```bash
pip install reticulum lxmf

ronin mesh init --local --name "home-mesh"
ronin mesh join --name "home-mesh"
# Enter key: "xK9mP2vL8nQ4wR7tY3uI6oA5sD1fG0hJ"
```

### Step 3: Setup Server

```bash
pip install reticulum lxmf

ronin mesh init --local --name "home-mesh"
ronin mesh join --name "home-mesh"
# Enter key: "xK9mP2vL8nQ4wR7tY3uI6oA5sD1fG0hJ"
```

### Step 4: Verify Mesh

```bash
ronin mesh list
```

**Output:**
```
Discovered Instances:
┌──────────────┬─────────────────┬──────────────┐
│ Name         │ Instance ID     │ Services     │
├──────────────┼─────────────────┼──────────────┤
│ Desktop      │ abc123...       │ 5            │
│ Laptop       │ def456...       │ 3            │
│ Server       │ ghi789...       │ 8            │
└──────────────┴─────────────────┴──────────────┘
```

### Step 5: Use Remote Skills

```typescript
// Execute skill on Server from Laptop
const result = await api.mesh?.executeRemoteService(
  "server-instance",
  "backup-data",
  { path: "/data" }
);
```

## Use Cases

### 1. Distributed Backup

```typescript
// Desktop agent
await api.reticulum?.announce({
  type: "backup-service",
  storagePath: "/backups",
  maxStorage: "1TB"
});

// Laptop agent
const backups = await api.mesh?.discoverServices("backup");
await api.mesh?.executeRemoteService(
  backups[0].instanceId,
  "backup",
  { source: "/important-files", destination: "laptop-backup" }
);
```

### 2. Remote Code Execution

```typescript
// Powerful desktop offers code review service
await api.reticulum?.announce({
  type: "code-review-service",
  languages: ["typescript", "python", "rust"],
  maxFileSize: "10MB"
});

// Laptop submits code for review
const review = await api.mesh?.executeRemoteService(
  "desktop-instance",
  "code-review",
  { code: "...", language: "typescript" }
);
```

### 3. Distributed Monitoring

```typescript
// All instances announce monitoring capabilities
await api.reticulum?.announce({
  type: "monitor",
  metrics: ["cpu", "memory", "disk"],
  interval: 60
});

// Central collector gathers metrics
const monitors = await api.mesh?.discoverServices("monitor");
const metrics = await Promise.all(
  monitors.map(m => api.mesh?.executeRemoteService(
    m.instanceId,
    "get-metrics",
    {}
  ))
);
```

### 4. Offline Mesh Communication

```typescript
// Cabin in the woods with no internet
// Multiple devices communicate via local mesh

await api.reticulum?.init({
  enableLocalMesh: true,
  enableWideArea: false  // No internet
});

// Devices discover each other automatically
// Messages routed via WiFi/LoRa packet radio
```

## Security Considerations

### Trust Levels

```typescript
enum MeshTrustLevel {
  LOCAL_ONLY = "local-only",      // LAN only, no auth
  PRIVATE_KEY = "private-key",    // Shared secret required
  VERIFIED = "verified",          // Manually verified
  UNTRUSTED = "untrusted",        // Wide-area (restricted)
}
```

### Best Practices

1. **Use shared keys for private networks**
   ```typescript
   await api.reticulum?.init({
     sharedKey: "your-secret-key",
     networkName: "private-mesh"
   });
   ```

2. **Whitelist trusted instances**
   ```typescript
   const trustedInstances = [
     "abc123...",  // Desktop
     "def456...",  // Laptop
     "ghi789..."   // Server
   ];
   ```

3. **Limit service exposure**
   ```typescript
   // Only expose specific services
   await api.reticulum?.announce({
     services: ["backup", "monitoring"],  // Not all services
   });
   ```

4. **Monitor peer connections**
   ```typescript
   const peers = await api.reticulum?.getPeers();
   for (const peer of peers) {
     if (!trustedInstances.includes(peer.identityHash)) {
       console.warn("Untrusted peer detected:", peer.identityHash);
     }
   }
   ```

## Troubleshooting

### "Reticulum not installed"

```bash
pip install reticulum lxmf
```

### "python3 not found"

Install Python 3.8+:

```bash
# macOS
brew install python@3.11

# Ubuntu/Debian
sudo apt install python3 python3-pip
```

### Peers not discovering each other

1. **Check firewall rules:**
   ```bash
   # Allow UDP ports 29716, 42671
   sudo ufw allow 29716/udp
   sudo ufw allow 42671/udp
   ```

2. **Verify IPv6 is enabled:**
   ```bash
   # Check IPv6
   ip -6 addr
   ```

3. **Check WiFi client isolation:**
   - Some routers block device-to-device communication
   - Disable "AP isolation" or "client isolation" in router settings

### Messages not delivered

1. **Check destination announcements:**
   ```typescript
   const status = await api.reticulum?.getStatus();
   console.log("Destination:", status.destination);
   ```

2. **Verify peer connectivity:**
   ```typescript
   const peers = await api.reticulum?.getPeers();
   console.log("Peer count:", peers.length);
   ```

3. **Check message queue:**
   ```typescript
   const messages = await api.reticulum?.receiveMessage();
   console.log("Messages:", messages);
   ```

## Advanced Configuration

### Custom Reticulum Config

Create `~/.reticulum/config`:

```ini
[Reticulum]
  loglevel = 4

[[Default Interface]]
  type = AutoInterface
  enabled = yes
  group_id = my-custom-mesh
  discovery_scope = link
```

Then initialize with:

```typescript
await api.reticulum?.init({
  configPath: "~/.reticulum",
  enableLocalMesh: false  // Use config file settings
});
```

### Multiple Interfaces

```typescript
await api.reticulum?.init({
  enableLocalMesh: true,
  groupId: "local-mesh",
  enableWideArea: true,
  discoveryScope: "global"
});

// Now connected to both local and wide-area mesh
```

## Next Steps

- [Python Bridge Documentation](./PYTHON_BRIDGE.md) - Understanding the Python integration
- [Mesh Networking Guide](./MESH_NETWORKING.md) - Advanced mesh configuration
- [Distributed SAR Chain](./DISTRIBUTED_SAR.md) - Remote chain execution

## Resources

- [Reticulum Manual](https://reticulum.network/manual/)
- [LXMF Documentation](https://markqvist.github.io/LXMF/)
- [Reticulum GitHub](https://github.com/markqvist/Reticulum)

## License

Part of the Ronin project.
