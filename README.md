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
bun run ronin create agent "backup database" --local  # Create in local directory

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

### Environment Variables

#### AI API Keys

Ronin supports multiple AI providers. Set these environment variables to use remote AI services:

**Grok (xAI)**
```bash
export GROK_API_KEY="your-grok-api-key-here"
```

**Gemini (Google)**
```bash
export GEMINI_API_KEY="your-gemini-api-key-here"
```

**Quick Setup**

**Option 1: Using config command (recommended)**
```bash
# Set API keys via config command (stored in ~/.ronin/config.json)
bun run ronin config --grok-api-key "your-grok-key"
bun run ronin config --gemini-api-key "your-gemini-key"

# View configuration
bun run ronin config --show
```

**Option 2: Using environment variables**
```bash
# Use the interactive setup script
./setup-env.sh

# Or manually add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
echo 'export GROK_API_KEY="your-key"' >> ~/.bashrc
echo 'export GEMINI_API_KEY="your-key"' >> ~/.bashrc
source ~/.bashrc
```

**Note:** Environment variables take precedence over config file settings. This allows you to override config file values when needed.

**Get API Keys:**
- **Grok**: Sign up at https://x.ai and get your API key from the developer dashboard
- **Gemini**: Go to https://aistudio.google.com/app/apikey and create a new API key

#### Ollama Configuration

```bash
export OLLAMA_URL="http://localhost:11434"  # Default
export OLLAMA_MODEL="qwen3:4b"              # Default
```

#### Server Ports

```bash
export WEBHOOK_PORT="3000"    # Webhook server port (default: 3000)
                              # Also used for Fishy server and status endpoint
export PORT="3000"            # General server port
```

#### Database Paths

```bash
export FISHY_DB_PATH="fishing.db"  # Fishing database path (default: fishing.db)
```

#### Agent Directories

```bash
export RONIN_EXTERNAL_AGENT_DIR="~/my-agents"  # External agent directory (optional)
```

**Note:** You can also set the external agent directory using the config command:
```bash
bun run ronin config --external-agent-dir ~/my-agents
```

This allows you to store agents outside the project folder. Agents from both the local `./agents` directory and the external directory (if set) will be loaded.

### CLI Options

- `--agent-dir <dir>` - Agent directory (default: `~/.ronin/agents`)
- `--plugin-dir <dir>` - Plugin directory (default: `./plugins`)
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
- The default agent directory is `~/.ronin/agents` (local agents folder)
- You can override with `--agent-dir` flag or use `--local` when creating agents
- The `plugins/` directory is where you place plugin files
- Both are auto-discovered by the `start` command

### External Agent Directory

You can store agents outside the project folder by setting an external agent directory. This is useful for:
- Sharing agents across multiple projects
- Keeping agents in a centralized location
- Separating agent code from project code

**Set external agent directory:**

```bash
# Using config command (recommended)
bun run ronin config --external-agent-dir ~/my-agents

# Or using environment variable
export RONIN_EXTERNAL_AGENT_DIR=~/my-agents
```

**View current configuration:**

```bash
bun run ronin config --show
```

When you run `bun run ronin start`, agents from both:
- Local directory: `~/.ronin/agents` (default, or custom path set via `--agent-dir`)
- External directory: Path set via `RONIN_EXTERNAL_AGENT_DIR` or config file

will be discovered and loaded. The external directory is optional - if it doesn't exist or isn't set, only local agents will be loaded.

### Documentation

View documentation in your browser or terminal:

```bash
# Open documentation in browser (default)
bun run ronin docs

# View specific document
bun run ronin docs CLI
bun run ronin docs ARCHITECTURE

# View in terminal
bun run ronin docs CLI --terminal

# List available documents
bun run ronin docs --list
```

Documentation is served on `http://localhost:3002/docs` by default.

## Running as a Daemon

Run Ronin as a background service that starts automatically on system boot.

### Linux (systemd)

1. **Create systemd service file:**

```bash
sudo nano /etc/systemd/system/ronin.service
```

2. **Add the following content** (adjust paths as needed):

```ini
[Unit]
Description=Ronin AI Agent System
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/ronin
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="OLLAMA_URL=http://localhost:11434"
Environment="OLLAMA_MODEL=qwen3:4b"
Environment="GROK_API_KEY=your-grok-key"
Environment="GEMINI_API_KEY=your-gemini-key"
ExecStart=/usr/local/bin/bun run ronin start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

3. **Reload systemd and enable the service:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable ronin
sudo systemctl start ronin
```

4. **Check status:**

