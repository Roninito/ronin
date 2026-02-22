/**
 * Shared CLI utilities
 *
 * Centralizes argument parsing and global option handling so every command
 * doesn't need to re-implement flag extraction.
 */

// ─── Global Options (shared across many commands) ──────────────────────

export interface GlobalOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
  debug: boolean;
  port?: number;
  desktop: boolean;
}

/**
 * Extract a flag value from an args array (e.g. --agent-dir <value>).
 * Returns undefined if the flag is absent.
 */
export function getArg(flag: string, args: string[]): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

/**
 * Parse the common global flags that appear across most commands.
 * Returns a GlobalOptions object with all shared values resolved.
 */
export function parseGlobalOptions(args: string[]): GlobalOptions {
  return {
    agentDir: getArg("--agent-dir", args),
    ollamaUrl: getArg("--ollama-url", args),
    ollamaModel: getArg("--ollama-model", args),
    dbPath: getArg("--db-path", args),
    pluginDir: getArg("--plugin-dir", args),
    userPluginDir: getArg("--user-plugin-dir", args),
    debug: args.includes("--debug"),
    port: getArg("--port", args) ? parseInt(getArg("--port", args)!, 10) : undefined,
    desktop: args.includes("--desktop"),
  };
}

// ─── Per-Command Help Registry ─────────────────────────────────────────

