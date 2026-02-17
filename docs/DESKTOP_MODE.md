# Ronin Desktop Mode

Seamlessly integrate Ronin with your macOS workflow. Right-click any file to send it to Ronin, capture selected text, and receive native notifications—all while maintaining privacy-first defaults.

## Overview

Desktop Mode bridges the gap between Ronin agents and your operating system:

- **Quick Actions**: Right-click files in Finder → Services → Send to Ronin
- **Native Notifications**: Agents can send macOS notifications grouped under "Ronin"
- **Clipboard Watching**: Opt-in feature to monitor clipboard changes (disabled by default)
- **Menubar Status**: Visual indicator showing Ronin Desktop Mode status
- **File Watching**: Monitor Desktop, Downloads, and other folders

## Installation

### Prerequisites

- macOS 10.14+ (Mojave or later)
- Ronin CLI installed and configured
- Terminal with permission to install system services

### Install macOS Integrations

```bash
ronin os install mac
```

This installs:
1. **Quick Action**: "Send to Ronin" in Finder Services menu
2. **LaunchAgent**: Auto-starts Ronin Desktop Mode with macOS

### Enable Desktop Mode

```bash
# Enable Desktop Mode
ronin config set desktop.enabled true

# Start Ronin with Desktop Mode
ronin start --desktop
```

## Usage

### Sending Files to Ronin

1. Right-click any file in Finder
2. Select **Services** → **Send to Ronin**
3. The file is sent to the OSBridgeAgent, which normalizes and broadcasts it to all agents

### Receiving Notifications

Agents can send native macOS notifications:

```typescript
// In any agent
await this.api.notify({
  title: "Task Complete",
  message: "Your analysis is ready",
  subtitle: "MyAgent",
  sound: true
});
```

### Capturing Selected Text

Text selected from any app can be captured (when explicitly triggered):

```typescript
// Listen for text capture events
this.api.events.on("text.captured", (data) => {
  console.log(`Captured ${data.length} chars from ${data.source}`);
});
```

### Menubar Controls

The menubar (🥷) provides quick access to Desktop Mode controls:

**Available Toggles:**
- **Desktop Mode**: Enable/disable Desktop Mode entirely
- **Offline Mode**: Force local AI only (no cloud calls)
- **Clipboard**: Enable/disable clipboard monitoring
- **AI Provider**: Switch between Local (Ollama), Grok, or Gemini

**Quick Actions:**
- View recent files/texts
- Open Ronin dashboard
- Sync status indicator

### Menubar Events

All menubar interactions emit events that agents can listen to:

```typescript
// Listen for menubar events
this.api.events.on("menubar.desktop.enabled", (data) => {
  console.log("Desktop Mode enabled via menubar");
});

this.api.events.on("menubar.offline.enabled", (data) => {
  console.log("Offline Mode enabled - switching to local AI");
  // Disable cloud features
});

this.api.events.on("menubar.ai.changed", (data) => {
  console.log(`Switched from ${data.previous} to ${data.current}`);
});
```

**Event Reference:**

| Event | Description |
|-------|-------------|
| `menubar.started` | Menubar initialized |
| `menubar.desktop.enabled/disabled` | Desktop Mode toggled |
| `menubar.offline.enabled/disabled` | Offline Mode toggled |
| `menubar.clipboard.enabled/disabled` | Clipboard monitoring toggled |
| `menubar.ai.changed` | AI provider changed |
| `menubar.recentfiles.viewed` | User viewed recent files |
| `menubar.recenttexts.viewed` | User viewed recent texts |
| `menubar.dashboard.opened` | Dashboard opened |
| `menubar.notification.shown` | Notification displayed |
| `menubar.quit` | Menubar stopped |

### Clipboard Watching

**Important**: Clipboard watching is disabled by default and requires explicit user consent.

```bash
# Enable clipboard watching
ronin os clipboard enable
```

## Configuration

### Desktop Mode Settings

```json
{
  "desktop": {
    "enabled": false,
    "features": {
      "notifications": true,
      "clipboard": false,
      "shortcuts": true,
      "fileWatching": true
    },
    "folders": ["~/Desktop", "~/Downloads"],
    "bridge": {
      "port": 17341,
      "host": "localhost"
    },
    "menubar": true
  }
}
```

### Key Options

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Master switch for Desktop Mode | `false` |
| `features.notifications` | Enable native notifications | `true` |
| `features.clipboard` | Enable clipboard watching | `false` |
| `features.shortcuts` | Enable keyboard shortcuts | `true` |
| `features.fileWatching` | Watch configured folders | `true` |
| `folders` | Folders to watch for changes | `~/Desktop`, `~/Downloads` |
| `bridge.port` | HTTP port for OS communications | `17341` |
| `menubar` | Show menubar status indicator | `true` |

