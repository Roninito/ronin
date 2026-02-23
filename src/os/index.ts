/**
 * Ronin OS Integration Module
 * 
 * Provides Desktop Mode functionality for seamless OS integration:
 * - macOS Quick Actions
 * - LaunchAgent management
 * - Menubar status indicator
 * - Clipboard watching (opt-in)
 * - File watching
 */

export { install as installMac, uninstall as uninstallMac, getStatus as getMacStatus, verify as verifyMac } from "./installers/mac.js";
export { install as installWindows, uninstall as uninstallWindows, getStatus as getWindowsStatus, verify as verifyWindows } from "./installers/win.js";
export { install as installLinux, uninstall as uninstallLinux, getStatus as getLinuxStatus, verify as verifyLinux } from "./installers/linux.js";
export {
  startMenubar,
  stopMenubar,
  isMenubarRunning,
  showNotification,
  showMenu,
  updateMenubarState,
  setEventEmitter,
  setCallbacks,
  emitMenubarEvent,
  discoverRoutes,
} from "./menubar.js";
export {
  startTray,
  stopTray,
  isTrayRunning,
  updateMenuItem,
  refreshMenu,
  updateTrayIcon,
  updateTrayTitle,
  showTrayNotification,
  setTrayEventEmitter,
  setTrayCallbacks,
} from "./tray.js";

export type { MenubarState, MenubarCallbacks, MenubarEventEmitter, MenubarRoute } from "./menubar.js";
export type { TrayState, TrayCallbacks, TrayEventEmitter, TrayRoute } from "./tray.js";
