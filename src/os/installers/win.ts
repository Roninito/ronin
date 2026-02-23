/**
 * Windows Desktop Mode Installer
 * 
 * Creates and manages Windows integrations:
 * - Registry autostart (HKCU Run key)
 */

import { execSync } from "child_process";
import { platform } from "os";

interface WindowsInstallerOptions {
  bridgePort?: number;
}

interface InstallationStatus {
  autostartEnabled: boolean;
  bridgePort: number;
}

const REG_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const DEFAULT_PORT = 17341;

/**
 * Check if running on Windows
 */
function isWindows(): boolean {
  return platform() === "win32";
}

/**
 * Enable autostart via registry HKCU Run key
 */
function enableAutostart(name: string, executablePath: string): boolean {
  try {
    execSync(
      `reg add "${REG_RUN_KEY}" /v "${name}" /t REG_SZ /d "${executablePath}" /f`,
      { stdio: "pipe" }
    );
    return true;
  } catch (error) {
    console.error("Failed to enable autostart:", error);
    return false;
  }
}

/**
 * Disable autostart by removing registry entry
 */
function disableAutostart(name: string): boolean {
  try {
    execSync(`reg delete "${REG_RUN_KEY}" /v "${name}" /f`, { stdio: "pipe" });
    return true;
  } catch {
    // Key may not exist, that's ok
    return true;
  }
}

/**
 * Check if autostart is enabled
 */
function isAutostartEnabled(name: string): boolean {
  try {
    execSync(`reg query "${REG_RUN_KEY}" /v "${name}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Windows Desktop Mode
 */
export function install(options: WindowsInstallerOptions = {}): boolean {
  if (!isWindows()) {
    console.error("This installer is for Windows only");
    return false;
  }

  const port = options.bridgePort || DEFAULT_PORT;
  const roninPath = process.execPath;

  console.log("Installing Ronin Desktop Mode for Windows...\n");

  try {
    // Enable autostart
    console.log("  Enabling autostart...");
    if (!enableAutostart("Ronin", roninPath)) {
      console.error("\nFailed to enable autostart");
      return false;
    }

    console.log("\n✅ Installation complete!");
    console.log("\n📋 What was installed:");
    console.log("   • Autostart: Ronin will start with Windows");
    console.log(`   • Bridge Port: ${port} (for OS communications)`);

    console.log("\n🔧 Next steps:");
    console.log("   1. Enable Desktop Mode: ronin config set desktop.enabled true");
    console.log("   2. Start Ronin: ronin start");

    return true;
  } catch (error) {
    console.error("\n❌ Installation failed:", error);
    return false;
  }
}

/**
 * Uninstall Windows Desktop Mode
 */
export function uninstall(): boolean {
  if (!isWindows()) {
    console.error("This uninstaller is for Windows only");
    return false;
  }

  console.log("Uninstalling Ronin Desktop Mode...\n");

  try {
    // Disable autostart
    console.log("  Disabling autostart...");
    if (isAutostartEnabled("Ronin")) {
      if (!disableAutostart("Ronin")) {
        console.error("  ⚠️  Failed to disable autostart");
      } else {
        console.log("  ✅ Autostart disabled");
      }
    } else {
      console.log("  ℹ️  Autostart not enabled");
    }

    console.log("\n✅ Uninstallation complete!");
    return true;
  } catch (error) {
    console.error("\n❌ Uninstallation failed:", error);
    return false;
  }
}

/**
 * Get installation status
 */
export function getStatus(): InstallationStatus {
  const autostartEnabled = isWindows() ? isAutostartEnabled("Ronin") : false;

  return {
    autostartEnabled,
    bridgePort: DEFAULT_PORT,
  };
}

/**
 * Verify installation is working
 */
export function verify(): boolean {
  if (!isWindows()) {
    console.error("This verifier is for Windows only");
    return false;
  }

  console.log("Verifying Ronin Desktop Mode installation...\n");

  const status = getStatus();
  let allGood = true;

  // Check autostart
  if (status.autostartEnabled) {
    console.log("  ✅ Autostart enabled");
  } else {
    console.log("  ❌ Autostart not enabled");
    allGood = false;
  }

  // Check Ronin CLI
  try {
    execSync("where ronin", { stdio: "pipe" });
    console.log("  ✅ Ronin CLI found in PATH");
  } catch {
    console.log("  ❌ Ronin CLI not found in PATH");
    allGood = false;
  }

  console.log("\n" + (allGood ? "✅ All checks passed!" : "⚠️  Some issues found"));

  return allGood;
}

/**
 * Reinstall (uninstall then install)
 */
export function reinstall(options: WindowsInstallerOptions = {}): boolean {
  console.log("Reinstalling Ronin Desktop Mode...\n");

  if (uninstall()) {
    return install(options);
  }

  return false;
}
