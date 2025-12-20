# Ronin - Bun AI Agent Library

A Bun-based AI agent library for scheduling and executing TypeScript/JavaScript agent task files with memory/context management, leveraging Bun's native features (cron, file watching, HTTP) and integrating with Ollama (qwen3) for local AI capabilities.

## Features

- **Simple Agent Classes**: Write agents as TypeScript/JavaScript classes that extend a base `Agent` class
- **Cron Scheduling**: Custom cron scheduler for time-based agent execution
- **File Watching**: Watch files and directories for changes
- **Webhook Support**: HTTP webhooks for triggering agents
- **Memory System**: SQLite-based storage for agent state and conversation history
- **Rich API**: Agents receive an `api` object with AI, files, database, HTTP, and event capabilities
- **Plugin System**: Auto-discoverable plugins with built-in git and shell plugins
- **Function Calling**: AI agents can use plugins as tools via Ollama's function calling API
- **CLI Management**: Simple CLI to start, run, list, and check status of agents

## Quick Start

```bash
# Install dependencies
bun install

# Setup environment variables (optional)
./setup-env.sh  # Interactive setup for API keys and GPU config

# List available agents
bun run ronin list

# List available plugins
bun run ronin plugins list

# Run a specific agent manually
bun run ronin run example-agent

# Create a new plugin
bun run ronin create plugin my-plugin

# Create a new agent with AI assistance (interactive)
bun run ronin create agent "monitor log files and alert on errors"

# Ask questions about Ronin
bun run ronin ask "how do plugins work?"
bun run ronin ask  # Interactive mode

# Start all agents (schedules them and keeps running)
bun run ronin start

# Or use the npm script
bun start
```

**Note:** After installing globally (`bun link` or `npm install -g`), you can use `ronin` directly instead of `bun run ronin`.

## Writing Agents

See [AGENTS.md](./AGENTS.md) for detailed documentation on writing agent files.

## Plugins

Ronin includes a plugin system for extending functionality:

- **Built-in Plugins**: Git and Shell plugins included
- **Auto-discovery**: Plugins automatically loaded from `plugins/` directory
- **Function Calling**: Plugins available as tools for AI function calling
- **CLI Tools**: Create and manage plugins via CLI

See [docs/PLUGINS.md](./docs/PLUGINS.md) for plugin development guide.

## Function Calling

Agents can use AI function calling to interact with plugins:

```typescript
const { toolCalls } = await this.api.ai.callTools(
  "Check git status",
  [] // Plugin tools automatically included
);
```

See [docs/TOOL_CALLING.md](./docs/TOOL_CALLING.md) for detailed guide.

## Configuration

Environment variables:
- `OLLAMA_URL` - Ollama API URL (default: `http://localhost:11434`)
- `OLLAMA_MODEL` - Ollama model name (default: `qwen3`)
- `WEBHOOK_PORT` - Webhook server port (default: `3000`)

CLI options:
- `--agent-dir <dir>` - Agent directory (default: `./agents`)
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path (default: `ronin.db`)

## Project Structure

```
ronin/
├── src/
│   ├── agent/          # Agent base class, loader, and registry
│   ├── memory/          # SQLite-based memory system
│   ├── api/             # API namespace (ai, files, db, http, events)
│   ├── plugins/         # Plugin system (loader, tool generator)
│   ├── cli/             # CLI commands
│   ├── types/           # TypeScript types
│   └── index.ts         # Main library export
├── agents/              # Your agent files (loaded by start command)
├── plugins/             # Plugin files (auto-discovered)
│   ├── git.ts           # Built-in git plugin
│   ├── shell.ts          # Built-in shell plugin
│   └── hyprland.ts      # Example custom plugin
├── docs/                # Documentation
│   ├── ARCHITECTURE.md  # System architecture
│   ├── PLUGINS.md       # Plugin development guide
│   └── TOOL_CALLING.md  # Function calling guide
└── tests/               # Test files
```

**Note:** 
- The `agents/` directory is where you place your actual agent files
- The `plugins/` directory is where you place plugin files
- Both are auto-discovered by the `start` command

## License

Private project
