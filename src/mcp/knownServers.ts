/**
 * Known MCP Servers
 *
 * Curated list of well-known MCP servers for discovery.
 * Used by `ronin mcp discover` - no network calls.
 */

export interface KnownServer {
  name: string;
  package: string;
  description: string;
  requiredArgs: string[];
  optionalArgs?: { name: string; description: string }[];
}

export const KNOWN_SERVERS: Record<string, KnownServer> = {
  filesystem: {
    name: "filesystem",
    package: "@modelcontextprotocol/server-filesystem",
    description: "Read and write files in a directory",
    requiredArgs: ["directory path"],
    optionalArgs: [],
  },
  github: {
    name: "github",
    package: "@modelcontextprotocol/server-github",
    description: "GitHub issues, PRs, repository operations",
    requiredArgs: [],
    optionalArgs: [{ name: "GITHUB_TOKEN", description: "GitHub personal access token (env)" }],
  },
  "brave-search": {
    name: "brave-search",
    package: "@modelcontextprotocol/server-brave-search",
    description: "Web search via Brave Search API",
    requiredArgs: [],
    optionalArgs: [{ name: "BRAVE_API_KEY", description: "Brave Search API key (env)" }],
  },
  sqlite: {
    name: "sqlite",
    package: "@modelcontextprotocol/server-sqlite",
    description: "Query SQLite databases",
    requiredArgs: ["database path"],
    optionalArgs: [],
  },
  obsidian: {
    name: "obsidian",
    package: "obsidian-mcp-server",
    description: "Read, write, search Obsidian vault via Local REST API plugin",
    requiredArgs: [],
    optionalArgs: [
      { name: "OBSIDIAN_API_KEY", description: "API key from Obsidian Local REST API plugin" },
      { name: "OBSIDIAN_BASE_URL", description: "Plugin URL (default http://127.0.0.1:27123)" },
    ],
  },
};
