# RoninTray - Swift Edition

A lightweight native macOS menu bar application for quick access to Ronin services.

## Features

- 🥷 Shows ninja icon in menu bar
- 📋 Quick access to Home, Analytics, Dashboard, Blog, Todo, and Config
- 🔍 Monitors Ronin service status (Running/Offline)
- 🔄 Auto-detects Ronin port (tries 17341, 3000, 8000, 9000)
- ⚡ Lightweight (94KB) with instant startup
- 🎮 Keyboard shortcuts: h, a, d, b, t, c for quick navigation
- 🎛️ Start/Stop Ronin directly from menu
- ⏱️ Real-time status updates (2-second polling)

## Installation

### For End Users

```bash
bun run ronin os install mac
```

This will:
1. Install RoninTray.app to ~/Library/Application Support/ronin/
2. Create LaunchAgent for auto-start
3. Launch RoninTray on next login

### For Developers

Clone the repository:

```bash
git clone https://github.com/roninito/ronin.git
cd "Desktop/Bun Apps/RoninTray-Swift"
```

## Development

### Building

Build release binary:

```bash
swift build -c release
```

Binary will be at: `.build/release/RoninTray`

### Testing Changes

To test locally without deploying:

```bash
.build/release/RoninTray &
```

Then access the menu from the macOS menu bar.

### Updating the App

After making changes to `Sources/main.swift`:

#### Option A: Using Build Script (Recommended)

```bash
./build-and-deploy.sh
```

This script will:
1. Build the release binary
2. Deploy to the Ronin repository
3. Commit and push changes
4. Ready for users to reinstall

#### Option B: Manual Steps

```bash
# Build
swift build -c release

# Deploy to Ronin repo
cp .build/release/RoninTray ~/Desktop/Bun\ Apps/ronin/RoninTray.app/Contents/MacOS/RoninTray

# Commit and push (from ronin directory)
cd ~/Desktop/Bun\ Apps/ronin
git add RoninTray.app
git commit -m "Update RoninTray: description of changes"
git push
```

## Source Code

### Main File

**`Sources/main.swift`** (180 lines)

Key components:

- **roninPort** (line 7): Stores detected Ronin port
- **checkRoninStatus()** (lines 27-58): Multi-port health check
- **updateMenu()** (lines 60-70): Periodic status polling
- **refreshMenu()** (lines 72-100): Generates menu based on status
- **Menu Actions**: 
  - `openHome()`: Root dashboard
  - `openAnalytics()`: Analytics page
  - `openDashboard()`: Dependency graph
  - `openBlog()`: Blog section
  - `openTodo()`: Todo management
  - `openConfig()`: Configuration
  - `startRonin()`: Launch Ronin service
  - `stopRonin()`: Stop Ronin service

## Port Detection

RoninTray automatically detects which port Ronin is running on by trying in order:

1. Port 17341 (historical default)
2. Port 3000 (common web server default)
3. Port 8000 (development alternate)
4. Port 9000 (development alternate)

Once detected, the port is stored and reused for all subsequent connections.

## Keyboard Shortcuts

When RoninTray is running:

| Shortcut | Action |
|----------|--------|
| `h` | Open Home |
| `a` | Open Analytics |
| `d` | Open Dashboard (Dependencies) |
| `b` | Open Blog |
| `t` | Open Todo |
| `c` | Open Config |
| `s` | Start/Stop Ronin |
| `q` | Quit RoninTray |

## Menu Structure

### When Ronin is Running
```
● Ronin Running
─────────────
Home (h)
Analytics (a)
Dashboard (d)
Blog (b)
Todo (t)
Config (c)
─────────────
Stop Ronin (s)
─────────────
Quit RoninTray (q)
```

### When Ronin is Offline
```
○ Ronin Offline
─────────────
Start Ronin (s)
─────────────
Quit RoninTray (q)
```

## Technical Details

### Architecture

- **Language**: Swift 5.9+
- **Minimum macOS**: 10.12+
- **Binary Size**: 94KB
- **Build Time**: ~2 seconds
- **Startup Time**: <100ms
- **Memory Usage**: ~5-10MB
- **CPU Usage**: Negligible (idle), <1% during checks

### Process Management

- Uses `pgrep -f 'bun.*ronin'` to find Ronin processes
- Uses `kill -9` for forceful termination
- Spawns Ronin via `/usr/bin/env bun run` for clean startup

### HTTP Health Checks

- Endpoint: `/api/health`
- Timeout: 0.5 seconds per port
- Polling interval: 2 seconds when menu open
- Non-blocking operations

## Troubleshooting

### RoninTray not starting

Check LaunchAgent:

```bash
launchctl list | grep ronintray
```

Load manually:

```bash
launchctl load ~/Library/LaunchAgents/com.roninito.ronintray.plist
```

### RoninTray not detecting Ronin

Verify Ronin is running:

```bash
ps aux | grep "bun run"
```

Check which port it's using:

```bash
lsof -i :3000  # or 17341, 8000, 9000
```

Force restart RoninTray:

```bash
killall RoninTray
/Applications/RoninTray.app/Contents/MacOS/RoninTray &
```

### Logs

Check system logs:

```bash
log stream --predicate 'process == "RoninTray"' --level debug
```

## Contributing

1. Fork the Ronin repository
2. Create a feature branch
3. Make changes to `Sources/main.swift`
4. Test locally
5. Run `./build-and-deploy.sh` to build and commit
6. Submit pull request

## Future Enhancements

- [ ] Auto-update mechanism (check GitHub releases)
- [ ] Windows version
- [ ] Linux version
- [ ] Dark/light theme support
- [ ] Custom menu items from config
- [ ] Route caching for offline access
- [ ] Statistics dashboard in menu

## License

MIT (same as Ronin)

## Support

For issues and feature requests, see the main [Ronin repository](https://github.com/roninito/ronin).
