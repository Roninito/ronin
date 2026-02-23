/**
 * Mesh Network Diagnostic Agent
 * 
 * Run this on both machines to diagnose mesh networking issues.
 * 
 * Usage:
 *   ronin run mesh-diagnostic
 */

export default class MeshDiagnosticAgent extends BaseAgent {
  async execute(): Promise<void> {
    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║     Ronin Mesh Network Diagnostic                         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    // 1. Check Python
    console.log("1️⃣  Checking Python installation...");
    try {
      const hasPython = await this.api.python?.hasPython();
      if (hasPython) {
        const version = await this.api.python?.getPythonVersion();
        console.log(`   ✅ Python: ${version}`);
      } else {
        console.log(`   ❌ Python not found!`);
        console.log(`      Install from: https://python.org`);
        console.log(`      Or: winget install Python.Python.3.11`);
      }
    } catch (error) {
      console.log(`   ❌ Python check failed: ${error}`);
    }
    console.log("");

    // 2. Check Reticulum
    console.log("2️⃣  Checking Reticulum installation...");
    try {
      const result = await this.api.python?.execute(`
import sys
try:
    import RNS
    import LXMF
    print(f"RNS:{RNS.__version__ if hasattr(RNS, '__version__') else 'installed'}")
    print(f"LXMF:installed")
except ImportError as e:
    print(f"ERROR:{e}")
`.trim());
      
      if (result && typeof result === 'string' && result.includes('RNS:')) {
        console.log(`   ✅ Reticulum: Installed`);
        const lines = result.split('\n');
        for (const line of lines) {
          if (line.startsWith('RNS:')) {
            console.log(`      ${line}`);
          }
          if (line.startsWith('LXMF:')) {
            console.log(`      ${line}`);
          }
        }
      } else {
        console.log(`   ❌ Reticulum not installed!`);
        console.log(`      Run: pip install reticulum lxmf`);
      }
    } catch (error) {
      console.log(`   ❌ Reticulum check failed: ${error}`);
    }
    console.log("");

    // 3. Initialize Reticulum
    console.log("3️⃣  Initializing Reticulum...");
    try {
      const status = await this.api.reticulum?.init({
        enableLocalMesh: true,
        groupId: "ronin-mesh",
      });
      
      if (status?.available) {
        console.log(`   ✅ Reticulum initialized`);
        console.log(`      Identity: ${status.identity?.slice(0, 16)}...`);
        console.log(`      Interfaces: ${status.interfaces?.join(', ') || 'none'}`);
        console.log(`      Peers: ${status.peerCount || 0}`);
      } else {
        console.log(`   ⚠️  Reticulum initialized but unavailable`);
        console.log(`      Status: ${JSON.stringify(status)}`);
      }
    } catch (error) {
      console.log(`   ❌ Reticulum initialization failed: ${error}`);
      console.log(`      Make sure reticulum is installed: pip install reticulum lxmf`);
    }
    console.log("");

    // 4. Advertise Service
    console.log("4️⃣  Advertising test service...");
    try {
      await this.api.mesh?.advertise([
        {
          name: "diagnostic-service",
          type: "skill",
          description: "Test service from mesh diagnostic",
          capabilities: ["test", "diagnostic"],
        }
      ]);
      console.log(`   ✅ Service advertised`);
    } catch (error) {
      console.log(`   ⚠️  Service advertisement failed: ${error}`);
      console.log(`      This is OK if mesh is not configured`);
    }
    console.log("");

    // 5. Discover Services
    console.log("5️⃣  Discovering services on mesh...");
    try {
      // Wait a moment for advertisements to propagate
      console.log(`   ⏳ Waiting 5 seconds for network...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const providers = this.api.mesh?.discoverServices();
      
      if (providers && providers.length > 0) {
        console.log(`   ✅ Discovered ${providers.length} provider(s):`);
        for (const provider of providers) {
          console.log(`      - ${provider.instance.instanceName}`);
          console.log(`        ID: ${provider.instance.instanceId.slice(0, 16)}...`);
          console.log(`        Services: ${provider.instance.services.length}`);
          console.log(`        Distance: ${provider.distance} hop(s)`);
          console.log(`        Reliability: ${(provider.reliability * 100).toFixed(0)}%`);
        }
      } else {
        console.log(`   ⚠️  No providers discovered`);
        console.log(`      This could mean:`);
        console.log(`      - No other Ronin instances on network`);
        console.log(`      - Firewall blocking discovery`);
        console.log(`      - Different groupId configured`);
        console.log(`      - IPv6 not enabled`);
      }
    } catch (error) {
      console.log(`   ❌ Discovery failed: ${error}`);
    }
    console.log("");

    // 6. Network Info
    console.log("6️⃣  Network Information...");
    try {
      const { exec } = await import("child_process");
      
      // Get hostname
      const hostname = await new Promise<string>((resolve) => {
        exec("hostname", (error, stdout) => {
          resolve(stdout.trim());
        });
      });
      console.log(`   Hostname: ${hostname}`);
      
      // Get IP addresses (Windows)
      const ipconfig = await new Promise<string>((resolve) => {
        exec("ipconfig", (error, stdout) => {
          resolve(stdout);
        });
      });
      
      const ipv4Matches = ipconfig.match(/IPv4 Address[.:]\s*([0-9.]+)/g);
      if (ipv4Matches) {
        console.log(`   IPv4 Addresses:`);
        for (const match of ipv4Matches) {
          console.log(`      - ${match.split(':')[1]?.trim() || match}`);
        }
      }
      
      const ipv6Matches = ipconfig.match(/IPv6 Address[.:]\s*([0-9a-fA-F:]+)/g);
      if (ipv6Matches && ipv6Matches.length > 0) {
        console.log(`   IPv6 Addresses: Enabled (${ipv6Matches.length} found)`);
      } else {
        console.log(`   ⚠️  IPv6 Addresses: Not found (may affect discovery)`);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not get network info: ${error}`);
    }
    console.log("");

    // 7. Configuration Check
    console.log("7️⃣  Configuration Check...");
    try {
      const meshConfig = this.api.config.getMesh();
      console.log(`   Mesh Enabled: ${meshConfig.enabled}`);
      console.log(`   Mode: ${meshConfig.mode}`);
      console.log(`   Local Mesh: ${meshConfig.localMesh.enabled}`);
      console.log(`   Group ID: ${meshConfig.localMesh.groupId}`);
      console.log(`   Private Network: ${meshConfig.privateNetwork.enabled}`);
      console.log(`   Wide Area: ${meshConfig.wideArea.enabled}`);
      
      if (!meshConfig.enabled) {
        console.log(`   ⚠️  Mesh is disabled in config!`);
        console.log(`      Run: ronin config --set mesh.enabled true`);
      }
      
      if (!meshConfig.localMesh.enabled) {
        console.log(`   ⚠️  Local mesh is disabled!`);
        console.log(`      Run: ronin config --set mesh.localMesh.enabled true`);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not read config: ${error}`);
    }
    console.log("");

    // Summary
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║                    Diagnostic Summary                     ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");
    
    console.log("If you see ❌ errors above:");
    console.log("  1. Fix the identified issues");
    console.log("  2. Restart Ronin: ronin stop && ronin start");
    console.log("  3. Run this diagnostic again\n");
    
    console.log("If no providers discovered:");
    console.log("  1. Ensure both machines have same groupId");
    console.log("  2. Check firewall allows UDP 29716, 42671");
    console.log("  3. Verify IPv6 is enabled");
    console.log("  4. Check WiFi client isolation is disabled");
    console.log("  5. See: docs/WINDOWS_MESH_TROUBLESHOOTING.md\n");
    
    console.log("Next steps:");
    console.log("  • Run this diagnostic on the other machine");
    console.log("  • Compare results");
    console.log("  • Both should show ✅ for Python, Reticulum, and Initialization\n");
  }
}
