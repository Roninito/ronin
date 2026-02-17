# MCP (Model Context Protocol) Support

## Overview

Ronin supports the Model Context Protocol (MCP) as a **client**, allowing it to connect to external MCP servers and use their tools. MCP servers provide capabilities like filesystem access, GitHub integration, web search, and database queries without requiring direct integration into Ronin's codebase.

**Key Benefits:**
- **Extensibility**: Add new capabilities by connecting to MCP servers
- **Isolation**: MCP servers run as separate processes
- **Standardization**: Use the standard MCP protocol for tool integration
- **No Dependencies**: Servers are fetched automatically via `npx` when needed

## Available MCP Servers

Ronin includes built-in support for these well-known MCP servers:

| Server | Package | Description | Requirements |
|--------|---------|-------------|--------------|
| **filesystem** | `@modelcontextprotocol/server-filesystem` | Read and write files in a directory | Directory path |
| **github** | `@modelcontextprotocol/server-github` | GitHub issues, PRs, repository operations | `GITHUB_TOKEN` (optional) |
| **brave-search** | `@modelcontextprotocol/server-brave-search` | Web search via Brave Search API | `BRAVE_API_KEY` |
| **sqlite** | `@modelcontextprotocol/server-sqlite` | Query SQLite databases | Database path |
| **obsidian** | `obsidian-mcp-server` | Read, write, search Obsidian vault | Obsidian + Local REST API plugin, `OBSIDIAN_API_KEY` |

## Quick Start

### 1. Discover Available Servers

```bash
ronin mcp discover
```

This shows all built-in MCP servers you can add.

### 2. Add a Server

```bash
# Filesystem access (specify directory)
ronin mcp add filesystem --path ~/Documents

# GitHub integration (requires GITHUB_TOKEN in env)
ronin mcp add github

# Web search (requires Brave API key)
ronin config --brave-api-key YOUR_KEY
ronin mcp add brave-search

# SQLite database
ronin mcp add sqlite --path /path/to/database.db

# Obsidian vault (requires Local REST API plugin + API key in env)
export OBSIDIAN_API_KEY="your-key-from-obsidian-plugin"
ronin mcp add obsidian
```

### 3. List Configured Servers

```bash
ronin mcp list
```

Shows all configured servers, their status (enabled/disabled), and commands.

### 4. Use MCP Tools in Agents

Once a server is added, its tools are automatically registered with the `mcp_<server>_<tool>` naming convention:

```typescript
export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // List files using filesystem MCP server
    const files = await this.api.tools.execute(
      "mcp_filesystem_list_directory",
      { path: "/tmp" }
    );
    
    if (files.success) {
      console.log("Files:", files.data);
    }
    
    // Web search using brave-search MCP server
    const search = await this.api.tools.execute(
      "mcp_brave-search_web_search",
      { query: "AI agents 2026", count: 10 }
    );
    
    if (search.success) {
      console.log("Search results:", search.data);
    }
  }
}
```

## Configuration

### Config File Format

MCP servers are configured in `~/.ronin/config.json` under the `mcp.servers` key:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "enabled": true
      },
      "brave-search": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env": {
          "BRAVE_API_KEY": "your-api-key-here"
        },
        "enabled": true
      }
    }
  }
}
```

### Server Configuration Schema

Each server entry has:
- `command` (string): Executable to run (typically `npx`)
- `args` (array): Command-line arguments
- `env` (object, optional): Environment variables for the server process
- `enabled` (boolean): Whether to connect to this server at startup

### Brave Search API Key

The Brave Search API key can be configured in multiple ways, with the following precedence:

1. **Server config env**: `mcp.servers.brave-search.env.BRAVE_API_KEY`
2. **Environment variable**: `BRAVE_API_KEY`
3. **Config file**: `braveSearch.apiKey`

**Set via config:**
```bash
ronin config --brave-api-key YOUR_KEY
```

**Set via environment:**
```bash
export BRAVE_API_KEY="YOUR_KEY"
```

**In config.json:**
```json
{
  "braveSearch": {
    "apiKey": "your-api-key-here"
  }
}
```

Get your Brave Search API key from: https://brave.com/search/api

## CLI Commands

### `ronin mcp list`

List all configured MCP servers with their status and commands.

**Example output:**
```
📋 MCP Servers

   filesystem
      Status: enabled
      Command: npx -y @modelcontextprotocol/server-filesystem /tmp

   brave-search
      Status: enabled
      Command: npx -y @modelcontextprotocol/server-brave-search
