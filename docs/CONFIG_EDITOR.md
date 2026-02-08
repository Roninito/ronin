# Config Editor

The Config Editor provides a web-based interface and CLI for managing Ronin's configuration file (`~/.ronin/config.json`).

## Quick Start

### Access the Web Interface

```bash
# Start Ronin
bun run ronin start

# Open config editor
open http://localhost:3000/config
# or
ronin config --edit
```

**Default Password:** `roninpass`

## Authentication

Set a custom password via environment variable:

```bash
export CONFIG_EDITOR_PASSWORD="your-secure-password"

# Then start Ronin
bun run ronin start
```

**Security Notes:**
- Default password is `roninpass` (change recommended)
- Password is checked for all modifications
- Read-only access without password
- Session expires after 1 hour
- Failed login attempts are logged

## Features

### Dual Editing Modes

**Form Mode** (Default):
- Structured forms for each config section
- Dropdowns for enums (CLI selection, etc.)
- Path pickers with validation
- Sliders for numeric ranges (timeouts)
- Toggle switches for booleans
- Array editors for key-value pairs

**JSON Mode**:
- Raw JSON editing
- Syntax highlighting
- Format/validate buttons
- Schema validation
- Line numbers

### Strict Validation

Configuration is validated before saving. Invalid configs **cannot** be saved.

**Validation includes:**
- JSON syntax validation
- Required fields (defaultCLI, defaultAppsDirectory)
- Enum values (CLI names)
- Type checking
- Range validation (timeouts: 1000-3600000ms)
- Path validation

**Example Errors:**
```
❌ Cannot save - fix these issues:
1. defaultCLI: "qwenn" is not valid
   Expected: qwen, cursor, opencode, gemini

2. cliOptions.qwen.timeout: -100
   Must be between 1000 and 3600000
```

### Backup System

Automatic backups on every save:
- **Location:** `~/.ronin/config.history/`
- **Retention:** Last 10 versions
- **Format:** `YYYY-MM-DDTHH-mm-ss.json`
- **Manifest:** `manifest.json` with metadata

**Backup CLI:**
```bash
# Create manual backup
ronin config --backup

# List backups
ronin config --list-backups

# Restore from backup
ronin config --restore 2024-02-08T14-22-15
```

### Auto-Create App Directories

When saving config with new app definitions:
```json
{
  "apps": {
    "backend": "~/.ronin/apps/backend",
    "frontend": "~/.ronin/apps/frontend"
  }
}
```

Directories are automatically created if they don't exist.

### Config Versioning

Every config includes a `configVersion` field:
```json
{
  "configVersion": "1.0.0",
  "defaultCLI": "qwen",
  // ...
}
```

This enables:
- Schema migration tracking
- Compatibility checking
- Future auto-upgrades

### Hot-Reload

When config is saved:
1. Validation passes
2. Backup created
3. File saved
4. **Event emitted:** `config_reloaded`
5. Agents auto-reload

Agents listen for reloads:
```typescript
this.api.events.on('config_reloaded', () => {
  console.log('[agent] Config reloaded, refreshing...');
  this.loadConfig();
});
```

## Configuration Schema

### General Settings

**defaultCLI** (string, required)
- Default: `"qwen"`
- Options: `qwen`, `cursor`, `opencode`, `gemini`
- Used when no CLI tag in `#build` plans

**defaultAppsDirectory** (string, required)
- Default: `"~/.ronin/apps"`
- Base directory for `#app-*` workspace tags
- Auto-created if doesn't exist

**apps** (object)
- Key-value pairs: `{ "app-name": "/path/to/app" }`
- Named workspaces for CLI execution
- Directories auto-created

### CLI Options

**cliOptions.qwen**
```json
{
  "model": "qwen3:1.7b",
  "timeout": 300000
}
```

**cliOptions.cursor**
```json
{
  "timeout": 60000
}
```

**cliOptions.opencode**
```json
{
  "timeout": 120000
}
```

**cliOptions.gemini**
```json
{
  "model": "gemini-pro",
  "timeout": 60000
}
```

### Event Monitor Settings

**eventMonitor.enabled** (boolean)
- Default: `true`
- Enable/disable event monitoring

