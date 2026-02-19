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
- `--ollama-model <name>` - Ollama model name (default: `qwen3:1.7b`)
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
- Automatically connects to Realm discovery server if configured (see Configuration section)
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

### `ai`

Manage local AI model definitions (CLI-only registry).

**Usage:**
```bash
ronin ai <command> [options]
```

**Commands:**
- `list` - List saved definitions
- `add <name>` - Add or update a definition
- `remove <name>` - Remove a definition
- `show <name>` - Show a definition as JSON
- `run <name>` - Run a definition via `ollama run`

**Options:**
- `--file <path>` - Registry file (default: `~/.ronin/ai-models.json`)
- `--provider <name>` - Provider (default: `ollama`)
- `--model <name>` - Model name (required for add)
- `--args "<args>"` - Args for provider command (space or comma separated)
- `--tags "a,b"` - Comma-separated tags
- `--description "..."` - Description for the definition
- `--force` - Overwrite existing definition

**Examples:**
```bash
ronin ai list
ronin ai add qwen3 --model qwen3:1.7b --description "Fast local model"
ronin ai run qwen3
```

### `listRoutes`

List all registered server routes from a running Ronin instance.

**Usage:**
```bash
ronin listRoutes [options]
```

**Options:**
- `--port <number>` - Webhook server port (default: `3000`)

**Output:**
Shows system routes, agent-registered HTTP routes, and webhook endpoints with full URLs.

## Local Agents (Installed in `~/.ronin/agents`)

Some agents are intentionally kept out of the repo and live in `~/.ronin/agents` (loaded by default). If you’ve installed them, start Ronin and use `ronin listRoutes` to find their routes.

### RSS Feed Agent

- **Purpose**: Manage RSS feeds, ingest items on a schedule, and serve news items over HTTP.\n+- **Data**:\n+  - Feeds list: `~/.ronin/data/rss.feeds.json`\n+  - DB: `~/.ronin/data/rss.feed.db`\n+- **Routes**:\n+  - `GET/POST/DELETE /rss/feeds`\n+  - `GET /rss/news?limit=20`\n+  - `GET /rss/news/:id`\n+- **Events**:\n+  - listens: `news.feeds.list.request` → emits: `news.feeds.list`\n+  - listens: `news.item.request` → emits: `news.item`\n+
### GVEC Agent

- **Purpose**: Turn RSS items into geolocated vectors and render them on a globe.\n+- **Data**: `~/.ronin/data/gvec.db`\n+- **Routes**:\n+  - `GET /gvec/data`\n+  - `GET /gvec/globe`\n+
### NOAA News Agent

- **Purpose**: Scrape NOAA news page, generate short articles, store results.\n+- **Data**: `~/.ronin/data/noaa.news.db`\n+
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

### `cancel agent-creation`

Cancel active agent creation tasks. Useful if an agent creation is taking too long or you want to stop it.

**Usage:**
```bash
ronin cancel agent-creation [taskId] [options]
```

**Options:**
- `--port <number>` - Webhook server port (default: `3000`)

**Examples:**
```bash
# Cancel all active agent creations
ronin cancel agent-creation

# Cancel a specific task
ronin cancel agent-creation abc123
```

**Note:** If `taskId` is omitted, all active agent creation tasks will be cancelled.

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

### `create skill`

Create a new skill using AI assistance. Uses the SkillMaker agent to generate skill.md and scripts from a description.

**Usage:**
```bash
ronin create skill "<description>" [options]
```

**Options:**
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path

**Examples:**
```bash
ronin create skill "monitor log files and alert on error spikes"
ronin create skill "fetch weather data and format as JSON"
```

**Process:**
1. Uses AI to generate skill.md with frontmatter, instructions, and abilities
2. Generates script files for each ability
3. Saves to `~/.ronin/skills/<skill-name>/`
4. Emits `new-skill` event when complete

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

### `skills`

Manage AgentSkills - modular, reusable AI workflows. Skills are task-focused bundles (skill.md + scripts) that the AI can discover, explore, and run.

**Usage:**
```bash
ronin skills <subcommand> [options]
```

**Subcommands:**

#### `skills list`

List all available skills from user and project directories.

**Examples:**
```bash
ronin skills list
```

#### `skills discover <query>`

Discover skills matching a query (searches name and description).

