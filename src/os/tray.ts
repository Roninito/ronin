/**
 * Ronin System Tray
 *
 * Cross-platform system tray using systray2.
 * Supports Windows, macOS, and Linux (GNOME/KDE/XFCE).
 *
 * Features:
 * - Menu items: Dashboard, Status, Toggles, Routes, Quit
 * - Dynamic menu updates
 * - Event emission for state changes
 * - Auto-start with Ronin when --desktop flag is used
 */

import SysTray from "systray2";
import { readFileSync } from "fs";
import { join } from "path";
import { platform, homedir } from "os";
import { execSync } from "child_process";

export interface TrayEventEmitter {
  emit(event: string, data: any): void;
}

export interface TrayRoute {
  path: string;
  title: string;
  icon?: string;
}

export interface TrayState {
  enabled: boolean;
  clipboardEnabled: boolean;
  offlineMode: boolean;
  aiProvider: "local" | "grok" | "gemini";
  recentFiles: number;
  recentTexts: number;
  osBridgeActive: boolean;
  lastSync?: Date;
  routes?: TrayRoute[];
}

export interface TrayCallbacks {
  onToggleDesktop?: (enabled: boolean) => void;
  onToggleOffline?: (enabled: boolean) => void;
  onToggleClipboard?: (enabled: boolean) => void;
  onSwitchAIProvider?: (provider: "local" | "grok" | "gemini") => void;
  onOpenDashboard?: () => void;
  onViewRecentFiles?: () => void;
  onViewRecentTexts?: () => void;
  onRouteSelected?: (route: TrayRoute) => void;
  onQuit?: () => void;
}

// Default event emitter (noop if not provided)
let eventEmitter: TrayEventEmitter = {
  emit: () => {},
};

// Default callbacks
let callbacks: TrayCallbacks = {};

// Tray instance
let trayInstance: SysTray | null = null;
let isRunning = false;

/**
 * Set the event emitter for tray events
 */
export function setTrayEventEmitter(emitter: TrayEventEmitter): void {
  eventEmitter = emitter;
}

/**
 * Set callbacks for tray actions
 */
export function setTrayCallbacks(cb: TrayCallbacks): void {
  callbacks = { ...callbacks, ...cb };
}

/**
 * Get icon path based on platform
 */
function getIconPath(): string {
  const baseDir = process.cwd();
  const iconPath = join(baseDir, "assets", "ronin.png");
  
  // On macOS, look for embedded icon
  if (platform() === "darwin") {
    const macIconPath = join(homedir(), ".ronin", "ronin.png");
    if (require("fs").existsSync(macIconPath)) {
      return macIconPath;
    }
  }
  
  // On Linux, look in standard location
  if (platform() === "linux") {
    const linuxIconPath = join(homedir(), ".local", "share", "icons", "hicolor", "48x48", "apps", "ronin.png");
    if (require("fs").existsSync(linuxIconPath)) {
      return linuxIconPath;
    }
  }
  
  return iconPath;
}

/**
 * Load icon as base64
 */
function loadIcon(): string {
  try {
    const iconPath = getIconPath();
    return readFileSync(iconPath).toString("base64");
  } catch {
    // Fallback: create a simple colored circle
    return createFallbackIcon();
  }
}

/**
 * Create a fallback colored icon (lime green circle)
 */
