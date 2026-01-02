# Quick Start Guide

## Important: Run commands from the ronin directory!

```bash
# Navigate to the ronin directory first
cd ronin

# Then run commands
bun run ronin list
bun run ronin run test-agent
bun run ronin start
```

## Common Commands

```bash
# Make sure you're in the ronin directory
cd ronin

# List all agents
bun run ronin list

# Run an agent
bun run ronin run test-agent

# Start the system (schedules all agents)
bun run ronin start

# List plugins
bun run ronin plugins list

# Create a new plugin
bun run ronin create plugin my-plugin
```

## Troubleshooting

**No output when running commands?**
- Make sure you're in the `ronin/` directory (not the parent `Appz/` directory)
- Check: `pwd` should show `/path/to/ronin` not `/path/to/Appz`

**Command not found?**
- Make sure you're in the ronin directory
- Try: `cd ronin && bun run ronin list`

**Module not found errors?**
- Make sure you're in the ronin directory
- Run `bun install` to ensure dependencies are installed