**Examples:**
```bash
ronin skills discover "log monitor"
ronin skills discover "weather"
```

**Output:** JSON array of matching skills with `name` and `description`.

#### `skills explore <name> [--scripts]`

Show detailed information about a skill, including frontmatter, instructions, abilities, and optionally script contents.

**Options:**
- `--scripts` - Include script file contents in output

**Examples:**
```bash
ronin skills explore log-monitor
ronin skills explore weather --scripts
```

**Output:** JSON with skill details including abilities, instructions, and optional script contents.

#### `skills use <name> [options]`

Execute a skill with specified ability or pipeline.

**Options:**
- `--ability <name>` - Run a specific ability
- `--pipeline <a,b,c>` - Run abilities in sequence (comma-separated)
- `--params '<json>'` - JSON parameters for the skill

**Examples:**
```bash
# Run a specific ability
ronin skills use log-monitor --ability=countErrors --params='{"logPath":"/var/log/app.log"}'

# Run a pipeline
ronin skills use data-processor --pipeline=extract,transform,load --params='{"source":"data.csv"}'
```

#### `skills install <git-repo> [--name <skill-name>]`

Install a skill from a git repository.

**Options:**
- `--name <name>` - Custom skill name (defaults to repository name)

**Examples:**
```bash
ronin skills install https://github.com/user/skill-repo.git
ronin skills install https://github.com/user/skill-repo.git --name my-skill
```

**Note:** Requires git plugin to be loaded.

#### `skills update <name>`

Update an installed skill by pulling latest changes from git.

**Examples:**
```bash
ronin skills update log-monitor
```

**Note:** Skill must be a git repository. Requires git plugin to be loaded.

#### `skills init`

Initialize git repository in the skills directory for version control.

**Examples:**
```bash
ronin skills init
```

**See Also:**
- [docs/SKILLS.md](./SKILLS.md) - Complete skills documentation

### `mcp`

Manage Model Context Protocol (MCP) server connections. MCP servers extend Ronin with external tools like filesystem access, web search, GitHub integration, and database queries.

**Usage:**
```bash
ronin mcp <subcommand> [options]
```

**Subcommands:**

#### `mcp list`

List all configured MCP servers with their status and commands.

**Examples:**
```bash
ronin mcp list
```

**Output:**
Shows server name, enabled/disabled status, and command with arguments for each configured MCP server.

#### `mcp discover`

Show all known MCP servers available for installation.

**Examples:**
```bash
ronin mcp discover
```

**Output:**
Displays a table of known servers with their package names, descriptions, and required arguments.

#### `mcp add <name> [options]`

Add an MCP server from the known list or a custom server.

**Options for Known Servers:**
- `--path <path>` - Path for filesystem or sqlite servers (required for these server types)

**Options for Custom Servers:**
- `--command <cmd>` - Command to run (required for custom servers)
- `--args '<json>'` - JSON array of arguments (required for custom servers)

**Examples:**
```bash
# Add known servers
ronin mcp add filesystem --path ~/Documents
ronin mcp add github
ronin mcp add brave-search
ronin mcp add sqlite --path ./myapp.db

# Add custom server
ronin mcp add my-server --command npx --args '["-y","@org/my-mcp-server"]'
```

**Note:** For brave-search, you must first set your API key:
```bash
ronin config --brave-api-key YOUR_KEY
ronin mcp add brave-search
```

#### `mcp enable <name>`

Enable a previously disabled MCP server.

**Examples:**
```bash
ronin mcp enable filesystem
```

#### `mcp disable <name>`

Temporarily disable an MCP server without removing it from configuration.

**Examples:**
```bash
ronin mcp disable brave-search
```

#### `mcp remove <name>`

Remove an MCP server from configuration entirely.

**Examples:**
```bash
ronin mcp remove filesystem
```

#### `mcp status`

Show summary of configured and enabled MCP servers.

**Examples:**
```bash
ronin mcp status
```

**Output:**
Shows count of configured and enabled servers, plus a list of all configured server names.

**Available MCP Servers:**
- **filesystem** - Read and write files in a directory (requires `--path`)
- **github** - GitHub issues, PRs, repository operations (optional `GITHUB_TOKEN` env)
- **brave-search** - Web search via Brave Search API (requires API key)
- **sqlite** - Query SQLite databases (requires `--path` to database)

