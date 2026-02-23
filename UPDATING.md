# Updating Ronin

## Quick Start

```bash
# Check your current version
bun run ronin version

# Update to latest version
bun run ronin update

# Restart Ronin
bun run ronin start
```

## Version Command

Show your current version and check if updates are available:

```bash
$ bun run ronin version
🥷 Ronin v1.1.1

📥 Update available: v1.1.1 → v1.2.0
💡 Run: bun run ronin update
```

## Update Command

Update Ronin to the latest version from GitHub:

```bash
$ bun run ronin update
ℹ️  Current version: v1.1.1
ℹ️  Latest version: v1.2.0
📥 Updates available!
  • New: Agent dependency graph
  • Fixed: Dashboard port detection
↓ Backing up current version...
↓ Pulling latest code...
↓ Installing dependencies...
↓ Updating RoninTray...
✅ Update complete! Restart Ronin to use new version.
```

### What Update Does

1. **Version Check**: Fetches latest version from GitHub
2. **Backup**: Creates snapshot at `.ronin/backups/pre-update-{timestamp}/`
3. **Pull**: Gets latest code with `git pull origin main`
4. **Dependencies**: Reinstalls with `bun install` if needed
5. **Cache Clear**: Removes old cached files
6. **RoninTray**: Updates system tray app if installed
7. **Cleanup**: Removes old backups (keeps last 5)

### Update Options

```bash
# Check if update is available without updating
bun run ronin update --check

# Rollback to previous version if something breaks
bun run ronin update --rollback

# Run silently without output
bun run ronin update --quiet
```

## Backup & Rollback

### Automatic Backups

Before each update, Ronin creates a backup:

```
~/.ronin/backups/
├── pre-update-2026-02-23T114700/
├── pre-update-2026-02-20T090000/
└── pre-update-2026-02-15T180000/
```

The 5 most recent backups are kept automatically.

### Rollback Process

If an update breaks something, you can rollback:

**Option 1: Automatic Rollback**
```bash
bun run ronin update --rollback
```

**Option 2: Manual Rollback**
```bash
# List available backups
ls ~/.ronin/backups/

# Restore a specific backup
cp -r ~/.ronin/backups/pre-update-2026-02-23T114700/* .

# Reinstall dependencies
bun install
```

## Update Flow

```
┌─────────────────────────┐
│ Check for Updates       │
│ (GitHub API)            │
└───────────┬─────────────┘
            │
    ┌───────▼────────┐
    │ Update Found?  │
    └───┬─────────┬──┘
        │ No      │ Yes
        │         │
    ┌───▼─┐   ┌──▼──────────────────┐
    │Exit │   │ Create Backup       │
    └─────┘   │ (.ronin/backups/)   │
              └──┬──────────────────┘
                 │
              ┌──▼──────────────┐
              │ Git Pull Main   │
              └──┬──────────────┘
                 │
              ┌──▼──────────────┐
              │ Bun Install     │
              └──┬──────────────┘
                 │
              ┌──▼──────────────┐
              │ Update RoninTray│
              └──┬──────────────┘
                 │
              ┌──▼──────────────┐
              │ Clear Caches    │
              └──┬──────────────┘
                 │
              ┌──▼──────────────┐
              │ ✅ Complete     │
              │ Restart Ronin   │
              └─────────────────┘
```

## Installation Methods

### From GitHub (Recommended)

**First-time install:**
```bash
git clone https://github.com/roninito/ronin.git
cd ronin
bun install
bun run ronin start
```

**Update existing installation:**
```bash
bun run ronin update
```

### Standalone Binary (Future)

Once Ronin releases binary distributions, you'll be able to:
```bash
ronin update  # Without 'bun run'
```

## Troubleshooting

### Update Fails at Git Pull

If you have local changes that conflict:

```bash
# Stash your changes
git stash

# Try update again
bun run ronin update

# Restore your changes
git stash pop
```

### Network Error During Update

If GitHub API is unreachable:

```bash
# The update will fail gracefully
# Try again when network is available
bun run ronin update
```

### RoninTray Doesn't Update

The RoninTray update is optional. If it fails:

```bash
# Manually update RoninTray
bun run ronin os install mac
```

### Stuck in Bad State

If something goes wrong:

```bash
# Rollback to previous version
bun run ronin update --rollback

# Or restore manually
cp -r ~/.ronin/backups/pre-update-{your-timestamp}/* .
bun install

# Then try updating again
bun run ronin update
```

## Manual Update (Advanced)

If you prefer to update manually without the update command:

```bash
# Check for changes
git fetch origin

# Pull latest code
git pull origin main

# Reinstall dependencies
bun install

# Clear caches
rm -rf ~/.ronin/cache/*

# Restart Ronin
bun run ronin start
```

## Version History

Check what changed:

```bash
# See recent commits
git log --oneline -10

# See changes for a specific version
git show v1.2.0

# Compare versions
git diff v1.1.1 v1.2.0
```

## Update Notifications

Ronin checks for updates when you run:
- `bun run ronin version`
- `bun run ronin start`

If an update is available, you'll see:
```
📥 Update available: v1.1.1 → v1.2.0
💡 Run: bun run ronin update
```

## Staying Updated

For the best experience:

1. **Check regularly**: Run `bun run ronin version` weekly
2. **Update promptly**: Apply updates when available
3. **Keep backups**: Updates create automatic backups
4. **Report issues**: If updates cause problems, report them

## Getting Help

- **Issues**: https://github.com/roninito/ronin/issues
- **Discussions**: https://github.com/roninito/ronin/discussions
- **Documentation**: https://github.com/roninito/ronin/blob/main/README.md
