/**
 * Linux Desktop Mode Installer
 * 
 * Creates and manages Linux integrations:
 * - XDG autostart (.desktop files)
 * - Application menu entry
 * - System tray using systray2
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";

interface LinuxInstallerOptions {
  bridgePort?: number;
  startTray?: boolean;
}

interface InstallationStatus {
  autostartEnabled: boolean;
  menuEntryInstalled: boolean;
  bridgePort: number;
}

const DEFAULT_PORT = 17341;
const AUTOSTART_DIR = join(homedir(), ".config", "autostart");
const APP_DIR = join(homedir(), ".local", "share", "applications");
const ICON_DIR = join(homedir(), ".local", "share", "icons", "hicolor", "48x48", "apps");

/**
 * Check if running on Linux
 */
function isLinux(): boolean {
  return platform() === "linux";
}

/**
 * Generate .desktop file content
 */
function generateDesktopFile(roninPath: string, iconPath: string, autostart: boolean): string {
  return `[Desktop Entry]
Type=Application
Name=Ronin
GenericName=AI Agent System
Comment=AI-powered automation and agent system
Exec=${roninPath} start${autostart ? " --desktop" : ""}
Icon=${iconPath}
Terminal=false
Categories=System;Utility;
Keywords=ai;agent;automation;desktop;
X-GNOME-Autostart-enabled=true
X-GNOME-UsesNotifications=true
StartupNotify=true
StartupWMClass=Ronin
OnlyShowIn=GNOME;KDE;XFCE;Unity;MATE;Cinnamon;LXDE;
`;
}

/**
 * Create directories if they don't exist
 */
function ensureDirectories(): void {
  if (!existsSync(AUTOSTART_DIR)) {
    mkdirSync(AUTOSTART_DIR, { recursive: true });
  }
  if (!existsSync(APP_DIR)) {
    mkdirSync(APP_DIR, { recursive: true });
  }
  if (!existsSync(ICON_DIR)) {
    mkdirSync(ICON_DIR, { recursive: true });
  }
}

/**
 * Create a simple placeholder icon (lime green circle with "R")
 */
function createPlaceholderIcon(iconPath: string): void {
  // Create a simple SVG
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#84cc16;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#65a30d;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="8" fill="url(#grad)"/>
  <text x="24" y="34" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#0a0a0a" text-anchor="middle">R</text>
</svg>`;

  // Save SVG for now, user can replace with proper icon
  const svgPath = iconPath.replace('.png', '.svg');
  writeFileSync(svgPath, svg);
  console.log(`  Created icon: ${svgPath}`);
  console.log(`  (You can convert this to PNG using: convert ${svgPath} ${iconPath})`);
}

/**
 * Install Linux Desktop Mode
 */
export function install(options: LinuxInstallerOptions = {}): boolean {
  if (!isLinux()) {
    console.error("This installer is for Linux only");
    return false;
  }

  const port = options.bridgePort || DEFAULT_PORT;
  const roninPath = process.execPath;

  console.log("🐧 Installing Ronin Desktop Mode for Linux...\n");

  try {
    ensureDirectories();

    // 1. Create icon
    const iconPath = join(ICON_DIR, "ronin.png");
    console.log("  Creating icon...");
    createPlaceholderIcon(iconPath);

    // 2. Create application menu entry
    console.log("  Creating application menu entry...");
    const appDesktopPath = join(APP_DIR, "ronin.desktop");
    const appDesktop = generateDesktopFile(roninPath, iconPath, false);
    writeFileSync(appDesktopPath, appDesktop);
    console.log(`    ${appDesktopPath}`);

    // 3. Create autostart entry
    console.log("  Creating autostart entry...");
    const autostartDesktopPath = join(AUTOSTART_DIR, "ronin.desktop");
    const autostartDesktop = generateDesktopFile(roninPath, iconPath, true);
    writeFileSync(autostartDesktopPath, autostartDesktop);
    console.log(`    ${autostartDesktopPath}`);

    // 4. Update desktop database
    try {
      execSync("update-desktop-database ~/.local/share/applications", { stdio: "pipe" });
      console.log("  Updated application menu database");
    } catch {
      console.log("  (Menu database update skipped - may need manual refresh)");
    }

    console.log("\n✅ Installation complete!");
    console.log("\n📋 What was installed:");
    console.log("   • Application menu entry in GNOME/Unity/KDE");
    console.log("   • Autostart: Ronin will start with your desktop session");
    console.log(`   • Bridge Port: ${port} (for OS communications)`);
    console.log("   • Icon: ~/.local/share/icons/hicolor/48x48/apps/ronin.svg");

    console.log("\n🔧 Next steps:");
    console.log("   1. Enable Desktop Mode: ronin config set desktop.enabled true");
    console.log("   2. Start Ronin: ronin start");
    console.log("   3. Or click Ronin in your application menu");

    console.log("\n💡 Desktop Environment:");
    console.log("   • GNOME: Activities → Ronin");
    console.log("   • KDE: Applications Menu → System → Ronin");
    console.log("   • Ubuntu: Show Applications → Ronin");

    return true;
  } catch (error) {
    console.error("\n❌ Installation failed:", error);
    return false;
  }
}

/**
 * Uninstall Linux Desktop Mode
 */
export function uninstall(): boolean {
  if (!isLinux()) {
    console.error("This uninstaller is for Linux only");
    return false;
  }

  console.log("Uninstalling Ronin Desktop Mode...\n");

  try {
    // Remove autostart entry
    const autostartPath = join(AUTOSTART_DIR, "ronin.desktop");
    if (existsSync(autostartPath)) {
      console.log("  Removing autostart entry...");
      unlinkSync(autostartPath);
    }

    // Remove application menu entry
    const appPath = join(APP_DIR, "ronin.desktop");
    if (existsSync(appPath)) {
      console.log("  Removing application menu entry...");
      unlinkSync(appPath);
    }

    // Remove icon
    const iconPath = join(ICON_DIR, "ronin.svg");
    if (existsSync(iconPath)) {
      console.log("  Removing icon...");
      unlinkSync(iconPath);
    }

    // Update desktop database
    try {
      execSync("update-desktop-database ~/.local/share/applications", { stdio: "pipe" });
    } catch {
      // Ignore errors
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
  const autostartPath = join(AUTOSTART_DIR, "ronin.desktop");
  const appPath = join(APP_DIR, "ronin.desktop");

  return {
    autostartEnabled: existsSync(autostartPath),
    menuEntryInstalled: existsSync(appPath),
    bridgePort: DEFAULT_PORT,
  };
}

/**
 * Verify installation is working
 */
export function verify(): boolean {
  if (!isLinux()) {
    console.error("This verifier is for Linux only");
    return false;
  }

  console.log("🔍 Verifying Ronin Desktop Mode installation...\n");

  const status = getStatus();
  let allGood = true;

  // Check autostart
  if (status.autostartEnabled) {
    console.log("  ✅ Autostart entry exists");
  } else {
    console.log("  ❌ Autostart entry not found");
    allGood = false;
  }

  // Check menu entry
  if (status.menuEntryInstalled) {
    console.log("  ✅ Application menu entry exists");
  } else {
    console.log("  ❌ Application menu entry not found");
    allGood = false;
  }

  // Check Ronin CLI
  try {
    execSync("which ronin", { stdio: "pipe" });
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
export function reinstall(options: LinuxInstallerOptions = {}): boolean {
  console.log("🔄 Reinstalling Ronin Desktop Mode...\n");

  if (uninstall()) {
    return install(options);
  }

  return false;
}