**eventMonitor.retentionHours** (number)
- Default: `24`
- Range: 1-168
- How long to keep events

**eventMonitor.sampling**
```json
{
  "enabled": true,
  "thresholdPerHour": 100,
  "rate": 10
}
```

## CLI Commands

### ronin config

Show help and available commands.

### ronin config --edit

Open config editor in default browser.

### ronin config --set-password

Show instructions for setting custom password.

### ronin config --backup

Create manual backup of current config.

### ronin config --list-backups

List all available backups with timestamps.

### ronin config --restore <id>

Restore config from backup.

```bash
ronin config --restore 2024-02-08T14-22-15
```

### ronin config --export <path>

Export config to file.

```bash
ronin config --export ./my-backup.json
```

### ronin config --import <path>

Import config from file (with validation).

```bash
ronin config --import ./my-config.json
```

### ronin config --validate

Validate current config without changes.

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/config` | None | Login page or Editor UI |
| POST | `/config/login` | None | Authenticate |
| POST | `/config/logout` | None | Clear session |
| GET | `/config/api/current` | None | Get config JSON |
| PUT | `/config/api/update` | Password | Update config (validated) |
| GET | `/config/api/validate` | None | Validate JSON |
| GET | `/config/api/schema` | None | Get field schema |
| GET | `/config/api/backups` | Password | List backups |
| POST | `/config/api/restore` | Password | Restore backup |
| POST | `/config/api/backup` | Password | Manual backup |

## Example Configuration

```json
{
  "configVersion": "1.0.0",
  "defaultCLI": "qwen",
  "defaultAppsDirectory": "~/.ronin/apps",
  "apps": {
    "backend": "~/.ronin/apps/backend",
    "frontend": "~/.ronin/apps/frontend",
    "docs": "~/projects/documentation"
  },
  "cliOptions": {
    "qwen": {
      "model": "qwen3:1.7b",
      "timeout": 300000
    },
    "cursor": {
      "timeout": 60000
    },
    "opencode": {
      "timeout": 120000
    },
    "gemini": {
      "model": "gemini-pro",
      "timeout": 60000
    }
  },
  "eventMonitor": {
    "enabled": true,
    "retentionHours": 24,
    "maxPayloadSize": 500,
    "autoRefreshSeconds": 30,
    "pageSize": 50,
    "sampling": {
      "enabled": true,
      "thresholdPerHour": 100,
      "rate": 10
    }
  }
}
```

## Troubleshooting

### Cannot access config editor

1. Ensure Ronin is running: `bun run ronin start`
2. Check port 3000 is available
3. Verify URL: `http://localhost:3000/config`

### Forgot password

Set new password via environment variable:
```bash
export CONFIG_EDITOR_PASSWORD="new-password"
bun run ronin start
```

### Validation errors

Check error messages carefully:
- Required fields must be present
- Enums must match allowed values
- Numbers must be in valid ranges
- Paths should be valid (but don't need to exist)

### Config not reloading

Some agents may need restart. Check agent logs for reload events.

### Backup failures

Ensure `~/.ronin/config.history/` is writable:
```bash
mkdir -p ~/.ronin/config.history
chmod 755 ~/.ronin/config.history
```

## Security Best Practices

1. **Change default password** in production
2. **Use HTTPS** if exposing externally
3. **Restrict file permissions** on config files
4. **Backup regularly** using `--backup`
5. **Validate imports** before applying
6. **Don't commit passwords** to version control

## Migration Guide

### From manual config editing

1. Backup current config: `cp ~/.ronin/config.json ~/.ronin/config.json.backup`
2. Open config editor: `ronin config --edit`
3. Review settings in Form Mode
4. Save (automatically validates and backs up)
5. Verify agents reload successfully

### To new installation

1. Export config: `ronin config --export ./config.json`
2. On new machine: `ronin config --import ./config.json`
3. Update paths if needed (different home directory)
4. Verify: `ronin config --validate`

## See Also

- [CLI Integration](CLI_INTEGRATION.md) - CLI tool configuration
- [Event Monitor](EVENT_MONITOR.md) - Event monitoring settings
- [Plan Workflow](PLAN_WORKFLOW.md) - Workflow configuration
