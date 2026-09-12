# Ronin

> **Canonical architecture:** see [`ARCHITECTURE.md`](./ARCHITECTURE.md)

A Bun-based automation runtime for scheduling and running TypeScript/JavaScript
**Duties** — with memory/context management, Bun's native features (cron,
file watching, HTTP), and local-first AI via Ollama by default (cloud
providers optional).

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — canonical, always current. If any other document disagrees with it, this one wins.
- [`DUTIES.md`](./DUTIES.md) — how to write a Duty file (the practical reference).
- [`docs/WORKFLOWS.md`](./docs/WORKFLOWS.md) — markdown SOPs Duties consult as guidance (`/workflows` page, `ronin workflow` CLI).
- [`docs/REMOTE_ACCESS.md`](./docs/REMOTE_ACCESS.md) — using the dashboard from your phone via a Cloudflare Tunnel.
- [`docs/history/`](./docs/history/) — archived planning docs and phase summaries. Point-in-time record, never live guidance.
- Nothing outside this repository is ever authoritative — not a file on someone's Desktop, not another machine. Architecture docs live here, under version control, or they go stale.

## Features

- **Simple Duty Classes**: Write duties as TypeScript/JavaScript classes that extend a base `BaseDuty` class
- **Cron Scheduling**: Custom cron scheduler for time-based duty execution
- **File Watching**: Watch files and directories for changes
- **Webhook Support**: HTTP webhooks for triggering duties
- **Memory System**: SQLite-based storage for duty state and conversation history
- **Rich API**: Duties receive an `api` object with AI, files, database, HTTP, and event capabilities
- **Plugin System**: Auto-discoverable plugins with built-in git and shell plugins
- **Function Calling**: Duties can use plugins as tools via AI function calling
- **Hybrid Intelligence**: Tool orchestration system with local + cloud AI support
- **MCP Client**: Connect to external MCP servers for filesystem, GitHub, web search, and database tools
- **Workflows**: Markdown SOPs (`workflows/*.md`) describing how a category of work should go — hand-edited or AI-drafted, discovered and folded into a Duty's context automatically, never compiled or executed directly. See [`docs/WORKFLOWS.md`](./docs/WORKFLOWS.md).
- **Desktop Mode**: macOS integration with Quick Actions, menubar, and notifications
- **Optional Desktop Client**: ElectronBun shell with built-in Home/Dashboard view
- **CLI Management**: Simple CLI to start, run, list, and check status of duties

## Quick Start

### 🚀 New to Ronin? Start Here!

```bash
# Interactive setup wizard (RECOMMENDED)
ronin init

# Or use defaults for fastest setup
ronin init --quick
```

The setup wizard will guide you through:
- **Privacy Mode**: Choose between Offline Mode (most private) or Hybrid Mode
- **Desktop Integration** (macOS): Enable Quick Actions, menubar controls, and notifications
- **Cloudflare**: Optional secure tunnel setup for remote access — see [`docs/REMOTE_ACCESS.md`](./docs/REMOTE_ACCESS.md) for using the dashboard from your phone
- **AI Providers**: Configure Grok/Gemini (optional - uses local AI by default)

### Manual Setup

