# Mesh Networking Quick Start

Get Ronin mesh networking up and running in 5 minutes!

## Prerequisites

- Python 3.8+ installed
- 2+ machines on the same network (for testing)
- Ronin installed on all machines

---

## Step 1: Install Python Dependencies

On **all machines**:

```bash
pip install reticulum lxmf
```

Verify installation:

```bash
python3 -c "import RNS; import LXMF; print('OK')"
```

---

## Step 2: Enable Mesh Networking

On **all machines**, edit `~/.ronin/config.json`:

```json
{
  "mesh": {
    "enabled": true,
    "mode": "local-only",
    "localMesh": {
      "enabled": true,
      "groupId": "my-home-mesh"
    },
    "instance": {
      "name": "my-ronin-pc"
    }
  }
}
```

Or use the config command:

```bash
ronin config --set mesh.enabled true
ronin config --set mesh.localMesh.enabled true
ronin config --set mesh.localMesh.groupId "my-home-mesh"
ronin config --set mesh.instance.name "my-ronin-pc"
```

---

## Step 3: Start Ronin

On **all machines**:

```bash
ronin start
```

You should see:

```
[mesh] Mesh discovery initialized
[reticulum] Initialized with identity: abc123def456...
```

---

## Step 4: Test Mesh Discovery

On **any machine**, create a test agent:

```typescript
// agents/test-mesh.ts
export default class TestMeshAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Check mesh status
    const stats = this.api.mesh?.getStats();
    console.log("Mesh stats:", stats);
    
    // Discover services
    const providers = this.api.mesh?.discoverServices();
    console.log("Discovered providers:", providers.length);
    
    for (const provider of providers) {
      console.log(`- ${provider.instance.instanceName}: ${provider.instance.services.length} services`);
    }
  }
}
```

Run it:

```bash
ronin run test-mesh
```

---

## Step 5: Advertise a Service

Create a service provider agent:

```typescript
// agents/backup-provider.ts
export default class BackupProviderAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Advertise backup service on mesh
    await this.api.mesh?.advertise([
      {
        name: "backup-service",
        type: "skill",
        description: "Backup files to server",
        capabilities: ["backup", "restore", "sync"],
      }
    ]);
    
    console.log("Backup service advertised on mesh!");
  }
}
```

Run it:

```bash
ronin run backup-provider
```

---

## Step 6: Discover and Use Service

Create a service consumer agent:

```typescript
// agents/backup-client.ts
export default class BackupClientAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Discover backup services
    const providers = this.api.mesh?.discoverServices("backup");
    
    if (providers.length === 0) {
      console.log("No backup services found on mesh");
      return;
    }
    
    console.log(`Found ${providers.length} backup service(s):`);
    for (const provider of providers) {
      console.log(`- ${provider.instance.instanceName}`);
    }
    
    // Execute remote service
    const target = providers[0];
    console.log(`\nExecuting backup on ${target.instance.instanceName}...`);
    
    try {
      const result = await this.api.mesh?.executeRemoteService(
        target.instance.instanceId,
        "backup-service",
        {
          source: "/important-files",
          destination: "backup-123",
        }
      );
      
      console.log("Backup result:", result);
    } catch (error) {
      console.error("Backup failed:", error);
    }
  }
}
```

Run it:

```bash
ronin run backup-client
```

---

## Private Network Setup (Optional)

For secure communication over internet:

### Generate Shared Key

On **first machine**:

```bash
ronin mesh generate-key
# Output: "xK9mP2vL8nQ4wR7tY3uI6oA5sD1fG0hJ"
```

### Join Private Network

On **all other machines**:

```bash
ronin config --set mesh.privateNetwork.enabled true
ronin config --set mesh.privateNetwork.sharedKey "xK9mP2vL8nQ4wR7tY3uI6oA5sD1fG0hJ"
ronin config --set mesh.privateNetwork.networkName "my-private-mesh"
```

Restart Ronin on all machines:

```bash
ronin start
```

---

## Troubleshooting

### No Providers Discovered

1. **Check mesh is enabled:**
   ```bash
   ronin config --show | grep mesh
   ```

2. **Check firewall:**
   ```bash
   # Allow UDP ports 29716, 42671
   sudo ufw allow 29716/udp
   sudo ufw allow 42671/udp
   ```

3. **Check IPv6:**
   ```bash
   ip -6 addr
   ```

4. **Verify Reticulum:**
   ```bash
   python3 -c "import RNS; print(RNS.__version__)"
   ```

### Python Not Found

Install Python 3.8+:

```bash
# macOS
brew install python@3.11

# Ubuntu/Debian
sudo apt install python3 python3-pip
```

### Reticulum Not Installed

```bash
pip install reticulum lxmf
```

---

## Next Steps

- [Full Documentation](./RETICULUM.md) - Complete API reference
- [Python Bridge Guide](./PYTHON_BRIDGE.md) - Create Python backends
- [Mesh Integration Summary](./RETICULUM_INTEGRATION_SUMMARY.md) - Architecture overview

---

## Quick Reference

### Commands

```bash
# Enable mesh
ronin config --set mesh.enabled true

# Generate key
ronin mesh generate-key

# List discovered instances
ronin mesh list

# Show status
ronin mesh status
```

### API Methods

```typescript
// Initialize
await api.reticulum?.init({ enableLocalMesh: true });

// Advertise
await api.mesh?.advertise([service]);

// Discover
const providers = api.mesh?.discoverServices("query");

// Execute
await api.mesh?.executeRemoteService(instanceId, serviceName, params);
```

---

**Happy Mesh Networking!** 🚀
