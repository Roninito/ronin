# Ronin Architecture Documentation

## Overview

Ronin is a Bun-based AI agent library that enables scheduling and execution of TypeScript/JavaScript agent task files with memory/context management, leveraging Bun's native features and integrating with Ollama for local AI capabilities.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Interface                          │
│  (start, run, list, status, create plugin, plugins list)   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Runtime                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │AgentLoader   │  │AgentRegistry │  │CronScheduler │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Layer                              │
│  ┌──────┐ ┌────────┐ ┌──────┐ ┌────────┐ ┌──────────┐     │
│  │  AI  │ │Memory  │ │Files │ │   DB   │ │ Plugins  │     │
│  └──────┘ └────────┘ └──────┘ └────────┘ └──────────┘     │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   Ollama    │ │   SQLite    │ │   Plugins   │
│  (qwen3)    │ │  (Memory)   │ │  Directory  │
└─────────────┘ └─────────────┘ └─────────────┘
```

## Core Components

### 1. Agent System

**AgentLoader** (`src/agent/AgentLoader.ts`)
- Discovers agent files from `agents/` directory (recursively)
- Loads TypeScript/JavaScript files using dynamic `import()`
- Validates agent structure (must extend `BaseAgent`, have `execute()` method)
- Extracts metadata (schedule, watch patterns, webhook paths)

**AgentRegistry** (`src/agent/AgentRegistry.ts`)
- Manages agent lifecycle and registration
- Registers cron schedules using `CronScheduler`
- Sets up file watchers for agents with `watch` patterns
- Manages HTTP webhook routes via `Bun.serve()`
- Handles graceful shutdown

**CronScheduler** (`src/agent/CronScheduler.ts`)
- Custom cron expression parser and scheduler
- Uses `setInterval` to check cron expressions every minute
- Supports standard cron format: `minute hour day month weekday`
- Supports wildcards (`*`) and intervals (`*/N`)

### 2. Memory System

**MemoryStore** (`src/memory/Memory.ts`)
- SQLite-based persistent storage
- Tables:
  - `memories` - Key-value storage with metadata
  - `conversations` - Conversation history
  - `agent_state` - Agent execution state
- Operations: store, retrieve, search, getRecent, getByMetadata

### 3. API Layer

**AIAPI** (`src/api/ai.ts`)
- Ollama integration for qwen3 model
- Methods:
  - `complete()` - Basic text completion
  - `stream()` - Streaming completions
  - `chat()` - Chat with message history
  - `callTools()` - Function calling with tool definitions

**PluginsAPI** (`src/api/plugins.ts`)
- Plugin registration and management
- Methods:
  - `call(pluginName, method, ...args)` - Execute plugin method
  - `has(pluginName)` - Check if plugin exists
  - `list()` - Get all plugin names

**Other APIs**:
- `FilesAPI` - File operations using Bun.file
- `DatabaseAPI` - SQLite operations
- `HTTPAPI` - HTTP client using fetch
- `EventsAPI` - Event emitter for inter-agent communication

### 4. Plugin System

**Plugin Structure**:
```typescript
export default {
  name: "plugin-name",
  description: "Plugin description",
  methods: {
    methodName: async (args) => { /* ... */ }
  }
}
```

**PluginLoader** (`src/plugins/PluginLoader.ts`)
- Auto-discovers plugins from `plugins/` directory
- Loads and validates plugin structure
- Returns plugin metadata

**Tool Generation** (`src/plugins/toolGenerator.ts`)
- Converts plugins to Ollama tool definitions
- Enables function calling integration
- Auto-generates tool schemas from plugin methods

**Built-in Plugins**:
- `git.ts` - Git operations (clone, commit, push, pull, status, etc.)
- `shell.ts` - Shell command execution

### 5. CLI Interface

**Commands**:
- `ronin start` - Start and schedule all agents
- `ronin run <agent-name>` - Run agent manually
- `ronin list` - List all agents
- `ronin status` - Show runtime status
- `ronin create plugin <name>` - Create new plugin template
- `ronin plugins list` - List loaded plugins

## Data Flow

### Agent Execution Flow

1. **Discovery**: `AgentLoader` scans `agents/` directory
2. **Loading**: Dynamic import of agent files
3. **Validation**: Check agent structure and methods
4. **Registration**: `AgentRegistry` registers schedules/events
5. **Execution**: Agent's `execute()` method called on trigger
6. **API Access**: Agent receives `api` object with all capabilities

### Plugin Loading Flow

1. **Discovery**: `PluginLoader` scans `plugins/` directory
2. **Loading**: Dynamic import of plugin files
3. **Validation**: Check plugin structure (name, description, methods)
4. **Registration**: Plugins registered with `PluginsAPI`
5. **Tool Generation**: Plugins converted to tool definitions
6. **Integration**: Tools available via `api.ai.callTools()`

### Function Calling Flow

1. **Agent Request**: Agent calls `api.ai.callTools(prompt, tools)`
2. **Tool Merging**: Plugin tools automatically merged with provided tools
3. **Ollama Request**: Request sent to Ollama `/api/chat` with `tools` parameter
4. **Tool Calls**: Ollama returns tool calls in response
5. **Execution**: Tool calls executed via `api.plugins.call()`
6. **Response**: Results returned to agent

## Configuration

### Environment Variables

- `OLLAMA_URL` - Ollama API URL (default: `http://localhost:11434`)
- `OLLAMA_MODEL` - Ollama model name (default: `qwen3`)
- `WEBHOOK_PORT` - Webhook server port (default: `3000`)

