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

export { install, uninstall, getStatus, verify } from "./installers/mac.js";
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

export type { MenubarState, MenubarCallbacks, MenubarEventEmitter, MenubarRoute } from "./menubar.js";