```

### `ronin mcp discover`

Show all known MCP servers available for installation.

**Example output:**
```
📋 Known MCP Servers

   Name          | Package                                 | Description
   --------------|-----------------------------------------|---------------------------
   filesystem    | @modelcontextprotocol/server-filesystem | Read and write files in a 
   github        | @modelcontextprotocol/server-github     | GitHub issues, PRs, reposi
   brave-search  | @modelcontextprotocol/server-brave-search | Web search via Brave Searc
   sqlite        | @modelcontextprotocol/server-sqlite     | Query SQLite databases
```

### `ronin mcp add <name> [options]`

Add an MCP server from the known list or a custom server.

**Options:**
- `--path <path>`: Path for filesystem or sqlite servers
- `--command <cmd>`: Command to run (for custom servers)
- `--args '<json>'`: JSON array of arguments (for custom servers)

**Examples:**
```bash
# Add known servers
ronin mcp add filesystem --path ~/Documents
ronin mcp add github
ronin mcp add brave-search
ronin mcp add sqlite --path ./myapp.db

# Add custom server
ronin mcp add custom --command npx --args '["-y","@org/my-mcp-server"]'
```

### `ronin mcp enable <name>`

Enable a previously disabled server.

```bash
ronin mcp enable filesystem
```

### `ronin mcp disable <name>`

Temporarily disable a server without removing it from config.

```bash
ronin mcp disable brave-search
```

### `ronin mcp remove <name>`

Remove a server from configuration entirely.

```bash
ronin mcp remove filesystem
```

### `ronin mcp status`

Show summary of configured and enabled servers.

**Example output:**
```
📋 MCP Status

   Configured: 2 servers
   Enabled: 2 servers

   - filesystem
   - brave-search
```

## Using MCP Tools in Agents

### Tool Discovery

List all available tools (including MCP tools):

```typescript
const tools = this.api.tools.list();

// Filter for MCP tools
const mcpTools = tools.filter(t => t.provider.startsWith("mcp:"));

console.log("MCP tools:", mcpTools.map(t => t.name));
```

### Tool Naming Convention

MCP tools are prefixed with `mcp_<server>_<tool>`:
- `mcp_filesystem_read_file` - Read a file
- `mcp_filesystem_write_file` - Write a file
- `mcp_filesystem_list_directory` - List directory contents
- `mcp_brave-search_web_search` - Search the web
- `mcp_github_create_issue` - Create GitHub issue
- `mcp_sqlite_query` - Query SQLite database

### Execute MCP Tools

```typescript
// Read a file
const content = await this.api.tools.execute(
  "mcp_filesystem_read_file",
  { path: "/tmp/myfile.txt" }
);

// Write a file
const writeResult = await this.api.tools.execute(
  "mcp_filesystem_write_file",
  { 
    path: "/tmp/output.txt",
    content: "Hello from Ronin!"
  }
);

// Search the web
const searchResults = await this.api.tools.execute(
  "mcp_brave-search_web_search",
  { 
    query: "Bun.js features 2026",
    count: 5
  }
);

// Query database
const rows = await this.api.tools.execute(
  "mcp_sqlite_query",
  { query: "SELECT * FROM users LIMIT 10" }
);
```

### Error Handling

MCP tool results follow the standard `ToolResult` format:

```typescript
const result = await this.api.tools.execute("mcp_filesystem_read_file", { path: "/invalid/path" });

if (result.success) {
  console.log("File content:", result.data.text);
} else {
  console.error("Error:", result.error);
}
```

## Custom MCP Servers

Add any MCP-compatible server:

```bash
# Add a custom server
ronin mcp add my-server --command npx --args '["-y","@your-org/mcp-server"]'
```

The server must:
1. Implement the MCP protocol
2. Support stdio transport (stdin/stdout)
3. Respond to `listTools` and `callTool` requests

## Obsidian

Ronin can connect to an [Obsidian](https://obsidian.md) vault using the [Obsidian MCP Server](https://github.com/cyanheads/obsidian-mcp-server), which talks to the [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin.

### Prerequisites

1. **Obsidian** installed with a vault open.
2. **Local REST API plugin** installed and enabled in Obsidian.
3. In the plugin settings: enable the **non-encrypted (HTTP) server** (e.g. `http://127.0.0.1:27123`) and set an **API key**.

### Add the server

Set the API key (and optional base URL) in your environment, then add the server:

```bash
export OBSIDIAN_API_KEY="your-api-key-from-obsidian-plugin"
# Optional: default is http://127.0.0.1:27123
export OBSIDIAN_BASE_URL="http://127.0.0.1:27123"

ronin mcp add obsidian
```