**See Also:**
- [docs/MCP.md](./MCP.md) - Complete MCP guide
- [docs/HYBRID_INTELLIGENCE.md](./HYBRID_INTELLIGENCE.md) - Tool orchestration system

### `ask`

Ask questions about Ronin or get help. **Requires Ronin to be running** (`ronin start`). Connects to the running instance via HTTP for a unified chat experience with conversation history.

**Usage:**
```bash
ronin ask [model] [question] [options]
```

**Important:** Start Ronin first:
```bash
ronin start  # In one terminal
ronin ask "how do plugins work?"  # In another terminal
```

**Model Tiers:**
- `local` (default) - Uses default local Ollama model
- `smart` - Uses configured smart tier model (cloud or local)
- `cloud` - Uses cloud tier model (remote AI)

**Options:**
- `--model <name>` - Specify model tier (`smart`, `cloud`) or specific model name
- `--ask-model <name>` - Specify specific Ollama model (e.g., `ministral-3:3b`)
- `--sources` - Show sources for answers (if supported)

**Examples:**
```bash
# Single question with default model
ronin ask "how do plugins work?"

# Use smart tier (configured in Ronin instance)
ronin ask smart "explain agent scheduling"

# Use cloud tier
ronin ask cloud "how to create a new agent?"

# Use specific Ollama model
ronin ask "explain scheduling" --ask-model ministral-3:3b

# Interactive mode
ronin ask

# Interactive mode with smart tier
ronin ask smart
```

**Features:**
- **Unified chat experience**: Conversation history and context preserved
- **Context-aware**: Gathers information from agents, plugins, and documentation
- **Tool calling**: Can execute tools to gather information
- **Streaming responses**: Real-time output
- **Pattern matching**: Automatically detects common queries
- **Webhook-based**: Connects to running Ronin instance for full feature access

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
- `--gemini-model <model>` - Set Gemini model name (e.g., `gemini-1.5-pro`)
- `--brave-api-key <key>` - Set Brave Search API key for MCP web search
- `--brave-api-key ""` - Remove Brave Search API key
- `--realm-url <url>` - Set Realm discovery server URL (e.g., `wss://realm.afiwi.net`)
- `--realm-url ""` - Remove Realm URL
- `--realm-callsign <callsign>` - Set Realm call sign for this instance
- `--realm-callsign ""` - Remove Realm call sign
- `--realm-token <token>` - Set Realm authentication token (optional)
- `--realm-token ""` - Remove Realm token
- `--realm-local-port <port>` - Set local WebSocket port (default: 4000)
- `--realm-local-port ""` - Remove Realm local port (use default: 4000)

**Examples:**
```bash
# Show current configuration
ronin config --show

# Set external agent directory
ronin config --external-agent-dir ~/my-agents

# Set API keys
ronin config --grok-api-key sk-xxxxx
ronin config --gemini-api-key AIxxxxx
ronin config --brave-api-key BSA-xxxxx

# Set Gemini model
ronin config --gemini-model gemini-1.5-pro

# Configure Realm for auto-connect on startup
ronin config --realm-url wss://realm.afiwi.net
ronin config --realm-callsign Roninito
ronin config --realm-token abc123  # optional
ronin config --realm-local-port 4001  # optional, if 4000 is in use

# Remove API keys
ronin config --grok-api-key ""
ronin config --gemini-api-key ""
```

**Note:** 
- Environment variables take precedence over config file settings.
- Once Realm URL and call sign are configured, `ronin start` will automatically connect to Realm on startup.
- If the configured local port is in use, Realm will automatically try the next available port (4001, 4002, etc.).

### `os`

Manage Ronin Desktop Mode for macOS integration. Desktop Mode allows seamless OS integration with Quick Actions, native notifications, and file watching.

**Usage:**
```bash
ronin os <subcommand> [options]
```

**Subcommands:**

#### `os install mac`

Install macOS Desktop Mode integrations including Quick Actions and LaunchAgent.

**Options:**
- `--bridge-port <port>` - Set bridge port (default: `17341`)
- `--folders <paths>` - Comma-separated list of folders to watch

**Examples:**
```bash
# Install Desktop Mode
ronin os install mac

# Install with custom port
ronin os install mac --bridge-port 8080

# Install with custom folders
ronin os install mac --folders "~/Desktop,~/Downloads,~/Documents"
```

