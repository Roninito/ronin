# 🚨 Quick Fix: Ronin Mesh Not Working on Windows

## 30-Second Fixes

### 1. Install Python (if not installed)
```powershell
winget install Python.Python.3.11
```
✅ **Check "Add to PATH" during install!**

### 2. Install Reticulum
```powershell
pip install reticulum lxmf
```

### 3. Enable Mesh in Config
```bash
ronin config --set mesh.enabled true
ronin config --set mesh.localMesh.enabled true
ronin config --set mesh.localMesh.groupId "my-home-mesh"
```

### 4. Allow Through Firewall (Admin PowerShell)
```powershell
netsh advfirewall firewall add rule name="Reticulum Discovery" dir=in action=allow protocol=UDP localport=29716
netsh advfirewall firewall add rule name="Reticulum Data" dir=in action=allow protocol=UDP localport=42671
```

### 5. Restart Ronin
```bash
ronin stop
ronin start
```

### 6. Run Diagnostic
```bash
ronin run mesh-diagnostic
```

---

## 2-Minute Checklist

Run through this on **BOTH machines**:

- [ ] **Python installed?**
  ```powershell
  python --version
  ```

- [ ] **Reticulum installed?**
  ```powershell
  python -c "import RNS; print('OK')"
  ```

- [ ] **Mesh enabled?**
  ```bash
  ronin config --show | findstr mesh
  ```

- [ ] **Same groupId on both?**
  ```bash
  ronin config --show | findstr groupId
  ```

- [ ] **Firewall rules added?** (See step 4 above)

- [ ] **IPv6 enabled?**
  1. Network Connections → Adapter Properties
  2. ✅ Check "Internet Protocol Version 6 (TCP/IPv6)"

- [ ] **Can ping other machine?**
  ```powershell
  ping <other-machine-ip>
  ```

---

## Common Scenarios

### "Python not found"
```powershell
# Install Python
winget install Python.Python.3.11

# Restart terminal

# Verify
python --version
```

### "Module not found: RNS"
```powershell
pip install reticulum lxmf
```

### "No providers discovered"
1. Check both machines have **same groupId**:
   ```bash
   ronin config --set mesh.localMesh.groupId "my-home-mesh"
   ```

2. Check firewall:
   ```powershell
   # Run as Admin
   netsh advfirewall firewall show rule name=all | findstr Reticulum
   ```

3. Disable WiFi isolation in router settings

4. Restart Ronin:
   ```bash
   ronin stop
   ronin start
   ```

### "Mesh config not found"
Enable mesh networking:
```bash
ronin config --set mesh.enabled true
ronin config --set mesh.localMesh.enabled true
ronin config --set mesh.instance.name "my-windows-pc"
```

---

## Test It Works

Run on **both machines**:

```bash
ronin run mesh-diagnostic
```

**Expected output:**
```
✅ Python: Python 3.11.x
✅ Reticulum: Installed
✅ Reticulum initialized
✅ Service advertised
✅ Discovered 1 provider(s)  ← On at least one machine
```

---

## Still Broken?

### Enable Debug Mode
```powershell
$env:DEBUG = "ronin:*"
ronin start
```

### Check Logs
```bash
ronin list
ronin status
```

### Manual Test
```bash
# On Windows machine
ronin run mesh-diagnostic

# On other machine
ronin run mesh-diagnostic

# Compare outputs - both should show ✅
```

---

## Nuclear Option (Reset Everything)

```bash
# Stop Ronin
ronin stop

# Clear config
rm ~/.ronin/config.json

# Re-initialize
ronin init

# Enable mesh
ronin config --set mesh.enabled true
ronin config --set mesh.localMesh.enabled true
ronin config --set mesh.localMesh.groupId "my-home-mesh"

# Install Python deps
pip install reticulum lxmf

# Add firewall rules (Admin PowerShell)
netsh advfirewall firewall add rule name="Reticulum Discovery" dir=in action=allow protocol=UDP localport=29716
netsh advfirewall firewall add rule name="Reticulum Data" dir=in action=allow protocol=UDP localport=42671

# Start Ronin
ronin start

# Test
ronin run mesh-diagnostic
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `python --version` | Check Python |
| `pip install reticulum lxmf` | Install Reticulum |
| `ronin config --show` | View config |
| `ronin config --set ...` | Set config |
| `ronin run mesh-diagnostic` | Run diagnostics |
| `ronin stop && ronin start` | Restart Ronin |

---

**Need help?** Share the output from `ronin run mesh-diagnostic` on both machines.

Good luck! 🚀
