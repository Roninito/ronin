# Windows Mesh Networking Troubleshooting Guide

## Quick Diagnosis

Run these commands on **both machines** (Windows and your other machine):

### 1. Check Python Installation

```powershell
# Windows PowerShell
python --version
python3 --version

# Should output: Python 3.x.x
```

If Python is not found:
```powershell
# Install via winget
winget install Python.Python.3.11

# Or download from: https://python.org
```

### 2. Check Reticulum Installation

```powershell
python -c "import RNS; import LXMF; print('Reticulum OK')"
```

If import fails:
```powershell
pip install reticulum lxmf
```

### 3. Check Ronin Configuration

```bash
# On both machines
ronin config --show | findstr mesh
```

Should show:
```
mesh.enabled: true
mesh.localMesh.enabled: true
mesh.localMesh.groupId: "ronin-mesh" (or your group ID)
```

### 4. Check Firewall Rules (Windows)

```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="Reticulum Discovery" dir=in action=allow protocol=UDP localport=29716
netsh advfirewall firewall add rule name="Reticulum Data" dir=in action=allow protocol=UDP localport=42671
```

### 5. Check Network Connectivity

```powershell
# Get IP addresses
ipconfig

# Ping the other machine
ping <other-machine-ip>

# Check if machines are on same subnet
# Both should be 192.168.x.x or 10.x.x.x
```

---

## Common Issues & Solutions

### Issue 1: Python Not Found

**Symptom:** `python is not recognized as an internal or external command`

**Solution:**
1. Install Python from https://python.org
2. ✅ Check "Add Python to PATH" during installation
3. Restart terminal/PowerShell
4. Verify: `python --version`

### Issue 2: Reticulum Not Installed

**Symptom:** `ModuleNotFoundError: No module named 'RNS'`

**Solution:**
```powershell
pip install reticulum lxmf
```

### Issue 3: Firewall Blocking

**Symptom:** Machines can't discover each other

**Solution (Windows):**
```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="Reticulum" dir=in action=allow protocol=UDP localport=29716
netsh advfirewall firewall add rule name="Reticulum Data" dir=in action=allow protocol=UDP localport=42671

# Or disable firewall temporarily for testing
netsh advfirewall set allprofiles state off
```

**Solution (Other machine):**
```bash
# Ubuntu/Debian
sudo ufw allow 29716/udp
sudo ufw allow 42671/udp

# macOS
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off
```

### Issue 4: IPv6 Not Enabled

**Symptom:** Auto-discovery not working

**Solution (Windows):**
1. Open Network Connections
2. Right-click your network adapter → Properties
3. ✅ Check "Internet Protocol Version 6 (TCP/IPv6)"
4. Click OK

**Verify:**
```powershell
ipconfig
# Should show IPv6 addresses
```

### Issue 5: WiFi Client Isolation

**Symptom:** Devices on same WiFi can't see each other

**Solution:**
1. Log into your router admin panel
2. Find "AP Isolation", "Client Isolation", or "WiFi Isolation"
3. **Disable** it
4. Save and restart router

### Issue 6: Different Network Groups

**Symptom:** Not discovering peers

**Solution:**
Ensure both machines use the **same groupId**:

```bash
# On both machines
ronin config --set mesh.localMesh.groupId "my-home-mesh"
```

Then restart Ronin:
```bash
ronin stop
ronin start
```

---

## Diagnostic Script

Create `test-mesh.ps1` on Windows:

```powershell
# test-mesh.ps1 - Mesh Network Diagnostic Script

Write-Host "=== Ronin Mesh Network Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

# 1. Python Check
Write-Host "1. Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "   ✓ Python: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Python not found!" -ForegroundColor Red
    Write-Host "   Install from: https://python.org" -ForegroundColor Yellow
}
Write-Host ""

# 2. Reticulum Check
Write-Host "2. Checking Reticulum..." -ForegroundColor Yellow
try {
    $reticulumCheck = python -c "import RNS; import LXMF; print('OK')" 2>&1
    Write-Host "   ✓ Reticulum: Installed" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Reticulum not installed!" -ForegroundColor Red
    Write-Host "   Run: pip install reticulum lxmf" -ForegroundColor Yellow
}
Write-Host ""

# 3. Network Check
Write-Host "3. Checking Network..." -ForegroundColor Yellow
$ipConfig = ipconfig | Select-String "IPv4"
Write-Host "   IP Addresses:" -ForegroundColor Gray
foreach ($line in $ipConfig) {
    Write-Host "   - $line" -ForegroundColor Gray
}
Write-Host ""

# 4. Firewall Check
Write-Host "4. Checking Firewall Rules..." -ForegroundColor Yellow
$firewallRules = netsh advfirewall firewall show rule name=all | Select-String "Reticulum"
if ($firewallRules) {
    Write-Host "   ✓ Firewall rules found" -ForegroundColor Green
} else {
    Write-Host "   ⚠ No firewall rules found" -ForegroundColor Yellow
    Write-Host "   Run (as Admin):" -ForegroundColor Gray
    Write-Host "   netsh advfirewall firewall add rule name=`"Reticulum Discovery`" dir=in action=allow protocol=UDP localport=29716" -ForegroundColor Gray
    Write-Host "   netsh advfirewall firewall add rule name=`"Reticulum Data`" dir=in action=allow protocol=UDP localport=42671" -ForegroundColor Gray
}
Write-Host ""

# 5. Ronin Config Check
Write-Host "5. Checking Ronin Config..." -ForegroundColor Yellow
try {
    $meshConfig = ronin config --show 2>&1 | Select-String "mesh"
    if ($meshConfig) {
        Write-Host "   ✓ Mesh config found:" -ForegroundColor Green
        foreach ($line in $meshConfig) {
            Write-Host "   - $line" -ForegroundColor Gray
        }
    } else {
        Write-Host "   ⚠ Mesh config not found" -ForegroundColor Yellow
        Write-Host "   Run: ronin config --set mesh.enabled true" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ✗ Could not read Ronin config" -ForegroundColor Red
}
Write-Host ""

# 6. Ping Test
Write-Host "6. Network Connectivity Test..." -ForegroundColor Yellow
Write-Host "   Enter other machine's IP (or press Enter to skip):" -ForegroundColor Gray
$targetIP = Read-Host
if ($targetIP) {
    try {
        $pingResult = Test-Connection -ComputerName $targetIP -Count 2 -Quiet
        if ($pingResult) {
            Write-Host "   ✓ Can reach $targetIP" -ForegroundColor Green
        } else {
            Write-Host "   ✗ Cannot reach $targetIP" -ForegroundColor Red
            Write-Host "   Check firewall and network settings" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "   ✗ Ping failed: $_" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "=== Diagnostic Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Fix any ✗ issues above" -ForegroundColor Gray
Write-Host "2. Ensure both machines have same groupId" -ForegroundColor Gray
Write-Host "3. Restart Ronin: ronin stop && ronin start" -ForegroundColor Gray
Write-Host "4. Check logs: ronin list" -ForegroundColor Gray
```

