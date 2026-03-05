/**
 * MCP CLI Commands
 *
 * Manage MCP server connections: list, discover, add, enable, disable, remove, status
 */

import { getConfigService } from "../../config/ConfigService.js";
import { KNOWN_SERVERS } from "../../mcp/knownServers.js";
import type { MCPConfig, MCPServerConfig } from "../../config/types.js";
import { homedir } from "os";
import { join } from "path";

type RemoteMCPProvider = "playbooks.com";

function getConfigPath(): string {
  return join(homedir(), ".ronin", "config.json");
}

function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function parsePlaybooksMcpLinks(markdown: string): Array<{ owner: string; repo: string }> {
  const out: Array<{ owner: string; repo: string }> = [];
  const re = /\]\(\/mcp\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    out.push({ owner: m[1], repo: m[2] });
  }
  return out;
}

function getRemoteMcpProviders(system: { skillProviders?: string[] }): RemoteMCPProvider[] {
  const providers = Array.isArray(system?.skillProviders) ? system.skillProviders : [];
  const normalized = providers.map((v) => String(v).toLowerCase());
  return normalized.includes("playbooks.com") || normalized.includes("playbooks")
    ? ["playbooks.com"]
    : [];
}

async function discoverPlaybooksMcp(query: string): Promise<Array<{ name: string; repo: string; source: string }>> {
  const url = `https://playbooks.com/mcp?search=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) return [];
    const text = await res.text();
    const unique = new Set<string>();
    const out: Array<{ name: string; repo: string; source: string }> = [];
    for (const item of parsePlaybooksMcpLinks(text)) {
      const key = `${item.owner}/${item.repo}`.toLowerCase();
      if (unique.has(key)) continue;
      unique.add(key);
      out.push({
        name: item.repo,
        repo: `${item.owner}/${item.repo}`,
        source: "playbooks.com",
      });
    }
    return out.slice(0, 40);
  } catch {
    return [];
  }
}

async function loadFullConfig(): Promise<Record<string, unknown>> {
  const configPath = getConfigPath();
  try {
    const file = Bun.file(configPath);
    const content = await file.text();
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveConfig(config: Record<string, unknown>): Promise<void> {
  const configPath = getConfigPath();
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}

function ensureMcpInConfig(config: Record<string, unknown>): void {
  if (!config.mcp || typeof config.mcp !== "object") {
    config.mcp = { servers: {} };
  }
  const mcp = config.mcp as Record<string, unknown>;
  if (!mcp.servers || typeof mcp.servers !== "object") {
    mcp.servers = {};
  }
}

export async function mcpListCommand(): Promise<void> {
  const configService = getConfigService();
  await configService.load();
  const mcpConfig = configService.getMCP();
  const servers = mcpConfig?.servers ?? {};

  console.log("\n📋 MCP Servers\n");
  if (Object.keys(servers).length === 0) {
    console.log("   No MCP servers configured.");
    console.log("   Use 'ronin mcp discover' to see available servers.");
    console.log("   Use 'ronin mcp add <name> [options]' to add one.");
    return;
  }

  for (const [name, server] of Object.entries(servers)) {
    const s = server as MCPServerConfig;
    const status = s.enabled ? "enabled" : "disabled";
    const cmd = [s.command, ...(s.args ?? [])].join(" ");
    console.log(`   ${name}`);
    console.log(`      Status: ${status}`);
    console.log(`      Command: ${cmd}`);
    console.log("");
  }
}

export async function mcpDiscoverCommand(options?: { query?: string; forceRemote?: boolean }): Promise<void> {
  const query = options?.query?.trim() ?? "";
  console.log("\n📋 Known MCP Servers (add with: ronin mcp add <name> [options])\n");
  console.log("   Name          | Package                                 | Description");
  console.log("   --------------|-----------------------------------------|---------------------------");

  for (const [name, info] of Object.entries(KNOWN_SERVERS)) {
    const pkg = info.package.padEnd(39);
    const desc = info.description.substring(0, 26);
    console.log(`   ${name.padEnd(14)}| ${pkg} | ${desc}`);
  }

  console.log("\n   Examples:");
  console.log("     ronin mcp add filesystem --path /Users/me/Documents");
  console.log("     ronin mcp add github  # requires GITHUB_TOKEN in env");
  console.log("     ronin mcp add brave-search  # requires BRAVE_API_KEY in env");
  console.log("     ronin mcp add sqlite --path /path/to/db.sqlite");
  console.log("     ronin mcp add custom --command npx --args '[\"-y\",\"@org/my-server\"]'");

  const configService = getConfigService();
  await configService.load();
  const system = configService.getSystem();
  const includeRemote = options?.forceRemote ?? (system.includeRemoteSkillsOnDiscover !== false);
  const remoteProviders = includeRemote ? getRemoteMcpProviders(system) : [];
  if (remoteProviders.includes("playbooks.com")) {
    const remoteResults = await discoverPlaybooksMcp(query);
    if (remoteResults.length > 0) {
      console.log("\n🌐 Remote MCP (playbooks.com)\n");
      for (const item of remoteResults.slice(0, 20)) {
        console.log(`   ${item.name}`);
        console.log(`      Repo: ${item.repo}`);
        console.log(`      Source: ${item.source}`);
      }
      console.log("\n   Install hint:");
      console.log("     ronin mcp add custom --command npx --args '[\"-y\",\"<mcp-package>\"]'");
    }
  }
}

export async function mcpAddCommand(
  name: string,
  options: { path?: string; command?: string; args?: string }
): Promise<void> {
  const config = await loadFullConfig();
  ensureMcpInConfig(config);

  const mcp = config.mcp as Record<string, unknown>;
  const servers = mcp.servers as Record<string, MCPServerConfig>;

  const known = KNOWN_SERVERS[name];

  if (known) {
    if (name === "filesystem") {
      const defaultDirs = [
        join(homedir(), ".ronin"),
        join(homedir(), ".ronin", "logs"),
        process.cwd(),
      ];
      const dirs = options.path
        ? [options.path, ...defaultDirs]
        : defaultDirs;
      const uniqueDirs = Array.from(new Set(dirs));
      servers[name] = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", ...uniqueDirs],
        enabled: true,
      };
      console.log(`✅ Added filesystem server (paths: ${uniqueDirs.join(", ")})`);
    } else if (name === "github") {
      servers[name] = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : undefined,
        enabled: true,
      };
      console.log(`✅ Added github server (set GITHUB_TOKEN env for auth)`);
    } else if (name === "brave-search") {
      const configService = getConfigService();
      await configService.load();
      const braveConfig = configService.getBraveSearch();
      const apiKey = process.env.BRAVE_API_KEY || braveConfig?.apiKey;
      servers[name] = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-brave-search"],
        env: apiKey ? { BRAVE_API_KEY: apiKey } : undefined,
        enabled: true,
      };
      console.log(apiKey
        ? `✅ Added brave-search server (API key from config or env)`
        : `✅ Added brave-search server (set BRAVE_API_KEY env or ronin config --brave-api-key <key> for auth)`);
    } else if (name === "sqlite") {
      const dbPath = options.path ?? ":memory:";
      servers[name] = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sqlite", dbPath],
        enabled: true,
      };
      console.log(`✅ Added sqlite server (path: ${dbPath})`);
    } else if (name === "obsidian") {
      const apiKey = process.env.OBSIDIAN_API_KEY ?? "";
      const baseUrl = process.env.OBSIDIAN_BASE_URL ?? "http://127.0.0.1:27123";
      servers[name] = {
        command: "npx",
        args: ["-y", "obsidian-mcp-server"],
        env: {
          OBSIDIAN_API_KEY: apiKey,
          OBSIDIAN_BASE_URL: baseUrl,
          OBSIDIAN_VERIFY_SSL: "false",
        },
        enabled: true,
      };
      console.log(apiKey
        ? `✅ Added obsidian server (Local REST API at ${baseUrl})`
        : `✅ Added obsidian server (set OBSIDIAN_API_KEY and OBSIDIAN_BASE_URL in env or edit ~/.ronin/config.json)`);
    } else {
      console.error(`❌ Unknown known server: ${name}`);
      process.exit(1);
    }
  } else {
    const cmd = options.command ?? "npx";
    let args: string[];
    try {
      args = options.args ? JSON.parse(options.args) : ["-y", `@modelcontextprotocol/server-${name}`];
    } catch {
      console.error("❌ --args must be valid JSON array, e.g. [\"-y\",\"pkg\"]");
      process.exit(1);
    }
    servers[name] = {
      command: cmd,
      args,
      enabled: true,
    };
    console.log(`✅ Added custom server: ${name}`);
  }

  await saveConfig(config);
  console.log("\n💡 Restart Ronin (ronin start) to connect to the new server.");
}

export async function mcpEnableCommand(name: string): Promise<void> {
  const config = await loadFullConfig();
  ensureMcpInConfig(config);

  const servers = (config.mcp as Record<string, unknown>).servers as Record<string, MCPServerConfig>;
  if (!servers[name]) {
    console.error(`❌ Server '${name}' not found. Add it first with: ronin mcp add ${name}`);
    process.exit(1);
  }
  servers[name].enabled = true;
  await saveConfig(config);
  console.log(`✅ Enabled MCP server: ${name}`);
  console.log("💡 Restart Ronin to apply changes.");
}

export async function mcpDisableCommand(name: string): Promise<void> {
  const config = await loadFullConfig();
  ensureMcpInConfig(config);

  const servers = (config.mcp as Record<string, unknown>).servers as Record<string, MCPServerConfig>;
  if (!servers[name]) {
    console.error(`❌ Server '${name}' not found.`);
    process.exit(1);
  }
  servers[name].enabled = false;
  await saveConfig(config);
  console.log(`✅ Disabled MCP server: ${name}`);
  console.log("💡 Restart Ronin to apply changes.");
}

export async function mcpRemoveCommand(name: string): Promise<void> {
  const config = await loadFullConfig();
  ensureMcpInConfig(config);

  const servers = (config.mcp as Record<string, unknown>).servers as Record<string, MCPServerConfig>;
  if (!servers[name]) {
    console.error(`❌ Server '${name}' not found.`);
    process.exit(1);
  }
  delete servers[name];
  await saveConfig(config);
  console.log(`✅ Removed MCP server: ${name}`);
  console.log("💡 Restart Ronin to apply changes.");
}

export async function mcpStatusCommand(): Promise<void> {
  console.log("\n📋 MCP Status\n");
  console.log("   Connection status is shown when Ronin is running (ronin start).");
  console.log("   Configured servers are loaded at startup.");
  console.log("");
  const configService = getConfigService();
  await configService.load();
  const mcpConfig = configService.getMCP();
  const servers = mcpConfig?.servers ?? {};
  const enabled = Object.entries(servers).filter(([, s]) => (s as MCPServerConfig).enabled);
  console.log(`   Configured: ${Object.keys(servers).length} servers`);
  console.log(`   Enabled: ${enabled.length} servers`);
  if (enabled.length > 0) {
    console.log("");
    for (const [name] of enabled) {
      console.log(`   - ${name}`);
    }
  }
  console.log("");
}

export async function mcpCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      await mcpListCommand();
      break;
    case "discover":
      await mcpDiscoverCommand({
        query: rest.filter((a) => !a.startsWith("--")).join(" ").trim(),
        forceRemote: rest.includes("--remote") ? true : (rest.includes("--no-remote") ? false : undefined),
      });
      break;
    case "add": {
      const name = rest[0];
      if (!name) {
        console.error("❌ Server name required");
        console.log("Usage: ronin mcp add <name> [--path <path>] [--command <cmd>] [--args <json>]");
        process.exit(1);
      }
      const pathIdx = rest.indexOf("--path");
      const cmdIdx = rest.indexOf("--command");
      const argsIdx = rest.indexOf("--args");
      await mcpAddCommand(name, {
        path: pathIdx !== -1 ? rest[pathIdx + 1] : undefined,
        command: cmdIdx !== -1 ? rest[cmdIdx + 1] : undefined,
        args: argsIdx !== -1 ? rest[argsIdx + 1] : undefined,
      });
      break;
    }
    case "enable": {
      const name = rest[0];
      if (!name) {
        console.error("❌ Server name required");
        console.log("Usage: ronin mcp enable <name>");
        process.exit(1);
      }
      await mcpEnableCommand(name);
      break;
    }
    case "disable": {
      const name = rest[0];
      if (!name) {
        console.error("❌ Server name required");
        console.log("Usage: ronin mcp disable <name>");
        process.exit(1);
      }
      await mcpDisableCommand(name);
      break;
    }
    case "remove": {
      const name = rest[0];
      if (!name) {
        console.error("❌ Server name required");
        console.log("Usage: ronin mcp remove <name>");
        process.exit(1);
      }
      await mcpRemoveCommand(name);
      break;
    }
    case "status":
      await mcpStatusCommand();
      break;
    default:
      if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
        console.log(`
📋 MCP Commands

Usage: ronin mcp <command> [options]

Commands:
  list                  List configured servers with status (enabled/disabled)
  discover [query]      Show built-in known servers; includes remote playbooks MCP listings when enabled
  add <name> [options]  Add server from known list or custom
  enable <name>         Set enabled: true
  disable <name>        Set enabled: false
  remove <name>         Remove server from config
  status                Show configured and enabled server counts

Add options (for known servers):
  --path <path>        Path for filesystem or sqlite

Add options (for custom):
  --command <cmd>      Command to run (default: npx)
  --args '<json>'      JSON array of args, e.g. '["-y","@org/my-server"]'

Examples:
  ronin mcp discover
  ronin mcp discover github --remote
  ronin mcp add filesystem --path /Users/me/Documents
  ronin mcp add github
  ronin mcp add custom --command npx --args '["-y","@org/my-mcp-server"]'
  ronin mcp list
  ronin mcp disable filesystem
  ronin mcp enable filesystem
  ronin mcp remove filesystem
`);
      } else {
        console.error(`❌ Unknown mcp command: ${sub}`);
        console.log("Use 'ronin mcp help' for usage.");
        process.exit(1);
      }
  }
}
