import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, cpSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { RONIN_VERSION, getLatestVersion, isUpdateAvailable } from "../../utils/version.js";

interface UpdateOptions {
  check?: boolean;
  rollback?: boolean;
  quiet?: boolean;
}

const logger = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
  warn: (msg: string) => console.log(`⚠️  ${msg}`),
  error: (msg: string) => console.log(`❌ ${msg}`),
};

function getBackupDir(): string {
  const backupRoot = join(homedir(), ".ronin", "backups");
  mkdirSync(backupRoot, { recursive: true });
  return backupRoot;
}

function createBackup(roninDir: string): string {
  const backupRoot = getBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const backupPath = join(backupRoot, `pre-update-${timestamp}`);

  logger.info("Creating backup...");
  mkdirSync(backupPath, { recursive: true });

  // Copy everything except node_modules and .git
  const ignorePatterns = ["node_modules", ".git", "dist", ".ronin/cache"];

  for (const file of readdirSync(roninDir)) {
    if (!ignorePatterns.includes(file)) {
      const src = join(roninDir, file);
      const dst = join(backupPath, file);
      try {
        cpSync(src, dst, { recursive: true });
      } catch (e) {
        logger.warn(`Could not backup ${file}`);
      }
    }
  }

  logger.success(`Backup created: ${backupPath}`);
  return backupPath;
}

function cleanOldBackups(): void {
  const backupRoot = getBackupDir();
  if (!existsSync(backupRoot)) return;

  const backups = readdirSync(backupRoot).sort().reverse();
  if (backups.length > 5) {
    for (const old of backups.slice(5)) {
      rmSync(join(backupRoot, old), { recursive: true, force: true });
    }
  }
}

function performGitPull(): boolean {
  try {
    logger.info("Pulling latest code...");
    execSync("git pull origin main", { stdio: "inherit" });
    return true;
  } catch (e) {
    logger.error("Failed to pull code. Check git status.");
    return false;
  }
}

function reinstallDependencies(): void {
  try {
    logger.info("Installing dependencies...");
    execSync("bun install", { stdio: "inherit" });
    logger.success("Dependencies installed");
  } catch (e) {
    logger.warn("Failed to install dependencies. Try running 'bun install' manually.");
  }
}

function updateRoninTray(): void {
  const trayPath = resolve(import.meta.dir, "../../..", "RoninTray.app", "Contents", "MacOS", "RoninTray");
  if (existsSync(trayPath)) {
    try {
      logger.info("Updating RoninTray...");
      const result = spawnSync("bash", ["build-and-deploy.sh"], {
        cwd: resolve(import.meta.dir, "../../..", "RoninTray-Swift"),
        timeout: 120000, // 2 minutes
      });
      if (result.status === 0) {
        logger.success("RoninTray updated");
      } else {
        logger.warn("RoninTray update failed (optional)");
      }
    } catch {
      logger.warn("Could not update RoninTray");
    }
  }
}

function clearCaches(): void {
  const cacheDir = join(homedir(), ".ronin", "cache");
  if (existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
      mkdirSync(cacheDir, { recursive: true });
    } catch {
      // Silent fail
    }
  }
}

function rollbackUpdate(): void {
  const backupRoot = getBackupDir();
  if (!existsSync(backupRoot)) {
    logger.error("No backups found to rollback");
    return;
  }

  const backups = readdirSync(backupRoot).sort().reverse();
  if (backups.length === 0) {
    logger.error("No backups found to rollback");
    return;
  }

  const latestBackup = backups[0];
  const backupPath = join(backupRoot, latestBackup);
  const roninDir = resolve(import.meta.dir, "../../..");

  logger.warn(`Rolling back to ${latestBackup}...`);

  try {
    // Remove current files except node_modules
    for (const file of readdirSync(roninDir)) {
      if (file !== "node_modules" && file !== ".git") {
        const path = join(roninDir, file);
        rmSync(path, { recursive: true, force: true });
      }
    }

    // Copy backup back
    for (const file of readdirSync(backupPath)) {
      cpSync(join(backupPath, file), join(roninDir, file), { recursive: true });
    }

    // Reinstall deps to match backup state
    execSync("bun install", { stdio: "inherit" });
    logger.success("Rollback complete");
  } catch (e) {
    logger.error("Rollback failed. Check git status and try manually restoring.");
  }
}

export async function handleUpdateCommand(options: UpdateOptions = {}): Promise<void> {
  const roninDir = resolve(import.meta.dir, "../../..");

  if (options.rollback) {
    rollbackUpdate();
    return;
  }

  // Check for updates
  logger.info(`Current version: v${RONIN_VERSION}`);

  const latest = await getLatestVersion();
  if (!latest) {
    logger.error("Could not check for updates (network issue)");
    return;
  }

  logger.info(`Latest version: v${latest}`);

  if (!isUpdateAvailable(RONIN_VERSION, latest)) {
    logger.success("Already on latest version");
    return;
  }

  if (options.check) {
    logger.info(`Update available: v${RONIN_VERSION} → v${latest}`);
    return;
  }

  logger.info("Starting update...\n");

  // Create backup
  createBackup(roninDir);

  // Pull latest code
  if (!performGitPull()) {
    logger.error("Update failed at git pull");
    return;
  }

  // Reinstall dependencies
  reinstallDependencies();

  // Update RoninTray if available
  updateRoninTray();

  // Clear caches
  clearCaches();

  // Clean old backups
  cleanOldBackups();

  logger.success(`\nUpdate complete! Ronin v${RONIN_VERSION} → v${latest}`);
  logger.info("Restart Ronin to use the new version: bun run ronin start");
}