**Run it:**
```powershell
.\test-mesh.ps1
```

---

## Manual Testing

### Test 1: Initialize Reticulum Manually

On **both machines**:

```typescript
// agents/test-reticulum.ts
export default class TestReticulumAgent extends BaseAgent {
  async execute(): Promise<void> {
    console.log("🔍 Testing Reticulum initialization...");
    
    try {
      const status = await this.api.reticulum?.init({
        enableLocalMesh: true,
        groupId: "my-home-mesh",
      });
      
      console.log("✅ Reticulum initialized!");
      console.log("Status:", JSON.stringify(status, null, 2));
      
      const identity = await this.api.reticulum?.getIdentity();
      console.log("Identity:", identity?.hash);
      
    } catch (error) {
      console.error("❌ Reticulum failed:", error);
    }
  }
}
```

Run:
```bash
ronin run test-reticulum
```

### Test 2: Test Mesh Discovery

On **both machines**:

```typescript
// agents/test-discovery.ts
export default class TestDiscoveryAgent extends BaseAgent {
  async execute(): Promise<void> {
    console.log("🔍 Testing mesh discovery...");
    
    try {
      // Advertise our presence
      await this.api.mesh?.advertise([
        {
          name: "test-service",
          type: "skill",
          description: "Test service for discovery",
          capabilities: ["test"],
        }
      ]);
      
      console.log("✅ Advertised service");
      
      // Wait for advertisements to propagate
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Discover services
      const providers = this.api.mesh?.discoverServices();
      
      console.log(`📡 Discovered ${providers.length} provider(s):`);
      for (const provider of providers) {
        console.log(`  - ${provider.instance.instanceName} (${provider.instance.services.length} services)`);
      }
      
    } catch (error) {
      console.error("❌ Discovery failed:", error);
    }
  }
}
```

Run on both machines:
```bash
ronin run test-discovery
```

---

## Windows-Specific Issues

### Python Path Issues

If `python` command doesn't work but Python is installed:

```powershell
# Find Python installation
where python
where python3

# Add to PATH temporarily
$env:Path += ";C:\Users\YourUsername\AppData\Local\Programs\Python\Python311"

# Or add permanently (System Properties → Environment Variables)
```

### PowerShell Execution Policy

If scripts won't run:

```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Windows Defender Firewall

If firewall blocks connections:

1. Open **Windows Defender Firewall**
2. Click **Advanced settings**
3. **Inbound Rules** → **New Rule**
4. Select **Port** → **UDP**
5. Add ports: `29716, 42671`
6. Select **Allow the connection**
7. Name: "Reticulum Mesh"

---

## Quick Fix Checklist

Run through this checklist on **both machines**:

- [ ] Python 3.8+ installed
- [ ] `pip install reticulum lxmf` completed
- [ ] `python -c "import RNS"` works
- [ ] Ronin config has `mesh.enabled: true`
- [ ] Both machines have **same** `groupId`
- [ ] Firewall allows UDP 29716, 42671
- [ ] IPv6 enabled on network adapter
- [ ] WiFi client isolation disabled
- [ ] Machines can ping each other
- [ ] Ronin restarted after config changes

---

## Still Not Working?

### Enable Debug Logging

Edit `~/.ronin/config.json`:

```json
{
  "mesh": {
    "enabled": true,
    // ... other settings
  }
}
```

Add environment variable:

```powershell
$env:DEBUG = "ronin:*"
ronin start
```

### Check Logs

```bash
# View agent logs
ronin list

# Check status
ronin status
```

### Manual Reticulum Test

```python
# test_reticulum.py
import RNS
import LXMF

print("Initializing Reticulum...")
network = RNS.Reticulum()

print("Creating identity...")
identity = RNS.Identity(create_keys=True)
print(f"Identity: {identity.hash.hex()}")

print("Creating destination...")
destination = RNS.Destination(
    identity,
    RNS.Destination.IN,
    RNS.Destination.SINGLE,
    "ronin",
    "test"
)

print("Announcing...")
destination.announce()

print("Done! Waiting for peers...")
import time
time.sleep(30)
```

Run:
```powershell
python test_reticulum.py
```

---

## Contact & Support

If still having issues:
1. Run diagnostic script on both machines
2. Share output from both
3. Check network topology (same router? different subnets?)
4. Verify no corporate firewall/antivirus blocking

---

**Good luck!** 🚀