```bash
# Install dependencies
bun install

# Setup environment (interactive)
./setup-env.sh

# List available duties
bun run ronin list

# List available plugins
bun run ronin plugins list

# Run a specific duty manually (duty id = filename in duties/)
bun run ronin run example-duty

# Create a new plugin
bun run ronin create plugin my-plugin

# Create a new duty with AI assistance (interactive)
bun run ronin create duty "monitor log files and alert on errors"
bun run ronin create duty "backup database" --local  # Create in external ~/.ronin/duties directory

# Cancel duty creation if needed
bun run ronin cancel duty-creation

# Ask questions about Ronin (requires Ronin to be running)
bun run ronin start  # Start Ronin first
bun run ronin ask "how do plugins work?"
bun run ronin ask grok "explain duty scheduling"  # Use Grok
bun run ronin ask gemini "how to create plugins"  # Use Gemini
bun run ronin ask  # Interactive mode
bun run ronin ask "question" --ask-model ministral-3:3b  # Use specific Ollama model

# Manage MCP servers for extended capabilities
bun run ronin mcp discover                      # Show available MCP servers
bun run ronin mcp add filesystem --path ~/Documents  # Add filesystem access
bun run ronin mcp add brave-search               # Add web search (requires API key)
bun run ronin mcp list                          # List configured servers

# Manage skills (follows Anthropic's external "Agent Skills" markdown format —
# see the note in DUTIES.md; this is unrelated to Ronin's own Duty concept)
bun run ronin skills list                       # List all skills
bun run ronin skills discover "log monitor"    # Discover skills by query
bun run ronin skills explore log-monitor        # Explore skill details
bun run ronin skills use log-monitor --ability=countErrors --params='{"logPath":"/var/log/app.log"}'
bun run ronin create skill "monitor logs and alert on errors"  # Create new skill

# Start all duties (schedules them and keeps running)
bun run ronin start

# Launch optional ElectronBun desktop client
bun run ronin client
bun run ronin client install
bun run ronin client build --platform mac

# Or use the npm script
bun start
```

**Note:** After installing globally (`bun link` or `npm install -g`), you can use `ronin` directly instead of `bun run ronin`.

**Note on `example-duty`:** the example duty file is still named
`duties/example-agent.ts` (class `ExampleAgent`) — one of several duty files
that predate the Agent→Duty rename and haven't been renamed yet. Its duty id
is `example-agent`, not `example-duty`; run it with `bun run ronin run
example-agent`. See `ARCHITECTURE.md` §4 for the full list of these naming
leftovers.

## First-Time Setup

### Interactive Wizard (Recommended)

Ronin includes an interactive setup wizard that explains all options:

```bash
# Full interactive setup
ronin init

# Quick setup with recommended defaults
ronin init --quick

# Skip specific features
ronin init --skip-cloudflare --skip-desktop
```

The wizard will help you:
1. **Choose Privacy Mode**: Offline Mode (local AI only) or Hybrid Mode
2. **Enable Desktop Mode** (macOS): Right-click integration, menubar, notifications
3. **Set up Cloudflare**: Secure remote access with zero-trust security ([remote access guide](./docs/REMOTE_ACCESS.md))
4. **Configure AI Providers**: Optional Grok/Gemini keys

### Privacy-First Defaults

Ronin defaults to the most private configuration:
- ✅ **Offline Mode**: Uses only local AI (Ollama)
- ✅ **No data leaves your machine**
- ✅ **Works without internet**
- ✅ **Optional features are truly optional**

You can change any setting later via the CLI or menubar.

## AI Definitions (CLI)

Ronin can manage local AI model definitions in a registry file at `~/.ronin/ai-models.json` and run them via `ollama run`.

```bash
# Add a model definition
bun run ronin ai add qwen3 --model qwen3:1.7b --description "Fast local model"

# List all definitions
bun run ronin ai list

# Run a definition
bun run ronin ai run qwen3
```

## Writing Duties

See [DUTIES.md](./DUTIES.md) for detailed documentation on writing duty files.

## Plugins

Ronin includes a plugin system for extending functionality:

- **Built-in Plugins**: auto-discovered from `plugins/` — git, shell, web-scraper, torrent, telegram, discord, realm (WebRTC/WebSocket relay), reticulum (mesh networking), langchain, email, notion, obsidian, cloudflare, and several coding-CLI adapters (claude-cli, cursor-cli, gemini-cli, opencode-cli, qwen-cli), among others
- **Direct API Access**: ✨ Use `api.git.*`, `api.shell.*`, `api.scrape.*`, `api.torrent.*`, `api.telegram.*`, `api.discord.*`, `api.langchain.*`, `api.realm.*`, `api.reticulum.*`, `api.email.*` for type-safe, ergonomic access. Everything else goes through `api.plugins.call(name, method, ...args)`.
- **Auto-discovery**: Plugins automatically loaded from `plugins/` directory
- **Function Calling**: Plugins available as tools for AI function calling
- **CLI Tools**: Create and manage plugins via CLI

