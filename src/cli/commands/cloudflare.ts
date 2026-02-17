/**
 * Cloudflare CLI Commands
 * Subcommands: login, logout, status, route (init|add|remove|list|validate),
 * tunnel (create|start|stop|delete|list|temp), pages deploy, security audit
 */

import { join } from "path";
import { createAPI } from "../../api/index.js";
import { loadConfig, ensureDefaultUserPluginDir } from "./config.js";

export interface CloudflareCommandOptions {
  pluginDir?: string;
  userPluginDir?: string;
}

function printCloudflareHelp(): void {
  console.log(`
Usage: ronin cloudflare <subcommand> [options]

Auth:
  login                    Authenticate with Cloudflare (opens browser)
  logout                   Log out and clear local tunnel state
  status                   Show auth, policy, and tunnel status

Route policy (required before creating tunnels):
  route init               Create default policy at ~/.ronin/cloudflare.routes.json
  route add <path>          Whitelist a path (e.g. /dashboard)
  route remove <path>       Remove a path from whitelist
  route list                List allowed routes
  route validate            Validate policy file

Tunnels:
  tunnel create <name>     Create a named tunnel
  tunnel start <name>      Start a tunnel
  tunnel stop <name>       Stop a tunnel
  tunnel delete <name>     Delete a tunnel
  tunnel list              List tunnels in state
  tunnel temp [ttl]        Create temporary tunnel (ttl in seconds, default 3600)

Other:
  pages deploy <dir> <project>   Deploy directory to Cloudflare Pages
  security audit                 Print security summary (auth, tunnels, policy, blocked)
  audit                          Alias for security audit

Examples:
  ronin cloudflare login
  ronin cloudflare route init
  ronin cloudflare route add /api/status
  ronin cloudflare tunnel create my-tunnel
  ronin cloudflare tunnel temp 3600
`);
}

export async function cloudflareCommand(
  args: string[],
  options: CloudflareCommandOptions = {}
): Promise<void> {
  const action = args[0];
  if (!action || action === "--help" || action === "-h") {
    printCloudflareHelp();
    return;
  }

  const config = await loadConfig();
  const pluginDir =
    options.pluginDir ||
    config.pluginDir ||
    join(process.env.RONIN_PROJECT_ROOT || process.cwd(), "plugins");
  const userPluginDir =
    options.userPluginDir || config.userPluginDir || ensureDefaultUserPluginDir();

  const api = await createAPI({
    pluginDir,
    userPluginDir
  });

  if (!api.plugins.has("cloudflare")) {
    console.error("❌ Cloudflare plugin not found. Ensure plugins/cloudflare exists and is loadable.");
    process.exit(1);
  }

  const call = api.plugins.call.bind(api.plugins);

  try {
    switch (action) {
      case "login":
        await call("cloudflare", "login");
        break;
      case "logout":
        await call("cloudflare", "logout");
        break;
      case "status":
        await call("cloudflare", "status");
        break;
      case "route": {
        const sub = args[1];
        if (sub === "init") {
          await call("cloudflare", "routeInit");
        } else if (sub === "add") {
          const path = args[2];
          if (!path) {
            console.error("❌ Path required. Usage: ronin cloudflare route add <path>");
            process.exit(1);
          }
          await call("cloudflare", "routeAdd", path);
        } else if (sub === "remove") {
          const path = args[2];
          if (!path) {
            console.error("❌ Path required. Usage: ronin cloudflare route remove <path>");
            process.exit(1);
          }
          await call("cloudflare", "routeRemove", path);
        } else if (sub === "list") {
          await call("cloudflare", "routeList");
        } else if (sub === "validate") {
          await call("cloudflare", "routeValidate");
        } else {
          console.error("❌ Unknown route subcommand:", sub);
          console.log("Available: init, add, remove, list, validate");
          process.exit(1);
        }
        break;
      }
      case "tunnel": {
        const sub = args[1];
        if (sub === "create") {
          const name = args[2];
          if (!name) {
            console.error("❌ Name required. Usage: ronin cloudflare tunnel create <name>");
            process.exit(1);
          }
          await call("cloudflare", "tunnelCreate", name);
        } else if (sub === "start") {
          const name = args[2];
          if (!name) {
            console.error("❌ Name required. Usage: ronin cloudflare tunnel start <name>");
            process.exit(1);
          }
          await call("cloudflare", "tunnelStart", name);
        } else if (sub === "stop") {
          const name = args[2];
          if (!name) {
            console.error("❌ Name required. Usage: ronin cloudflare tunnel stop <name>");
            process.exit(1);
          }
          await call("cloudflare", "tunnelStop", name);
        } else if (sub === "delete") {
          const name = args[2];
          if (!name) {
            console.error("❌ Name required. Usage: ronin cloudflare tunnel delete <name>");
            process.exit(1);
          }
          await call("cloudflare", "tunnelDelete", name);
        } else if (sub === "list") {
          await call("cloudflare", "tunnelList");
        } else if (sub === "temp") {
          const ttlArg = args[2];
          const ttl = ttlArg != null ? parseInt(ttlArg, 10) : undefined;
          if (ttlArg != null && (isNaN(ttl!) || ttl! <= 0)) {
            console.error("❌ TTL must be a positive number (seconds)");
            process.exit(1);
          }
          await call("cloudflare", "tunnelTemp", ttl);
        } else {
          console.error("❌ Unknown tunnel subcommand:", sub);
          console.log("Available: create, start, stop, delete, list, temp");
          process.exit(1);
        }
        break;
      }
      case "pages": {
        if (args[1] !== "deploy") {
          console.error("❌ Usage: ronin cloudflare pages deploy <directory> <project>");
          process.exit(1);
        }
        const directory = args[2];
        const project = args[3];
        if (!directory || !project) {
          console.error("❌ Directory and project required. Usage: ronin cloudflare pages deploy <dir> <project>");
          process.exit(1);
        }
        await call("cloudflare", "pagesDeploy", directory, project);
        break;
      }
      case "security":
        if (args[1] === "audit") {
          await call("cloudflare", "securityAudit");
        } else {
          console.error("❌ Usage: ronin cloudflare security audit");
          process.exit(1);
        }
        break;
      case "audit":
        await call("cloudflare", "securityAudit");
        break;
      default:
        console.error("❌ Unknown subcommand:", action);
        printCloudflareHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error("Cloudflare command failed:", err);
    process.exit(1);
  }
}
