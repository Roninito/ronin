# Ronin CLI Documentation

Complete reference guide for the Ronin command-line interface.

## Table of Contents

- [Overview](#overview)
- [Commands](#commands)
- [Configuration](#configuration)
- [Examples](#examples)

## Overview

Ronin provides a comprehensive CLI for managing AI agents, plugins, and system configuration. All commands are accessed via `bun run ronin <command>` or `ronin <command>` if installed globally.

## Commands

### `start`

Start and schedule all agents. This command discovers agents from the local and external agent directories, registers them with the scheduler, and keeps the process running.

**Usage:**
```bash
ronin start [options]
```

**Options:**
- `--agent-dir <dir>` - Agent directory (default: `~/.ronin/agents`)
- `--plugin-dir <dir>` - Plugin directory (default: `./plugins`)
- `--ollama-url <url>` - Ollama API URL (default: `http://localhost:11434`)
- `--ollama-model <name>` - Ollama model name (default: `qwen3:4b`)
- `--db-path <path>` - Database file path (default: `ronin.db`)

**Examples:**
```bash
# Start with default settings
ronin start

# Start with custom agent directory
ronin start --agent-dir ./my-agents

# Start with custom Ollama model
ronin start --ollama-model llama2
```

**What it does:**
- Discovers agents from local and external directories
- Registers scheduled agents with cron scheduler
- Sets up file watchers for agents with `watch` property
- Registers webhook endpoints for agents with `webhook` property
- Starts webhook server (default port: 3000)
- Keeps process alive to run scheduled tasks

### `run`

Run a specific agent manually, bypassing the scheduler.

**Usage:**
```bash
ronin run <agent-name> [options]
```

**Options:**
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path

**Examples:**
```bash
# Run an agent
ronin run example-agent

# Run with custom settings
ronin run my-agent --ollama-model llama2
```

### `list`

List all available agents and their schedules.

**Usage:**
```bash
ronin list [options]
```

**Options:**
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path

**Output:**
Shows agent names, schedules, file watchers, and webhook paths.

### `status`

Show runtime status and active schedules.

**Usage:**
```bash
ronin status [options]
```

**Options:**
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path

**Output:**
Shows active agents, next scheduled runs, file watchers, and webhooks.

### `create agent`

AI-powered interactive agent creation. Uses AI to generate agent code based on your description.

**Usage:**
```bash
ronin create agent [description] [options]
```

**Options:**
- `--local` - Create agent in local directory (`~/.ronin/agents`) instead of project directory
- `--agent-dir <dir>` - Custom agent directory (overrides `--local`)
- `--no-preview` - Skip preview before saving
- `--edit` - Open in editor after creation
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path
- `--plugin-dir <dir>` - Plugin directory

**Examples:**
```bash
# Interactive creation
ronin create agent

# Create with description
ronin create agent "monitor log files and alert on errors"

# Create in local directory
ronin create agent "backup database daily" --local

# Create with custom directory
ronin create agent "process images" --agent-dir ./custom-agents
```

**Process:**
1. Prompts for agent description (if not provided)
2. Uses AI to generate agent code
3. Shows preview (unless `--no-preview`)
4. Saves to agent directory
5. Optionally opens in editor

### `create plugin`

Create a new plugin template.

**Usage:**
```bash
ronin create plugin <name> [options]
```

**Options:**
- `--plugin-dir <dir>` - Plugin directory (default: `./plugins`)

**Examples:**
```bash
ronin create plugin my-plugin
```

### `plugins list`

List all loaded plugins.

**Usage:**
```bash
ronin plugins list [options]
```

**Options:**
- `--plugin-dir <dir>` - Plugin directory

**Output:**
Shows plugin names and descriptions.

### `plugins info`

Show detailed information about a plugin.

**Usage:**
```bash
ronin plugins info <plugin-name> [options]
```

**Options:**
- `--plugin-dir <dir>` - Plugin directory

**Examples:**
```bash
ronin plugins info git
ronin plugins info grok
```

### `ask`

Ask questions about Ronin or get help. Supports multiple AI providers.

**Usage:**
```bash
ronin ask [model] [question] [options]
```

**Models:**
- `local` (default) - Uses Ollama with local models
- `grok` - Uses Grok AI (requires `GROK_API_KEY`)
- `gemini` - Uses Google Gemini (requires `GEMINI_API_KEY`)

**Options:**
- `--model <name>` - Specify model explicitly
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path
- `--sources` - Show sources for answers

**Examples:**
```bash
# Single question with default (local) model
ronin ask "how do plugins work?"

# Use Grok
ronin ask grok "explain agent scheduling"

# Use Gemini
ronin ask gemini "how to create a new agent?"

# Interactive mode
ronin ask

# Interactive mode with specific model
ronin ask grok
```

**Features:**
- Context-aware: Gathers information from agents, plugins, and documentation
- Tool calling: Can execute tools to gather information
- Streaming responses: Real-time output
- Pattern matching: Automatically detects common queries

### `config`

Manage Ronin configuration. Settings are stored in `~/.ronin/config.json`.

**Usage:**
```bash
ronin config [options]
```

**Options:**
- `--show` - Show current configuration
- `--agent-dir <path>` - Set local agent directory
- `--external-agent-dir <path>` - Set external agent directory
- `--external-agent-dir ""` - Remove external agent directory
- `--grok-api-key <key>` - Set Grok API key
- `--grok-api-key ""` - Remove Grok API key
- `--gemini-api-key <key>` - Set Gemini API key
- `--gemini-api-key ""` - Remove Gemini API key

**Examples:**
```bash
# Show current configuration
ronin config --show

# Set external agent directory
ronin config --external-agent-dir ~/my-agents

# Set API keys
ronin config --grok-api-key sk-xxxxx
ronin config --gemini-api-key AIxxxxx

# Remove API keys
ronin config --grok-api-key ""
ronin config --gemini-api-key ""
```

**Note:** Environment variables take precedence over config file settings.

### `fishy`

Start the Fishy web server to browse the fishing database.

**Usage:**
```bash
ronin fishy
```

**Environment Variables:**
- `WEBHOOK_PORT` - Server port (default: `3000`, same as main webhook server)
- `FISHY_PORT` - Server port (fallback, default: `3000`)
- `FISHY_DB_PATH` - Database path (default: `fishing.db`)

**Access:**
- Web interface: `http://localhost:3000/fishy`
- API: `http://localhost:3000/fishy/api/fish`

### `docs`

View documentation in browser or terminal.

**Usage:**
```bash
ronin docs [document] [options]
```

**Options:**
- `--browser` - Open in browser (default)
- `--terminal` - Show in terminal
- `--port <port>` - Documentation server port (default: `3002`)

**Examples:**
```bash
# Open main documentation in browser
ronin docs

# Open specific document
ronin docs CLI
ronin docs ARCHITECTURE
ronin docs PLUGINS

# View in terminal
ronin docs --terminal

# List available documents
ronin docs --list
```

**Available Documents:**
- `CLI` - This CLI documentation
- `ARCHITECTURE` - System architecture
- `PLUGINS` - Plugin development guide
- `TOOL_CALLING` - Function calling guide
- `REMOTE_AI` - Remote AI setup guide
- `OLLAMA_GPU` - Ollama GPU configuration

### `help`

Show help message.

**Usage:**
```bash
ronin help
ronin --help
ronin -h
```

## Configuration

### Default Agent Directory

By default, agents are stored in `~/.ronin/agents`. This provides:
- Centralized agent storage
- Easy sharing across projects
- Separation from project code

**Override:**
- Use `--agent-dir` flag in commands
- Set via `ronin config --agent-dir <path>`
- Use `--local` flag when creating agents (uses default directory)

### External Agent Directory

Load agents from an external directory in addition to the local directory.

**Set:**
```bash
ronin config --external-agent-dir ~/my-agents
# or
export RONIN_EXTERNAL_AGENT_DIR=~/my-agents
```

**Use:**
When running `ronin start`, agents from both directories are loaded.

### API Keys

**Set via config command:**
```bash
ronin config --grok-api-key sk-xxxxx
ronin config --gemini-api-key AIxxxxx
```

**Set via environment variables:**
```bash
export GROK_API_KEY=sk-xxxxx
export GEMINI_API_KEY=AIxxxxx
```

**Priority:** Environment variables take precedence over config file.

## Examples

### Basic Workflow

```bash
# 1. Create an agent
ronin create agent "monitor system logs" --local

# 2. List agents
ronin list

# 3. Test run agent
ronin run monitor-system-logs

# 4. Start all agents
ronin start
```

### Advanced Workflow

```bash
# 1. Configure system
ronin config --grok-api-key sk-xxxxx
ronin config --external-agent-dir ~/shared-agents

# 2. Create agent in local directory
ronin create agent "backup database" --local

# 3. View configuration
ronin config --show

# 4. Start with custom settings
ronin start --ollama-model llama2

# 5. Check status
ronin status
```

### Using Remote AI

```bash
# Set API keys
ronin config --grok-api-key sk-xxxxx

# Ask questions with Grok
ronin ask grok "how do I create a scheduled agent?"

# Create agent with AI assistance
ronin create agent "process images every hour"
```

### Documentation

```bash
# View CLI docs in browser
ronin docs CLI

# View architecture docs
ronin docs ARCHITECTURE

# View in terminal
ronin docs PLUGINS --terminal
```

## Environment Variables

### AI Configuration
- `GROK_API_KEY` - Grok API key
- `GEMINI_API_KEY` - Gemini API key
- `OLLAMA_URL` - Ollama API URL (default: `http://localhost:11434`)
- `OLLAMA_MODEL` - Ollama model name (default: `qwen3:4b`)

### Server Ports
- `WEBHOOK_PORT` - Webhook server port (default: `3000`)
  - Used for webhook server, status endpoint, and Fishy server
- `FISHY_PORT` - Fishy server port (fallback, default: `3000`)
- `PORT` - General server port

### Directories
- `RONIN_EXTERNAL_AGENT_DIR` - External agent directory

### Database
- `FISHY_DB_PATH` - Fishing database path (default: `fishing.db`)

## Troubleshooting

### Agents Not Found

```bash
# Check agent directory
ronin config --show

# List agents
ronin list --agent-dir ~/.ronin/agents
```

### API Key Issues

```bash
# Check configuration
ronin config --show

# Verify environment variables
echo $GROK_API_KEY
echo $GEMINI_API_KEY
```

### Ollama Not Available

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Check model exists
ollama list
```

## See Also

- [README.md](../README.md) - Main documentation
- [AGENTS.md](../AGENTS.md) - Writing agents guide
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [docs/PLUGINS.md](./PLUGINS.md) - Plugin development
- [docs/TOOL_CALLING.md](./TOOL_CALLING.md) - Function calling guide