Or put the same values in `~/.ronin/config.json` under `mcp.servers.obsidian.env` after adding. Restart Ronin (`ronin start`) so it connects to the Obsidian MCP server.

### Tools in agents

Once connected, tools are available with the `mcp_obsidian_` prefix, for example:

- `mcp_obsidian_obsidian_read_note` – read a note
- `mcp_obsidian_obsidian_update_note` – append, prepend, or overwrite
- `mcp_obsidian_obsidian_global_search` – search the vault
- `mcp_obsidian_obsidian_list_notes` – list notes in a folder
- `mcp_obsidian_obsidian_manage_frontmatter` – get/set/delete frontmatter
- `mcp_obsidian_obsidian_manage_tags` – add/remove/list tags
- `mcp_obsidian_obsidian_search_replace` – search-and-replace in a note
- `mcp_obsidian_obsidian_delete_note` – delete a note

Example:

```typescript
const result = await this.api.tools.execute(
  "mcp_obsidian_obsidian_read_note",
  { filePath: "Projects/MyNote.md" }
);
```

## Advanced Configuration

### Server-Specific Environment Variables

Pass environment variables to MCP servers via the `env` key:

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
          "GITHUB_API_URL": "https://api.github.com"
        },
        "enabled": true
      }
    }
  }
}
```

### Multiple Server Instances

You can add multiple instances of the same server with different configurations:

```json
{
  "mcp": {
    "servers": {
      "filesystem-docs": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"],
        "enabled": true
      },
      "filesystem-projects": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Projects"],
        "enabled": true
      }
    }
  }
}
```

Tools from each instance are prefixed with the server name:
- `mcp_filesystem-docs_read_file`
- `mcp_filesystem-projects_read_file`

## Troubleshooting

### Server Won't Start

**Symptom:** Error message like `Failed to connect to <server>`

**Solutions:**
1. Verify the server package is accessible:
   ```bash
   npx -y @modelcontextprotocol/server-filesystem /tmp
   ```
2. Check server logs in Ronin startup output
3. Verify required environment variables are set
4. Disable and re-enable: `ronin mcp disable <name> && ronin mcp enable <name>`

### No Tools Registered

**Symptom:** `ronin mcp list` shows server but `api.tools.list()` doesn't show MCP tools

**Solutions:**
1. Restart Ronin: `ronin start`
2. Check if server is enabled: `ronin mcp list`
3. Look for connection errors in startup logs

### Brave Search Returns Errors

**Symptom:** `mcp_brave-search_web_search` fails with authentication error

**Solutions:**
1. Verify API key is set:
   ```bash
   ronin config --show | grep BRAVE
   ```
2. Test the key manually:
   ```bash
   curl -H "X-Subscription-Token: YOUR_KEY" \
     "https://api.search.brave.com/res/v1/web/search?q=test"
   ```
3. Re-add the server:
   ```bash
   ronin config --brave-api-key YOUR_KEY
   ronin mcp remove brave-search
   ronin mcp add brave-search
   ```

### Server Crashes or Hangs

**Symptom:** MCP server process terminates unexpectedly

**Solutions:**
1. Check server stderr output (logged to Ronin console)
2. Test server independently: `npx @modelcontextprotocol/server-<name>`
3. Verify Node.js version compatibility (MCP requires Node 18+)
4. Disable the server if unstable: `ronin mcp disable <name>`

## Best Practices

1. **Start with filesystem**: Test MCP functionality with the filesystem server before adding others
2. **Limit scope**: Use specific paths for filesystem servers (e.g., `~/Documents`) rather than `/`
3. **Store keys in config**: Use `ronin config --brave-api-key` rather than hardcoding in server env
4. **Enable selectively**: Only enable servers you're actively using to reduce startup time
5. **Test after adding**: Verify tools are registered with `this.api.tools.list()`

## Security Considerations

- **Filesystem server**: Only grant access to directories you trust. Agents can read/write files in these directories.
- **GitHub server**: Use read-only tokens when possible. Scope tokens appropriately.
- **API keys**: Store in config.json (secure) or env vars. Never hardcode in agent files.
- **Custom servers**: Only add MCP servers from trusted sources.

## See Also

- [Hybrid Intelligence](HYBRID_INTELLIGENCE.md) - Tool orchestration system
- [CLI Reference](CLI.md) - Complete CLI documentation
- [Configuration](book/chapters/05-configuration.html) - Config file format
- [Tool Calling](TOOL_CALLING.md) - Using tools in agents