```bash
sudo systemctl status ronin
sudo journalctl -u ronin -f  # View logs
```

5. **Manage the service:**

```bash
sudo systemctl stop ronin     # Stop
sudo systemctl start ronin    # Start
sudo systemctl restart ronin  # Restart
```

### macOS (launchd)

1. **Create launchd plist file:**

```bash
nano ~/Library/LaunchAgents/com.ronin.agent.plist
```

2. **Add the following content** (adjust paths as needed):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ronin.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/bun</string>
    <string>run</string>
    <string>ronin</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/ronin</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/ronin.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/ronin.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_URL</key>
    <string>http://localhost:11434</string>
    <key>OLLAMA_MODEL</key>
    <string>qwen3:4b</string>
    <key>GROK_API_KEY</key>
    <string>your-grok-key</string>
    <key>GEMINI_API_KEY</key>
    <string>your-gemini-key</string>
  </dict>
</dict>
</plist>
```

3. **Load and start the service:**

```bash
launchctl load ~/Library/LaunchAgents/com.ronin.agent.plist
launchctl start com.ronin.agent
```

4. **Check status:**

```bash
launchctl list | grep ronin
tail -f /tmp/ronin.log        # View logs
tail -f /tmp/ronin.error.log   # View errors
```

5. **Manage the service:**

```bash
launchctl stop com.ronin.agent    # Stop
launchctl start com.ronin.agent   # Start
launchctl unload ~/Library/LaunchAgents/com.ronin.agent.plist  # Remove
```

### Windows (NSSM - Non-Sucking Service Manager)

1. **Download and install NSSM:**
   - Download from https://nssm.cc/download
   - Extract to a folder (e.g., `C:\nssm`)
   - Add to PATH or use full path

2. **Create the service:**

```cmd
# Open Command Prompt or PowerShell as Administrator
nssm install RoninAgent "C:\path\to\bun.exe" "run ronin start"

# Set working directory
nssm set RoninAgent AppDirectory "C:\path\to\ronin"

# Set environment variables
nssm set RoninAgent AppEnvironmentExtra "OLLAMA_URL=http://localhost:11434" 
"OLLAMA_MODEL=qwen3:4b" "GROK_API_KEY=your-grok-key" "GEMINI_API_KEY=your-gemini-key"

# Set output files
nssm set RoninAgent AppStdout "C:\path\to\ronin\ronin.log"
nssm set RoninAgent AppStderr "C:\path\to\ronin\ronin.error.log"

# Configure auto-restart
nssm set RoninAgent AppRestartDelay 10000
nssm set RoninAgent AppExit Default Restart
```

3. **Start the service:**

```cmd
nssm start RoninAgent
```

4. **Check status:**

```cmd
nssm status RoninAgent
```

5. **Manage the service:**

```cmd
nssm stop RoninAgent      # Stop
nssm start RoninAgent     # Start
nssm restart RoninAgent   # Restart
nssm remove RoninAgent    # Remove service (confirm with 'y')
```

**Alternative: Windows Task Scheduler**

1. **Open Task Scheduler** (search for "Task Scheduler" in Start menu)

2. **Create Basic Task:**
   - Name: "Ronin Agent System"
   - Trigger: "When the computer starts"
   - Action: "Start a program"
   - Program: `C:\path\to\bun.exe`
   - Arguments: `run ronin start`
   - Start in: `C:\path\to\ronin`

3. **Configure additional settings:**
   - Right-click task → Properties
   - General tab: Check "Run whether user is logged on or not"
   - Actions tab: Add environment variables if needed
   - Conditions tab: Uncheck "Start the task only if the computer is on AC power"

### Environment Variables in Daemon

**Important:** When running as a daemon, environment variables from your shell profile (`~/.bashrc`, `~/.zshrc`) are not automatically loaded. You must set them in:

- **systemd**: Use `Environment=` directives in the service file
- **launchd**: Use `EnvironmentVariables` dictionary in the plist file
- **NSSM**: Use `nssm set RoninAgent AppEnvironmentExtra` command
- **Task Scheduler**: Set in task properties → Actions → Edit → Add arguments

Alternatively, create a `.env` file in the Ronin directory and load it in your service configuration, or use a wrapper script that sources your environment.

### Verifying Daemon Setup

After starting the daemon, verify it's working:

```bash
# Check if agents are running
bun run ronin status

# Check webhook server (if configured)
curl http://localhost:3000/health

# Check fishy server (if fishing database exists)
curl http://localhost:3000/fishy/api/fish
```

## License

Private project