## CLI Commands

```bash
# Install macOS integrations
ronin os install mac

# Remove all macOS integrations
ronin os uninstall mac

# Show installation status
ronin os status

# Verify installation is working
ronin os verify

# Enable clipboard watching (explicit opt-in)
ronin os clipboard enable

# Disable clipboard watching
ronin os clipboard disable

# Install with custom settings
ronin os install mac --bridge-port 8080 --folders "~/Desktop,~/Downloads,~/Documents"
```

## Architecture

### Event Flow

```
macOS Quick Action
    ↓
os.file.selected (raw OS event)
    ↓
OSBridgeAgent (normalizes event)
    ↓
file.received (normalized Ronin event)
    ↓
Business Agents (your agents)
```

### Components

1. **OSBridgeAgent** (`agents/os-bridge.ts`)
   - Receives raw OS events
   - Normalizes and enriches with metadata
   - Emits standardized Ronin events
   - Provides HTTP endpoints for external integrations

2. **macOS Installer** (`src/os/installers/mac.ts`)
   - Creates Quick Action workflow
   - Generates LaunchAgent plist
   - Manages install/uninstall

3. **Menubar Module** (`src/os/menubar.ts`)
   - Native macOS menubar indicator
   - Shows Ronin status
   - Provides quick actions menu

## Security & Privacy

### Privacy-First Defaults

- **Opt-in**: Desktop Mode is disabled by default
- **Explicit Clipboard**: Clipboard watching requires explicit user action
- **Local Only**: All OS communications stay on localhost
- **No Data Collection**: Nothing leaves your machine

### Permissions

The installer will request:
- Automation permissions (for Quick Action)
- Accessibility permissions (if using clipboard monitoring)

## Troubleshooting

### Quick Action Not Appearing

```bash
# Rebuild services cache
/System/Library/CoreServices/pbs -flush

# Or reinstall
ronin os install mac
```

### LaunchAgent Not Starting

```bash
# Check LaunchAgent status
launchctl list | grep ronin

# Load manually
launchctl load ~/Library/LaunchAgents/ai.ronin.desktop.plist

# View logs
tail -f ~/.ronin/logs/ronin-desktop.log
tail -f ~/.ronin/logs/ronin-desktop.error.log
```

### Bridge Not Responding

```bash
# Check if bridge is accessible
curl http://localhost:17341/api/os-bridge/status

# Restart Ronin
ronin restart
```

## Agent Integration

Agents can listen for Desktop Mode events:

```typescript
import { BaseAgent } from "@ronin/agent";

export default class MyAgent extends BaseAgent {
  async onMount(): Promise<void> {
    // Listen for received files
    this.api.events.on("file.received", async (file) => {
      if (file.metadata.isCode) {
        await this.analyzeCode(file.path);
      }
    });

    // Listen for captured text
    this.api.events.on("text.captured", async (text) => {
      await this.summarizeText(text.text);
    });
  }

  private async analyzeCode(path: string): Promise<void> {
    // Your code analysis logic
    await this.api.notify({
      title: "Code Analysis",
      message: `Analyzed ${path}`,
    });
  }

  private async summarizeText(text: string): Promise<void> {
    // Your text summarization logic
  }

  async execute(): Promise<void> {
    // Regular scheduled execution
  }
}
```

## API Endpoints

When Desktop Mode is enabled, these endpoints are available:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/os-bridge/events` | POST | Receive OS events from external sources |
| `/api/os-bridge/recent` | GET | Get recent OS interactions |
| `/api/os-bridge/status` | GET | Get Desktop Mode status |

### POST /api/os-bridge/events

```bash
curl -X POST http://localhost:17341/api/os-bridge/events \
  -H "Content-Type: application/json" \
  -d '{
    "event": "os.file.selected",
    "data": {
      "path": "/path/to/file.txt",
      "multi": false
    }
  }'
```

### GET /api/os-bridge/status

```bash
curl http://localhost:17341/api/os-bridge/status
```

Response:
```json
{
  "enabled": true,
  "clipboard": false,
  "recentFiles": 5,
  "recentTexts": 3,
  "platform": "mac"
}
```

## Roadmap

- [x] Menubar with event emission and toggles
- [x] Offline mode toggle
- [x] AI provider switching
- [x] Clipboard monitoring toggle
- [ ] Linux support (GNOME/KDE extensions)
- [ ] Windows support (PowerShell integration)
- [ ] Folder watching with granular rules
- [ ] Drag-and-drop to menubar
- [ ] Custom Quick Actions per file type
- [ ] Keyboard shortcut customization
- [ ] Screen capture integration

## License

MIT © Ronin AI