const commandHelp: Record<string, string> = {
  start: `
Usage: ronin start [options]

Start and schedule all agents. Begins the webhook server, cron scheduler,
file watchers, and hot-reload service.

Options:
  --ninja                  Start in background; logs to ~/.ronin/ninja.log
  --host                   Bind to 0.0.0.0 and show network URL (share on LAN)
  --agent-dir <dir>        Agent directory (default: ./agents)
  --ollama-url <url>       Ollama API URL
  --ollama-model <name>    Default Ollama model
  --db-path <path>         Database file path
  --plugin-dir <dir>       Built-in plugin directory
  --user-plugin-dir <dir>  User plugins directory
  --desktop                Enable Desktop Mode
  --debug                  Enable debug logging
`,
  stop: `
Usage: ronin stop

Gracefully stop the running Ronin instance (SIGTERM).
`,
  restart: `
Usage: ronin restart [options]

Stop and restart Ronin. Accepts the same options as "start".
`,
  kill: `
Usage: ronin kill

Force-kill all running Ronin instances (SIGKILL).
`,
  run: `
Usage: ronin run <agent-name> [options]

Execute a specific agent manually (one-shot).

Options:
  --agent-dir <dir>        Agent directory
  --ollama-url <url>       Ollama API URL
  --ollama-model <name>    Default model
  --db-path <path>         Database path
  --plugin-dir <dir>       Plugin directory
`,
  list: `
Usage: ronin list [options]

List all registered agents with their schedules, webhooks, and file watchers.
`,
  status: `
Usage: ronin status [options]

Show runtime status: running instance info, active schedules, provider config.
`,
  ask: `
Usage: ronin ask [model] [question] [options]

Interactive AI assistant via the running Ronin instance.

Models: local (default), smart/cloud/ninja, grok, gemini

Note:
  ronin ask requires Ronin to be running first (ronin start).
  It does not boot plugins/agents/routes in the CLI process.

Examples:
  ronin ask "What is Ronin?"
  ronin ask ninja "Use the smart model for this"
  ronin ask grok "Explain quantum computing"
  ronin ask gemini "Summarize this project"

Tip: Add @ninja anywhere in a chat message to use the smart model for that turn.

Options:
  --model <name>           Model/tier (smart|cloud|ninja|local or exact model name)
  --ask-model <name>       Exact model name override (e.g. ministral-3:3b)
  --sources                Show source context used
`,
  config: `
Usage: ronin config [options]

Manage Ronin configuration.

Common usage:
  ronin config --show                     Show current config
  ronin config --init                     Interactive config setup
  ronin config set <path> <value>         Set a config value by dot-path
  ronin config --grok-api-key <key>       Set Grok API key
  ronin config --gemini-api-key <key>     Set Gemini API key
  ronin config --validate                 Validate config file
  ronin config --backup                   Create a backup
  ronin config --restore <timestamp>      Restore from backup
  ronin config --edit                     Open in editor
`,
  ai: `
Usage: ronin ai <subcommand> [options]

Manage AI model definitions in the local registry.

Subcommands:
  list                List all registered models
  add                 Add a new model definition
  remove <name>       Remove a model
  show <name>         Show model details
  run <name>          Run a model interactively
  help                Show AI command help

Alias: ronin models
`,
  routes: `
Usage: ronin routes [options]

List all registered HTTP routes on the running server.

Options:
  --port <number>    Server port (default: 3000)

Alias: ronin listRoutes
`,
  interactive: `
Usage: ronin interactive [options]

Start Ronin in REPL mode with CLI commands available interactively.

Options:
  --desktop          Enable Desktop Mode
  --debug            Enable debug logging

Aliases: ronin i
`,
  init: `
Usage: ronin init [options]

Interactive setup wizard for new installations.

Options:
  --quick              Use recommended defaults
  --skip-cloudflare    Skip Cloudflare tunnel setup
  --skip-desktop       Skip Desktop Mode setup
`,
  mcp: `
Usage: ronin mcp <subcommand> [options]

Manage MCP (Model Context Protocol) server connections.

Subcommands:
  list                List configured MCP servers
  discover            Show available well-known servers
  add <name>          Add a new MCP server
  enable <name>       Enable a configured server
  disable <name>      Disable a configured server
  remove <name>       Remove a configured server
  status              Show connection status for all servers
`,
  realm: `
Usage: ronin realm <subcommand> [options]

Manage Realm peer-to-peer connections.

Subcommands:
  connect             Connect to a Realm discovery server
                        --url <wss://...> --callsign <name>
  status              Show connection status
  discover <callsign> Discover a peer by call sign
`,
  cloudflare: `
Usage: ronin cloudflare <subcommand> [options]

Manage Cloudflare tunnels and route policy for secure remote access.

Auth:
  login                    Authenticate with Cloudflare (opens browser)
  logout                   Log out and clear local tunnel state
  status                   Show auth, policy, and tunnel status

Route policy (required before creating tunnels):
  route init               Create default policy at ~/.ronin/cloudflare.routes.json
  route add <path>         Whitelist a path
  route remove <path>      Remove a path from whitelist
  route list               List allowed routes
  route validate           Validate policy file

Tunnels:
  tunnel create <name>    Create a named tunnel
  tunnel start <name>     Start a tunnel
  tunnel stop <name>      Stop a tunnel
  tunnel delete <name>    Delete a tunnel
  tunnel list             List tunnels in state
  tunnel temp [ttl]       Create temporary tunnel (ttl in seconds, default 3600)

Other:
  pages deploy <dir> <project>  Deploy directory to Cloudflare Pages
  security audit                Print security summary
  audit                         Alias for security audit
`,
  os: `
Usage: ronin os <subcommand>

Desktop Mode commands for macOS integration.

Subcommands:
  install mac         Install macOS integrations (Quick Action + LaunchAgent)
  uninstall mac       Remove macOS integrations
  status              Show installation status
  verify              Verify installation
  clipboard enable    Enable clipboard watching
  clipboard disable   Disable clipboard watching
`,
  doctor: `
Usage: ronin doctor [ingest-docs]

Run health checks on the Ronin installation:
  - Verify Ollama connectivity
  - Check configured model availability
  - Validate API keys for cloud providers
  - Validate config file syntax
  - Report config source (env vs file vs default)

Use "ronin doctor ingest-docs" to sync reference docs, tools, and skills
into the ontology so agents can find them via ontology_search (types ReferenceDoc, Tool, Skill).
`,
  create: `
Usage: ronin create <type> [options]

Create new Ronin components.

Types:
  plugin <name>       Create a new plugin template
  agent [description] AI-powered agent creation (interactive)
  skill "description" Generate an AgentSkill from a description (SkillMaker)

Options (agent):
  --local              Create in ~/.ronin/agents instead of ./agents
  --no-preview         Skip preview before saving
  --edit               Open in editor after creation
`,
  skills: `
Usage: ronin skills <subcommand> [args] [options]

Manage AgentSkills (discover, explore, use, install from git).

Subcommands:
  list                 List all skills (default)
  discover "<query>"   Discover skills matching query
  explore <name>       Show full skill details (--scripts to include script contents)
  use <name>          Run a skill (--ability=..., --pipeline=a,b,c, --params='{}')
  install <repo>       Clone a skill from git (--name <skill-name>)
  update <name>        Pull latest for an installed skill
  init                 Git init ~/.ronin/skills for versioning
`,
  plugins: `
Usage: ronin plugins <subcommand>

Manage loaded plugins.

Subcommands:
  list                List all loaded plugins
  info <name>         Show detailed plugin information
`,
  emit: `
Usage: ronin emit <event> [data] [options]

Send an event to a running Ronin instance (for Shortcuts, scripts, testing).

Arguments:
  event               Event name (e.g. transcribe.text)
  data                Optional JSON object (e.g. '{"audioPath":"/tmp/audio.wav","source":"shortcuts"}')

Options:
  --data <json>       Pass data as JSON (instead of positional)
  --port <port>       Ronin server port (default: 3000 or WEBHOOK_PORT)

Examples:
  ronin emit transcribe.text '{"audioPath":"/tmp/recording.wav","source":"shortcuts"}'
  ronin emit my.event --data '{"key":"value"}' --port 3141
`,
  kdb: `
Usage: ronin kdb <subcommand> [args] [options]

Ontology and memory stats and queries (knowledge DB).

Subcommands:
  stats                     Show ontology + memory table counts
  memory search <query>      Search memories by text (--limit N)
  memory recent             Recent memories (--limit N)
  memory get <key>           Retrieve value by key
  ontology search            Search nodes (--type T --name pattern --domain D --limit N)
  ontology lookup <id>       Get node by id
  ontology related <id>      Related nodes (--relation R --depth N --limit N)

Options:
  --db-path <path>          Database path (default: ronin.db)
  --plugin-dir <dir>        Plugin directory
  --user-plugin-dir <dir>    User plugins directory

Examples:
  ronin kdb stats
  ronin kdb memory search "telegram" --limit 5
  ronin kdb memory get refdoc:PLUGINS
  ronin kdb ontology search --type ReferenceDoc --limit 20
  ronin kdb ontology lookup Task-abc123
`,
};

/**
 * Get help text for a specific command. Returns null if unknown.
 */
export function getCommandHelp(command: string): string | null {
  return commandHelp[command] ?? null;
}

/**
 * Get all known command names (for autocomplete, help listing).
 */
export function getCommandNames(): string[] {
  return Object.keys(commandHelp);
}
