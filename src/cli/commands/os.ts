/**
 * OS (Desktop Mode) CLI Commands
 * 
 * Commands:
 * - ronin os install mac       Install macOS integrations
 * - ronin os uninstall mac     Remove macOS integrations
 * - ronin os status            Show installation status
 * - ronin os verify            Verify installation
 * - ronin os clipboard enable  Enable clipboard watching
 * - ronin os clipboard disable Disable clipboard watching
 */

import { install, uninstall, getStatus, verify } from "../../os/installers/mac.js";

interface OSCommandOptions {
  bridgePort?: number;
  shortcutKey?: string;
  folders?: string[];
}

/**
 * Main OS command handler
 */
export async function handleOSCommand(
  action: string,
  subAction?: string,
  options: OSCommandOptions = {}
): Promise<void> {
  switch (action) {
    case "install":
      if (subAction === "mac" || subAction === "macos") {
        await installMacOS(options);
      } else {
        console.log("Usage: ronin os install mac");
        console.log("\nInstalls macOS Desktop Mode integrations:");
        console.log("  • Quick Action: Right-click → Services → Send to Ronin");
        console.log("  • LaunchAgent: Auto-starts Ronin with macOS");
        console.log("\nOptions:");
        console.log("  --bridge-port PORT    Set bridge port (default: 17341)");
        console.log("  --folders PATHS       Watch folders (comma-separated)");
      }
      break;
      
    case "uninstall":
      if (subAction === "mac" || subAction === "macos") {
        await uninstallMacOS();
      } else {
        console.log("Usage: ronin os uninstall mac");
        console.log("\nRemoves all macOS Desktop Mode integrations.");
      }
      break;
      
    case "status":
      await showStatus();
      break;
      
    case "verify":
      await verifyInstallation();
      break;
      
    case "clipboard":
      if (subAction === "enable") {
        await setClipboardEnabled(true);
      } else if (subAction === "disable") {
        await setClipboardEnabled(false);
      } else {
        console.log("Usage: ronin os clipboard [enable|disable]");
        console.log("\nEnable or disable clipboard watching.");
        console.log("⚠️  Clipboard watching requires explicit user consent.");
      }
      break;
      
    default:
      showHelp();
  }
}

/**
 * Install macOS Desktop Mode
 */
async function installMacOS(options: OSCommandOptions): Promise<void> {
  console.log("\n🖥️  Ronin Desktop Mode for macOS\n");
  
  // Parse folders option
  const folders = options.folders && options.folders.length > 0
    ? options.folders[0].split(",").map(f => f.trim())
    : undefined;
  
  const installOptions = {
    bridgePort: options.bridgePort,
    folders,
  };
  
  const success = install(installOptions);
  
  if (success) {
    console.log("\n💡 Tip: You can customize Desktop Mode settings in your config:");
    console.log("   ronin config set desktop.enabled true");
    console.log("   ronin config set desktop.features.notifications true");
    console.log("   ronin config set desktop.features.clipboard false");
  }
  
  process.exit(success ? 0 : 1);
}

/**
 * Uninstall macOS Desktop Mode
 */
async function uninstallMacOS(): Promise<void> {
  const success = uninstall();
  process.exit(success ? 0 : 1);
}

/**
 * Show installation status
 */
async function showStatus(): Promise<void> {
  console.log("\n📊 Ronin Desktop Mode Status\n");
  
  const status = getStatus();
  
  console.log("macOS Integration:");
  console.log(`  Quick Action:     ${status.quickActionInstalled ? "✅ Installed" : "❌ Not installed"}`);
  console.log(`  LaunchAgent:      ${status.launchAgentInstalled ? "✅ Installed" : "❌ Not installed"}`);
  console.log(`  Bridge Port:      ${status.bridgePort}`);
  
  if (status.quickActionInstalled && status.launchAgentInstalled) {
    console.log("\n✅ Desktop Mode is fully installed!");
    console.log("\nTo enable:");
    console.log("  ronin config set desktop.enabled true");
    console.log("  ronin start");
  } else if (status.quickActionInstalled || status.launchAgentInstalled) {
    console.log("\n⚠️  Desktop Mode partially installed.");
    console.log("Run: ronin os verify");
  } else {
    console.log("\n❌ Desktop Mode not installed.");
    console.log("Run: ronin os install mac");
  }
  
  console.log("\n💡 Quick test:");
  console.log("  Right-click any file → Services → Send to Ronin");
}

/**
 * Verify installation
 */
async function verifyInstallation(): Promise<void> {
  const success = verify();
  process.exit(success ? 0 : 1);
}

/**
 * Enable/disable clipboard watching
 */
async function setClipboardEnabled(enabled: boolean): Promise<void> {
  // This would need to integrate with ConfigService
  // For now, just show the config command
  console.log(`\n${enabled ? "✅" : "❌"} Clipboard watching ${enabled ? "enabled" : "disabled"}`);
  console.log("\nConfig updated. Restart Ronin for changes to take effect:");
  console.log("  ronin restart");
  
  // Actually update config
  try {
    const { ConfigService } = await import("../../config/index.js");
    const config = new ConfigService();
    await config.set("desktop.features.clipboard", enabled);
    console.log("\nConfig saved successfully.");
  } catch (error) {
    console.error("\n⚠️  Could not update config automatically.");
    console.log("   Please run manually:");
    console.log(`   ronin config set desktop.features.clipboard ${enabled}`);
  }
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
🖥️  Ronin Desktop Mode Commands

Usage: ronin os <command> [options]

Commands:
  install mac              Install macOS Desktop Mode
    Options:
      --bridge-port PORT   Set bridge port (default: 17341)
      --folders PATHS      Comma-separated list of folders to watch
      
  uninstall mac            Remove macOS Desktop Mode
  
  status                   Show installation status
  
  verify                   Verify installation is working
  
  clipboard enable         Enable clipboard watching (explicit opt-in)
  clipboard disable        Disable clipboard watching

Examples:
  ronin os install mac
  ronin os install mac --bridge-port 8080
  ronin os install mac --folders "~/Desktop,~/Downloads,~/Documents"
  ronin os status
  ronin os verify
  ronin os clipboard enable
`);
}

/**
 * Parse command line arguments
 */
export function parseOSArgs(args: string[]): {
  action: string;
  subAction?: string;
  options: OSCommandOptions;
} {
  const options: OSCommandOptions = {
    folders: [],
  };
  
  let action = "";
  let subAction: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--bridge-port" || arg === "-p") {
      options.bridgePort = parseInt(args[++i], 10);
    } else if (arg === "--folders" || arg === "-f") {
      options.folders = [args[++i]];
    } else if (!action) {
      action = arg;
    } else if (!subAction) {
      subAction = arg;
    }
  }
  
  return { action, subAction, options };
}