### CLI Options

- `--agent-dir <dir>` - Agent directory (default: `./agents`)
- `--plugin-dir <dir>` - Plugin directory (default: `./plugins`)
- `--ollama-url <url>` - Ollama API URL
- `--ollama-model <name>` - Ollama model name
- `--db-path <path>` - Database file path (default: `ronin.db`)

## File Structure

```
ronin/
├── agents/              # Agent files (user-created)
├── plugins/             # Plugin files (user-created + built-in)
├── docs/                # Documentation
├── src/
│   ├── agent/           # Agent system
│   ├── memory/           # Memory system
│   ├── api/              # API implementations
│   ├── plugins/          # Plugin system
│   ├── cli/              # CLI commands
│   └── types/            # TypeScript types
└── ronin.db             # SQLite database (created at runtime)
```

## Key Design Decisions

1. **Async API Creation**: `createAPI()` is async to load plugins
2. **Direct Bun APIs**: Uses Bun.spawn, Bun.file, Bun.serve directly
3. **Custom Cron**: Custom scheduler since Bun.cron not available
4. **Plugin Auto-discovery**: Plugins loaded automatically from directory
5. **Tool Integration**: Plugins automatically available as tools for function calling
6. **SQLite Memory**: Persistent memory using Bun's native SQLite

## Extension Points

1. **Agents**: Add `.ts` files to `agents/` directory
2. **Plugins**: Add `.ts` files to `plugins/` directory or use `ronin create plugin`
3. **Custom APIs**: Extend `AgentAPI` interface and implement in `src/api/`
4. **CLI Commands**: Add commands to `src/cli/commands/`

## Security Considerations

1. **Shell Plugin**: Executes arbitrary commands - use with caution
2. **File Operations**: Validates paths but agents have file system access
3. **Webhooks**: HTTP server exposes endpoints - consider authentication
4. **Plugin Loading**: Dynamic imports execute code - only load trusted plugins

## Future Enhancements

1. **Graph Workflows**: Support for `graph.json` workflow definitions
2. **Plugin Schema**: Type-safe plugin parameter definitions
3. **Plugin Marketplace**: Share and install plugins
4. **Agent Dependencies**: Agents can depend on other agents
5. **Realm/Sandboxing**: Isolated execution environments

