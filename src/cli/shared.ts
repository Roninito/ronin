/**
 * Shared CLI utilities
 *
 * Centralizes argument parsing and global option handling so every command
 * doesn't need to re-implement flag extraction.
 */

// ─── Global Options (shared across many commands) ──────────────────────

export interface GlobalOptions {
  dutyDir?: string;
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
 * Extract a flag value from an args array (e.g. --duty-dir <value>).
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
    dutyDir: getArg("--duty-dir", args),
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

/**
 * Remove known flags (and the value token immediately after each one) from
 * an args array, leaving only positional subcommand arguments. Used by
 * commands like kdb/kata/contract/workflow/task that take a leading
 * subcommand followed by a mix of positional args and --flag <value> pairs.
 */
export function stripFlags(args: string[], flagsWithValues: string[]): string[] {
  const flags = new Set(flagsWithValues);
  return args.filter((a, i) => {
    if (flags.has(a)) return false;
    const prev = args[i - 1];
    if (i > 0 && prev !== undefined && flags.has(prev)) return false;
    return true;
  });
}

// ─── Per-Command Help Registry ─────────────────────────────────────────

const commandHelp: Record<string, string> = {
  start: `
Usage: ronin start [options]

Start and schedule all duties. Begins the webhook server, cron scheduler,
file watchers, and hot-reload service.

Options:
  --ninja                  Start in background; logs to ~/.ronin/ninja.log
  --host                   Bind to 0.0.0.0 and show network URL (share on LAN)
  --duty-dir <dir>         Duty directory (default: ./duties)
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
Usage: ronin run <duty-name> [options]

Execute a specific duty manually (one-shot).

Options:
  --duty-dir <dir>         Duty directory
  --ollama-url <url>       Ollama API URL
  --ollama-model <name>    Default model
  --db-path <path>         Database path
  --plugin-dir <dir>       Plugin directory
`,
  list: `
Usage: ronin list [options]

List all registered duties with their schedules, webhooks, and file watchers.
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
  It does not boot plugins/duties/routes in the CLI process.

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
  client: `
Usage: ronin client [start|install|build] [options]

Launch the optional ElectronBun desktop client with a built-in Home/Dashboard view.
This does not replace existing RoninTray/Desktop Mode integrations.

Subcommands:
  start                    Launch desktop client (default)
  install                  Install desktop client dependencies
  build                    Build distributable app packages

Options:
  --url <url>               Target Ronin URL (default: http://127.0.0.1:3000/)
  --port <number>           Target Ronin port when --url is not provided (default: 3000)
  --skip-health-check       Open client view without pre-flight /api/health check
  --platform <name>         Build target for "build": mac|win|linux|all (default: all)
  --dry-run                 Print build intent without executing build

Examples:
  ronin client
  ronin client start --port 17341
  ronin client install
  ronin client build --platform mac
  ronin client build --platform all
  ronin client --port 17341
  ronin client --url http://127.0.0.1:3000/
`,
  doctor: `
Usage: ronin doctor [ingest-docs [--clean]]

Run health checks on the Ronin installation:
  - Verify Ollama connectivity
  - Check configured model availability
  - Validate API keys for cloud providers
  - Validate config file syntax
  - Report config source (env vs file vs default)

Use "ronin doctor ingest-docs" to sync reference docs, tools, and skills
into memory/notes/ so agents can find them via local.memory.search (refdoc-*, tool-*, skill-* keys).
Use "ronin doctor ingest-docs --clean" to purge existing refdoc-* notes first before re-ingesting.
`,
  create: `
Usage: ronin create <type> [options]

Create new Ronin components.

Types:
  plugin <name>          Create a new plugin template
  duty [description]     AI-powered duty creation (interactive)
  skill "description"    Generate an AgentSkill from a description (SkillMaker)
  kata "intent"           AI-generates a kata DSL from plain language (alias for "kata propose")
  workflow "description"  AI-drafts a workflow markdown SOP (alias for "workflow propose")

Options (duty):
  --local              Create in ~/.ronin/duties instead of ./duties
  --no-preview         Skip preview before saving
  --edit               Open in editor after creation

Options (kata, workflow):
  --yes, -y            Skip confirmation prompt
`,
  daemon: `
Usage: ronin daemon <subcommand>

Manage Ronin running as a background daemon (PID file at ~/.ronin/ronin.pid,
logs at ~/.ronin/daemon.log). "ronin daemon start" is equivalent to
"ronin start --daemon".

Subcommands:
  start               Start Ronin as a daemon
  stop                Stop the running daemon
  status              Show whether the daemon is running
  restart             Stop and start the daemon
  logs                Tail the daemon log
`,
  cancel: `
Usage: ronin cancel duty-creation [taskId] [options]

Cancel a pending AI-powered duty creation task (started via "ronin create duty").

Options:
  --port <number>     Ronin server port (default: 3000)
`,
  docs: `
Usage: ronin docs [document] [options]

View Ronin's documentation, either in the browser (default) or the terminal.

Options:
  --terminal           Print to terminal instead of opening a browser
  --list               List available documents and exit
  --port <number>      Local docs server port

Examples:
  ronin docs                     Open documentation index in browser
  ronin docs CLI                 Open the CLI reference
  ronin docs PLUGINS --terminal  Print the plugins doc to terminal
  ronin docs --list              List all available documents
`,
  schedule: `
Usage: ronin schedule <subcommand> [args] [options]

Manage and inspect cron schedules for duties.

Subcommands:
  list                        List all duties with their schedules
  build                       Interactive schedule builder
  explain <expression>        Explain a cron expression in plain language
  validate <expression>       Validate a cron expression
  templates                   List common schedule templates
  apply <duty> <schedule>     Apply a schedule to a duty file
`,
  version: `
Usage: ronin version

Print the installed Ronin version and check for available updates.
`,
  kata: `
Usage: ronin kata <subcommand> [options]

Manage katas — deterministic workflow definitions run by the execution engine.

Run "ronin kata" or "ronin kata help" for the full subcommand list and options
(propose, list, show, validate, register, test, deprecate, delete).
`,
  contract: `
Usage: ronin contract <subcommand> [options]

Manage contracts — schedules/triggers (cron, event, or webhook) that run a kata.

Run "ronin contract" or "ronin contract help" for the full subcommand list and
options (list, show, create, update, enable, disable, test, validate, register,
delete, history, dry-run, export, import, stats, propose).
`,
  task: `
Usage: ronin task <subcommand> [options]

View and manage task executions produced by contracts/katas.

Run "ronin task" or "ronin task help" for the full subcommand list and options
(list, show, cancel, retry).
`,
  workflow: `
Usage: ronin workflow <subcommand> [options]

Manage workflow markdown SOPs — guidance duties consult, never executed directly.

Run "ronin workflow" or "ronin workflow help" for the full subcommand list and
options (list, show, new, edit, propose).
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

Inspect Ronin's file-backed memory (memory/notes, memory/conversations, memory/blackboards).

Subcommands:
  stats                     Show file counts per memory area
  memory search <query>      Search notes by text (--limit N)
  memory recent             Recently modified notes (--limit N)
  memory get <key>           Retrieve a stored value by key
  conversation <duty>        Show a duty's conversation transcript (--limit N)
  blackboard <duty>          Show a duty's blackboard

Options:
  --db-path <path>          Database path (default: ronin.db) — memory/ lives alongside it
  --plugin-dir <dir>        Plugin directory
  --user-plugin-dir <dir>    User plugins directory

Examples:
  ronin kdb stats
  ronin kdb memory search "telegram" --limit 5
  ronin kdb memory get refdoc-PLUGINS
  ronin kdb conversation messenger --limit 20
  ronin kdb blackboard messenger
`,
  update: `
Usage: ronin update [options]

Update Ronin and Bun to the latest versions. Creates an automatic backup
before updating.

Options:
  --check                    Check for available updates without installing
  --rollback                 Rollback to the previous version
  --quiet                    Suppress verbose output

Features:
  - Automatic backup before update (kept in ~/.ronin/backups/)
  - Git pull from main branch
  - Dependency reinstall (bun install)
  - Optional RoninTray app update (macOS)
  - Cache cleanup
  - Old backups auto-pruned (keeps last 5)

Examples:
  ronin update                       # Update to latest version
  ronin update --check               # Check for updates without installing
  ronin update --rollback            # Rollback to previous version

Note:
  After updating, restart Ronin: ronin start
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
