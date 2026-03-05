import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export interface ClientCommandOptions {
  subcommand?: string;
  url?: string;
  port?: number;
  skipHealthCheck?: boolean;
  platform?: "mac" | "win" | "linux" | "all";
  dryRun?: boolean;
}

function resolveClientDir(): string {
  const projectRoot = process.env.RONIN_PROJECT_ROOT || join(import.meta.dir, "../../..");
  return join(projectRoot, "desktop", "electrobun");
}

export async function clientCommand(options: ClientCommandOptions = {}): Promise<void> {
  const clientDir = resolveClientDir();

  if (!existsSync(join(clientDir, "package.json"))) {
    console.error("❌ ElectronBun client files not found.");
    console.error(`   Expected: ${clientDir}`);
    process.exit(1);
  }

  const subcommand = options.subcommand || "start";
  const platform = options.platform || "all";

  if (subcommand === "install") {
    const installResult = spawnSync("bun", ["install"], {
      cwd: clientDir,
      stdio: "inherit",
      env: process.env,
    });
    if (installResult.status !== 0) process.exit(installResult.status ?? 1);
    return;
  }

  if (subcommand === "build") {
    if (options.dryRun) {
      console.log(`Would build ElectronBun client for platform: ${platform}`);
      return;
    }

    const installResult = spawnSync("bun", ["install"], {
      cwd: clientDir,
      stdio: "inherit",
      env: process.env,
    });
    if (installResult.status !== 0) process.exit(installResult.status ?? 1);

    const script = platform === "all" ? "dist:all" : `dist:${platform}`;
    const buildResult = spawnSync("bun", ["run", script], {
      cwd: clientDir,
      stdio: "inherit",
      env: process.env,
    });
    if (buildResult.status !== 0) process.exit(buildResult.status ?? 1);
    return;
  }

  const port = options.port ?? 3000;
  const url = options.url || `http://127.0.0.1:${port}/`;
  const env = {
    ...process.env,
    RONIN_CLIENT_URL: url,
    RONIN_CLIENT_PORT: String(port),
    RONIN_CLIENT_SKIP_HEALTH_CHECK: options.skipHealthCheck ? "1" : "0",
  };

  const runResult = spawnSync("bunx", ["--bun", "electron", "."], {
    cwd: clientDir,
    stdio: "inherit",
    env,
  });

  if (runResult.error) {
    const fallback = spawnSync("bun", ["x", "electron", "."], {
      cwd: clientDir,
      stdio: "inherit",
      env,
    });

    if (fallback.error || fallback.status !== 0) {
      console.error("\n❌ Failed to start ElectronBun client.");
      console.error("   Try: cd desktop/electrobun && bun install");
      process.exit(fallback.status ?? 1);
    }

    return;
  }

  if (runResult.status !== 0) {
    process.exit(runResult.status);
  }
}