function createFallbackIcon(): string {
  // Simple 16x16 PNG in base64 (lime green circle)
  // This is a minimal PNG with a green circle
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="#84cc16" stroke="#0a0a0a" stroke-width="1"/>
  </svg>`;
  
  // For now, return a transparent 1x1 PNG
  // In production, you should have an actual icon file
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

/**
 * Generate menu items based on state and routes
 */
function generateMenuItems(
  state: TrayState,
  routes: TrayRoute[] = []
): Array<any> {
  const items: Array<any> = [
    {
      title: "Open Dashboard",
      tooltip: "Open web dashboard",
      enabled: true,
      seq_id: 0,
    },
    {
      title: SysTray.separator,
      enabled: false,
      seq_id: -1,
    },
    {
      title: `Status: ${state.osBridgeActive ? "🟢 Active" : "🔴 Inactive"}`,
      tooltip: "Current bridge status",
      enabled: false,
      seq_id: 1,
    },
    {
      title: SysTray.separator,
      enabled: false,
      seq_id: -1,
    },
    {
      title: "Desktop Mode",
      tooltip: "Toggle desktop mode",
      checked: state.enabled,
      enabled: true,
      seq_id: 2,
    },
    {
      title: "Offline Mode",
      tooltip: "Use local AI only",
      checked: state.offlineMode,
      enabled: true,
      seq_id: 3,
    },
    {
      title: "Clipboard Watch",
      tooltip: "Monitor clipboard",
      checked: state.clipboardEnabled,
      enabled: true,
      seq_id: 4,
    },
    {
      title: SysTray.separator,
      enabled: false,
      seq_id: -1,
    },
  ];

  // Add routes submenu if available
  if (routes.length > 0) {
    items.push({
      title: "Routes ▶",
      tooltip: "Available routes",
      enabled: true,
      seq_id: 5,
      items: routes.map((route, idx) => ({
        title: route.title,
        tooltip: route.path,
        enabled: true,
        seq_id: 100 + idx,
      })),
    });
    items.push({
      title: SysTray.separator,
      enabled: false,
      seq_id: -1,
    });
  }

  // Recent files/texts
  items.push(
    {
      title: `Recent Files (${state.recentFiles})`,
      tooltip: "View recent files",
      enabled: state.recentFiles > 0,
      seq_id: 6,
    },
    {
      title: `Recent Texts (${state.recentTexts})`,
      tooltip: "View recent clipboard texts",
      enabled: state.recentTexts > 0,
      seq_id: 7,
    },
    {
      title: SysTray.separator,
      enabled: false,
      seq_id: -1,
    },
    {
      title: "Quit",
      tooltip: "Exit Ronin",
      enabled: true,
      seq_id: 99,
    }
  );

  return items;
}

/**
 * Start the system tray
 */
export function startTray(
  port: number = 17341,
  routes: TrayRoute[] = [],
  state: TrayState = {
    enabled: true,
    clipboardEnabled: false,
    offlineMode: false,
    aiProvider: "local",
    recentFiles: 0,
    recentTexts: 0,
    osBridgeActive: true,
  }
): boolean {
  if (isRunning) {
    console.log("[tray] System tray already running");
    return true;
  }

  try {
    const icon = loadIcon();
    const menuItems = generateMenuItems(state, routes);

    trayInstance = new SysTray({
      menu: {
        icon,
        title: "Ronin",
        tooltip: "Ronin Desktop Mode",
        items: menuItems,
      },
      debug: false,
      copyDir: true,
    });

    // Handle click events
    trayInstance.onClick((action) => {
      handleTrayClick(action, routes);
    });

    trayInstance.onReady(() => {
      console.log("[tray] System tray started");
      eventEmitter.emit("tray.started", { port, timestamp: Date.now() });
    });

    trayInstance.onExit((code, signal) => {
      console.log(`[tray] System tray exited: ${code}, ${signal}`);
      isRunning = false;
      eventEmitter.emit("tray.stopped", { code, signal, timestamp: Date.now() });
    });

    isRunning = true;
    return true;
  } catch (error) {
    console.error("[tray] Failed to start system tray:", error);
    eventEmitter.emit("tray.error", { error, timestamp: Date.now() });
    return false;
  }
}

/**
 * Handle tray menu click events
 */
function handleTrayClick(action: any, routes: TrayRoute[]): void {
  const seqId = action.seq_id;

  switch (seqId) {
    case 0:
      // Open Dashboard
      callbacks.onOpenDashboard?.();
      openDashboard();
      break;

    case 2:
      // Toggle Desktop Mode
      callbacks.onToggleDesktop?.(!action.item.checked);
      updateMenuItem(2, { checked: !action.item.checked });
      break;

    case 3:
      // Toggle Offline Mode
      callbacks.onToggleOffline?.(!action.item.checked);
      updateMenuItem(3, { checked: !action.item.checked });
      break;

    case 4:
      // Toggle Clipboard Watch
      callbacks.onToggleClipboard?.(!action.item.checked);
      updateMenuItem(4, { checked: !action.item.checked });
      break;

    case 6:
      // View Recent Files
      callbacks.onViewRecentFiles?.();
      break;

    case 7:
      // View Recent Texts
      callbacks.onViewRecentTexts?.();
      break;

    case 99:
      // Quit
      callbacks.onQuit?.();
      stopTray();
      process.exit(0);
      break;

    default:
      // Check if it's a route (seq_id >= 100)
      if (seqId >= 100) {
        const routeIndex = seqId - 100;
        if (routes[routeIndex]) {
          callbacks.onRouteSelected?.(routes[routeIndex]);
          openRoute(routes[routeIndex]);
        }
      }
      break;
  }
}

/**
 * Update a specific menu item
 */
export function updateMenuItem(
  seqId: number,
  updates: Partial<{ title?: string; checked?: boolean; enabled?: boolean }>
): void {
  if (!trayInstance) return;

  trayInstance.sendAction({
    type: "update-item",
    item: updates,
    seq_id: seqId,
  });
}

/**
 * Stop the system tray
 */
export function stopTray(): boolean {
  if (!isRunning || !trayInstance) {
    console.log("[tray] System tray not running");
    return true;
  }

  try {
    trayInstance.kill();
    isRunning = false;
    trayInstance = null;
    console.log("[tray] System tray stopped");
    return true;
  } catch (error) {
    console.error("[tray] Failed to stop system tray:", error);
    return false;
  }
}

/**
 * Check if tray is running
 */
export function isTrayRunning(): boolean {
  return isRunning;
}

/**
 * Open the dashboard in default browser
 */
function openDashboard(): void {
  const url = "http://localhost:17341";
  try {
    switch (platform()) {
      case "darwin":
        execSync(`open "${url}"`);
        break;
      case "win32":
        execSync(`start "${url}"`);
        break;
      case "linux":
        execSync(`xdg-open "${url}"`);
        break;
      default:
        console.log(`[tray] Dashboard available at: ${url}`);
    }
  } catch {
    console.log(`[tray] Dashboard available at: ${url}`);
  }
}

/**
 * Open a specific route in browser
 */
function openRoute(route: TrayRoute): void {
  const url = `http://localhost:17341${route.path}`;
  try {
    switch (platform()) {
      case "darwin":
        execSync(`open "${url}"`);
        break;
      case "win32":
        execSync(`start "${url}"`);
        break;
      case "linux":
        execSync(`xdg-open "${url}"`);
        break;
      default:
        console.log(`[tray] Route available at: ${url}`);
    }
  } catch {
    console.log(`[tray] Route available at: ${url}`);
  }
}