**Example:**
```typescript
// Clean, type-safe direct API
const status = await this.api.git?.status();
await this.api.shell?.exec("ls", ["-la"]);

// Telegram bot
const botId = await this.api.telegram?.initBot("YOUR_TOKEN");
await this.api.telegram?.sendMessage(botId, "@channel", "Hello!");

// Discord bot
const clientId = await this.api.discord?.initBot("YOUR_TOKEN");
await this.api.discord?.sendMessage(clientId, "channel-id", "Hello!");

// LangChain integration
const result = await this.api.langchain?.runChain("Hello {name}!", { name: "World" });

// Or use generic API for any plugin
await this.api.plugins.call("custom-plugin", "method");
```

See [docs/PLUGINS.md](./docs/PLUGINS.md) for plugin development guide.

## Function Calling

Duties can use AI function calling to interact with plugins:

```typescript
const { toolCalls } = await this.api.ai.callTools(
  "Check git status",
  [] // Plugin tools automatically included
);
```

See [docs/TOOL_CALLING.md](./docs/TOOL_CALLING.md) for detailed guide.

## Plan Workflow (Event-Sourced)

Ronin includes an event-driven system for turning a proposed plan into a
tracked, human-approved unit of executed work:

**Architecture (real duties, from `duties/`):**
- **`duties/tasking.ts`** (`TodoAgent`) — state authority; listens for `PlanProposed`, creates a Kanban card; serves the `/todo` dashboard and `/api/todo/*` endpoints
- **`duties/manual-approval.ts`** — approve/reject/block API (`/api/plans/:id/approve` etc.); emits approval events
- **`duties/coder-bot.ts`** — pure reactor; on `PlanApproved`, shells out to a coding CLI to execute the plan
- **`duties/alert-observer.ts`, `duties/log-observer.ts`** — observe and log the same events