**What it installs:**
- Quick Action in Finder → Services → Send to Ronin
- LaunchAgent for auto-starting with macOS
- Bridge HTTP endpoint for OS communications

#### `os uninstall mac`

Remove all macOS Desktop Mode integrations.

**Examples:**
```bash
ronin os uninstall mac
```

#### `os status`

Show current Desktop Mode installation status.

**Examples:**
```bash
ronin os status
```

**Output:**
- Quick Action installation status
- LaunchAgent installation status
- Bridge port configuration
- Desktop Mode enabled/disabled

#### `os verify`

Verify that Desktop Mode installation is working correctly.

**Examples:**
```bash
ronin os verify
```

**Checks:**
- Quick Action exists
- LaunchAgent is installed and loaded
- Ronin CLI is in PATH

#### `os clipboard enable|disable`

Enable or disable clipboard watching. **Important:** Clipboard watching is disabled by default and requires explicit user consent.

**Examples:**
```bash
# Enable clipboard watching
ronin os clipboard enable

# Disable clipboard watching
ronin os clipboard disable
```

### Fishy Agent

Fishy is a local agent that serves a fishing database UI and API. It is loaded from the external agents directory (default: `~/.ronin/agents`). Start Ronin and visit the routes below.

**Environment Variables:**
- `WEBHOOK_PORT` - Server port (default: `3000`)
- `FISHY_DATA_DIR` - Data directory (default: `~/.ronin/data`)
- `FISHY_DB_PATH` - Database path (default: `~/.ronin/data/fishing.db`)

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
- `MEMORY_DB` - Ronin memory database (`ronin.db`)

### `realm connect`

Connect to a Realm discovery server for peer-to-peer communication.

**Usage:**
```bash
ronin realm connect --url <url> --callsign <callsign> [options]
```

**Required Options:**
- `--url <url>` - WebSocket URL of the Realm Discovery Server
- `--callsign <callsign>` - Your unique call sign identifier

**Options:**
- `--token <token>` - Authentication token (if required)
- `--local-port <port>` - Local WebSocket port (default: auto)
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path

**Examples:**
```bash
# Connect to production Realm server
ronin realm connect --url wss://realm.afiwi.net --callsign Leerie

# Connect to local Realm server
ronin realm connect --url ws://localhost:3033 --callsign Leerie

# Connect with authentication token
ronin realm connect --url wss://realm.afiwi.net --callsign Leerie --token abc123
```

### `realm status`

Show Realm connection status and active peers.

**Usage:**
```bash
ronin realm status [options]
```

**Options:**
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path

**Output:**
Shows connection status, your call sign, and list of connected peers.

### `realm discover`

Discover a peer by call sign and check if they're online.

**Usage:**
```bash
ronin realm discover <callsign> [options]
```

**Options:**
- `--agent-dir <dir>` - Agent directory
- `--plugin-dir <dir>` - Plugin directory
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path

**Examples:**
```bash
# Discover a peer
ronin realm discover Tyro
```

**Output:**
Shows peer status (online/offline) and WebSocket address if online.

**Note:** You must be connected to Realm (`ronin realm connect`) before discovering peers.

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

By default, agents are loaded from both:
- Local directory: `./agents`
- External directory: `~/.ronin/agents`

**Override:**
- Use `--agent-dir` flag to change the local directory
- Set external directory via `ronin config --external-agent-dir <path>` or `RONIN_EXTERNAL_AGENT_DIR`
- Use `--local` when creating agents to place them in the external directory

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
- `BRAVE_API_KEY` - Brave Search API key (for MCP web search)
- `OLLAMA_URL` - Ollama API URL (default: `http://localhost:11434`)
- `OLLAMA_MODEL` - Ollama model name (default: `qwen3:1.7b`)

### Server Ports
- `WEBHOOK_PORT` - Webhook server port (default: `3000`)
  - Used for webhook server, status endpoint, and Fishy server
- `PORT` - General server port

### Directories
- `RONIN_EXTERNAL_AGENT_DIR` - External agent directory (default: `~/.ronin/agents`)

### Database
- `FISHY_DATA_DIR` - Fishy data directory (default: `~/.ronin/data`)
- `FISHY_DB_PATH` - Fishing database path (default: `~/.ronin/data/fishing.db`)

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
- [docs/DESKTOP_MODE.md](./DESKTOP_MODE.md) - Desktop Mode guide