/**
 * Update the entire menu
 */
export function refreshMenu(
  state: TrayState,
  routes: TrayRoute[] = []
): void {
  if (!trayInstance) return;

  const menuItems = generateMenuItems(state, routes);
  
  // Rebuild the tray with new menu
  stopTray();
  startTray(state.osBridgeActive ? 17341 : 0, routes, state);
}

/**
 * Update tray icon
 */
export function updateTrayIcon(iconPath: string): void {
  if (!trayInstance) return;

  try {
    const icon = readFileSync(iconPath).toString("base64");
    trayInstance.sendAction({
      type: "update-menu",
      menu: { icon },
    });
  } catch (error) {
    console.error("[tray] Failed to update icon:", error);
  }
}

/**
 * Update tray title
 */
export function updateTrayTitle(title: string): void {
  if (!trayInstance) return;

  trayInstance.sendAction({
    type: "update-menu",
    menu: { title },
  });
}

/**
 * Show a notification (if supported)
 */
export function showTrayNotification(title: string, message: string): void {
  // systray2 doesn't have built-in notifications
  // On Linux, we could use notify-send
  if (platform() === "linux") {
    try {
      execSync(`notify-send "${title}" "${message}" --icon=ronin`);
    } catch {
      // Notification failed, ignore
    }
  }
  
  // Emit event for other handling
  eventEmitter.emit("tray.notification", { title, message, timestamp: Date.now() });
}