**How a plan actually gets proposed:** there is no dedicated inbound-channel
listener bundled with Ronin (no Telegram/Discord hashtag capture duty).
`PlanProposed` is only ever emitted by an AI tool call to `local.events.emit`
(see [DUTIES.md](./DUTIES.md)'s `api.events` section) — typically from a
tool-calling chat session such as the `/chat` UI (`duties/chatty.ts`). Wire
your own inbound trigger (a channel-bridge duty, a webhook) if you want a
fixed intake pipeline instead of chat-driven proposals.

**Key Principles:**
- ✅ No shared state (all communication via events)
- ✅ Single state authority (`TodoAgent` owns the kanban board)
- ✅ Pure reactor (`coder-bot.ts` never touches board state directly)
- ✅ Observable everything (all transitions emit events)

**Quick Example:**
```bash
# 1. View the kanban board
curl http://localhost:3000/todo

# 2. Approve a proposed plan
curl -X POST http://localhost:3000/api/plans/<id>/approve

# 3. Coder Bot executes, Todo updates, observers log/alert
```

**Events:** `PlanProposed` → `PlanApproved` → `PlanCompleted`/`PlanFailed`

## Desktop Mode (macOS)

Seamlessly integrate Ronin with your macOS workflow:

- **Quick Actions**: Right-click files → Services → Send to Ronin
- **Native Notifications**: macOS notifications grouped under "Ronin"
- **Menubar Controls**: 🥷 Toggle Desktop/Offline/Clipboard modes
- **Clipboard Watching**: Opt-in clipboard monitoring
- **File Watching**: Monitor Desktop, Downloads, etc.

```bash
# Install macOS integrations
bun run ronin os install mac

# Enable Desktop Mode
bun run ronin config set desktop.enabled true

# Start with Desktop Mode
bun run ronin start --desktop
```

**Menubar Features:**
- Toggle Desktop Mode on/off
- Enable/disable Offline Mode (local AI only)
- Enable/disable Clipboard monitoring
- Switch AI provider (Local/Grok/Gemini)
- View recent files/texts
- Open dashboard

See [docs/DESKTOP_MODE.md](./docs/DESKTOP_MODE.md) for complete documentation.

## Hybrid Intelligence

Ronin includes a `ToolChat`/`ToolRouter` subsystem (`src/tools/`) for
cost-aware tool orchestration, separate from the main model router (see
`ARCHITECTURE.md` §7):

- **Local tools** you can call without any AI: `local.memory.search`,
  `local.file.read`/`list`, `local.shell.safe`, `local.http.request`,
  `local.reasoning`, `local.events.emit`, `local.speech.say`,
  `local.ronin_script.*`, `skills.list`/`run`, `local.discord.*`, and more —
  see `src/tools/providers/LocalTools.ts` for the full, current set.
- **Cloud adapters** (`src/tools/adapters/`): Anthropic, Gemini, OpenAI, and
  an Ollama-cloud adapter, selected when a workflow needs to escalate beyond
  local tools.
- **6 pre-built workflows** (`src/tools/workflows/examples.ts`):
  research-and-visualize, code-review, create-documentation, analyze-data,
  investigate-bug, create-content.
- **Cost tracking**: built-in cost management and policy enforcement.
- **Offline Mode**: works 100% offline with local tools.

> **Naming collision, not a typo:** this `WorkflowDefinition`/`WorkflowEngine`
> pipeline is a different, older concept from the markdown `workflows/*.md`
> Workflow SOPs described above and in `ARCHITECTURE.md` §2. Same word, two
> unrelated systems — see the disclaimer in `ARCHITECTURE.md` §2 for the full
> story.

```typescript
import { toolChat } from "../src/tools/ToolChat.js";

const result = await toolChat(api, [
  { role: "user", content: "Research this topic and create a summary" },
], { enableTools: true });
```

See [docs/HYBRID_INTELLIGENCE.md](./docs/HYBRID_INTELLIGENCE.md) for more detail.

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
export OLLAMA_MODEL="qwen3:1.7b"              # Default
```

#### Server Ports

```bash
export WEBHOOK_PORT="3000"    # Webhook server port (default: 3000)
                              # Also used for the status endpoint
export PORT="3000"            # General server port
```

#### Database Paths

```bash
export FISHY_DATA_DIR="~/.ronin/data"         # Fishy data directory (default)
export FISHY_DB_PATH="~/.ronin/data/fishing.db" # Fishing database path (default)
```

#### Duty Directories

```bash
export RONIN_EXTERNAL_DUTY_DIR="~/.ronin/duties"  # External duty directory (default)
```

**Note:** You can also set the external duty directory using the config command:
```bash
bun run ronin config --external-duty-dir ~/my-duties
```

This allows you to store duties outside the project folder. Duties from both the local `./duties` directory and the external directory will be loaded by default.

### CLI Options

- `--duty-dir <dir>` - Duty directory (default: `./duties`)
- `--plugin-dir <dir>` - Built-in plugin directory (default: `./plugins`)
- `--user-plugin-dir <dir>` - User plugins directory (default: `~/.ronin/plugins`)
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--ask-model <name>` - Ollama model specifically for `ask` command (e.g., `qwen3:1.7b`)
- `--db-path <path>` - Database file path (default: `ronin.db`)

### Ask Command Options

**Important:** The `ask` command now requires Ronin to be running (`ronin start`). It connects to the running instance via HTTP to provide a unified chat experience with conversation history and context.

The `ask` command supports using different AI models/tiers:

**Model tiers:**
- `bun run ronin ask "question"` - Use default model (local Ollama)
- `bun run ronin ask smart "question"` - Use smart tier (configured cloud/local model)
- `bun run ronin ask cloud "question"` - Use cloud tier (remote AI)

**Specific models:**
- `bun run ronin ask "question" --ask-model ministral-3:3b` - Use specific Ollama model
- `bun run ronin ask "question" --ask-model qwen3:1.7b` - Use another Ollama model

**Note:** The `--ask-model` flag specifies a particular model to use. Model tiers (`smart`, `cloud`) use configured models from your Ronin instance settings.

## Project Structure

```
ronin/
├── src/
│   ├── duty/            # BaseDuty, DutyLoader, DutyRegistry
│   ├── memory/          # SQLite-based memory system
│   ├── api/             # API namespace (ai, files, db, http, events)
│   ├── tools/           # ToolRouter, adapters, LocalTools, ToolChat
│   ├── cli/             # CLI commands
│   ├── types/           # TypeScript types
│   └── index.ts         # Main library export
├── duties/              # Your duty files (loaded by the `start` command)
├── plugins/             # Plugin files (auto-discovered)
│   ├── git.ts           # Built-in git plugin
│   ├── shell.ts          # Built-in shell plugin
│   └── hyprland.ts      # Example custom plugin
├── docs/                # Documentation
│   ├── ARCHITECTURE.md  # System architecture (canonical)
│   ├── PLUGINS.md       # Plugin development guide
│   └── TOOL_CALLING.md  # Function calling guide
└── tests/               # Test files
```

**Note:**
- The default local duty directory is `./duties`
- The default external duty directory is `~/.ronin/duties`
- You can override local with `--duty-dir` or use `--local` to create in the external directory
- The `plugins/` directory is where you place plugin files
- Both are auto-discovered by the `start` command

### External Duty Directory

You can store duties outside the project folder by setting an external duty directory. This is useful for:
- Sharing duties across multiple projects
- Keeping duties in a centralized location
- Separating duty code from project code

**Set external duty directory:**

```bash
# Using config command (recommended)
bun run ronin config --external-duty-dir ~/my-duties

# Or using environment variable
export RONIN_EXTERNAL_DUTY_DIR=~/my-duties
```

**View current configuration:**

```bash
bun run ronin config --show
```

When you run `bun run ronin start`, duties from both:
- Local directory: `./duties` (default, or custom path set via `--duty-dir`)
- External directory: `~/.ronin/duties` (default, or custom path set via `RONIN_EXTERNAL_DUTY_DIR` or config file)

will be discovered and loaded. The external directory is optional - if it doesn't exist or isn't set, only local duties will be loaded.

### Plugin System

Ronin uses a dual-plugin system similar to duties:

**Built-in plugins:** Located in `./plugins` (project-specific)
- Managed and updated with the codebase
- Safe to modify during development
- Version controlled with the project

**User plugins:** Located in `~/.ronin/plugins` (user-specific)
- Survive codebase updates
- Override built-in plugins with the same name
- Not tracked in version control
- Perfect for customizations and private plugins

**How it works:**
When loading plugins, Ronin checks both directories. If a plugin exists in both:
- The **user plugin** takes precedence and overrides the built-in
- Only the user version is loaded

**Initialize user directories:**

```bash
# Create ~/.ronin/ structure with duties/ and plugins/ directories
bun run ronin config --init
```

**Create a user plugin:**

```bash
# Create a custom plugin in the user directory
cat > ~/.ronin/plugins/my-custom.ts << 'EOF'
import type { Plugin } from "@ronin/plugins/base.js";

export default {
  name: "my-custom",
  description: "My custom plugin",
  methods: {
    hello: () => "Hello from my custom plugin!",
  },
} as Plugin;
EOF
```

**View plugin directories:**

```bash
bun run ronin config --show
```

### User Configuration

Ronin stores user configuration and sensitive data in `~/.ronin/`:

```
~/.ronin/
├── config.json           # Main configuration (API keys, paths)
├── duties/               # User duties (shared across projects)
├── plugins/              # User plugins (override built-ins)
├── data/                 # Application data
└── ai-models.json        # AI model registry
```

**Benefits:**
- ✅ **Safe updates:** User configs and plugins survive codebase updates
- ✅ **Sensitive data:** API keys, tokens stored outside the project
- ✅ **Portability:** Move your customizations between installations
- ✅ **Version control:** Keep sensitive data out of git

**Set configuration values:**

```bash
# Initialize user directories
bun run ronin config --init

# Show current configuration
bun run ronin config --show

# Set API keys (stored in ~/.ronin/config.json)
bun run ronin config --grok-api-key sk-xxxxx
bun run ronin config --gemini-api-key AIxxxxx

# Set custom directories
bun run ronin config --external-duty-dir ~/my-duties
bun run ronin config --user-plugin-dir ~/my-plugins
```

### Documentation

View documentation in your browser or terminal:

```bash
# Open documentation in browser (default)
bun run ronin docs

# View specific document
bun run ronin docs CLI
bun run ronin docs ARCHITECTURE
bun run ronin docs MEMORY_DB

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
Description=Ronin Automation Service
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/ronin
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="OLLAMA_URL=http://localhost:11434"
Environment="OLLAMA_MODEL=qwen3:1.7b"
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
nano ~/Library/LaunchAgents/com.ronin.plist
```

2. **Add the following content** (adjust paths as needed):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ronin</string>
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
    <string>qwen3:1.7b</string>
    <key>GROK_API_KEY</key>
    <string>your-grok-key</string>
    <key>GEMINI_API_KEY</key>
    <string>your-gemini-key</string>
  </dict>
</dict>
</plist>
```

> `~/Library/LaunchAgents/` is macOS's own directory name for user launch
> daemons — that's Apple's terminology, unrelated to Ronin's Duty/Agent
> naming, and isn't something to rename.

3. **Load and start the service:**

```bash
launchctl load ~/Library/LaunchAgents/com.ronin.plist
launchctl start com.ronin
```

4. **Check status:**

```bash
launchctl list | grep ronin
tail -f /tmp/ronin.log        # View logs
tail -f /tmp/ronin.error.log   # View errors
```

5. **Manage the service:**

```bash
launchctl stop com.ronin    # Stop
launchctl start com.ronin   # Start
launchctl unload ~/Library/LaunchAgents/com.ronin.plist  # Remove
```

### Windows (NSSM - Non-Sucking Service Manager)

1. **Download and install NSSM:**
   - Download from https://nssm.cc/download
   - Extract to a folder (e.g., `C:\nssm`)
   - Add to PATH or use full path

2. **Create the service:**

```cmd
# Open Command Prompt or PowerShell as Administrator
nssm install RoninService "C:\path\to\bun.exe" "run ronin start"

# Set working directory
nssm set RoninService AppDirectory "C:\path\to\ronin"

# Set environment variables
nssm set RoninService AppEnvironmentExtra "OLLAMA_URL=http://localhost:11434" 
"OLLAMA_MODEL=qwen3:1.7b" "GROK_API_KEY=your-grok-key" "GEMINI_API_KEY=your-gemini-key"

# Set output files
nssm set RoninService AppStdout "C:\path\to\ronin\ronin.log"
nssm set RoninService AppStderr "C:\path\to\ronin\ronin.error.log"

# Configure auto-restart
nssm set RoninService AppRestartDelay 10000
nssm set RoninService AppExit Default Restart
```

3. **Start the service:**

```cmd
nssm start RoninService
```

4. **Check status:**

```cmd
nssm status RoninService
```

5. **Manage the service:**

```cmd
nssm stop RoninService      # Stop
nssm start RoninService     # Start
nssm restart RoninService   # Restart
nssm remove RoninService    # Remove service (confirm with 'y')
```

**Alternative: Windows Task Scheduler**

1. **Open Task Scheduler** (search for "Task Scheduler" in Start menu)

2. **Create Basic Task:**
   - Name: "Ronin Automation Service"
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
- **NSSM**: Use `nssm set RoninService AppEnvironmentExtra` command
- **Task Scheduler**: Set in task properties → Actions → Edit → Add arguments

Alternatively, create a `.env` file in the Ronin directory and load it in your service configuration, or use a wrapper script that sources your environment.

### Verifying Daemon Setup

After starting the daemon, verify it's working:

```bash
# Check if duties are running
bun run ronin status

# Check webhook server (if configured)
curl http://localhost:3000/health

# Check fishy server (requires a "fishy" duty in ~/.ronin/duties)
curl http://localhost:3000/fishy/api/fish
```

## License

Private project
