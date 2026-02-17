import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { stat } from "fs/promises";
import { extname, basename } from "path";
import {
  setEventEmitter,
  setCallbacks,
  updateMenubarState,
  emitMenubarEvent,
} from "@ronin/os/index.js";
import type { MenubarState } from "@ronin/os/index.js";

// Define missing types locally to avoid import issues
type MenubarCallbacks = {
  onToggleDesktop?: (enabled: boolean) => void;
  onToggleOffline?: (enabled: boolean) => void;
  onToggleClipboard?: (enabled: boolean) => void;
  onSwitchAIProvider?: (provider: "local" | "grok" | "gemini") => void;
  onOpenDashboard?: () => void;
  onViewRecentFiles?: () => void;
  onViewRecentTexts?: () => void;
  onQuit?: () => void;
};

/**
 * OS Event Types
 */
export interface OSEvent {
  id: string;
  timestamp: number;
  source: string;
  platform: "mac" | "linux" | "windows";
  type: string;
  payload: any;
}

export interface FileSelectedEvent extends OSEvent {
  type: "os.file.selected";
  payload: {
    path: string;
    multi: boolean;
    paths?: string[];
  };
}

export interface TextSelectedEvent extends OSEvent {
  type: "os.text.selected";
  payload: {
    text: string;
    app?: string;
    context?: string;
  };
}

export interface ClipboardChangedEvent extends OSEvent {
  type: "os.clipboard.changed";
  payload: {
    text?: string;
    image?: boolean;
    timestamp: number;
  };
}

export interface ShortcutTriggeredEvent extends OSEvent {
  type: "os.shortcut.triggered";
  payload: {
    name: string;
    modifier?: string;
  };
}

export interface NotificationClickedEvent extends OSEvent {
  type: "os.notification.clicked";
  payload: {
    id: string;
    action: string;
    metadata?: any;
  };
}

/**
 * Normalized Event Types (what we emit to other agents)
 */
export interface FileReceivedEvent {
  path: string;
  filename: string;
  extension: string;
  size: number;
  modified: Date;
  source: string;
  metadata: {
    type: string;
    isText: boolean;
    isImage: boolean;
    isCode: boolean;
  };
}

export interface TextCapturedEvent {
  text: string;
  length: number;
  source: string;
  context?: string;
  timestamp: number;
}

/**
 * OSBridgeAgent
 * 
 * The normalization layer between OS-level events and Ronin-native events.
 * Transforms platform-specific events into standardized Ronin events.
 * 
 * Features:
 * - Event normalization (os.file.selected → file.received)
 * - Metadata enrichment (file type, size, source app)
 * - Recent OS interactions memory
 * - HTTP endpoint for external OS events
 * - Menubar status indicator
 */
export default class OSBridgeAgent extends BaseAgent {
  static webhook = "/api/os-bridge";
  
  private recentFiles: FileReceivedEvent[] = [];
  private recentTexts: TextCapturedEvent[] = [];
  private clipboardEnabled = false;
  private desktopModeEnabled = false;
  private readonly MAX_RECENT_ITEMS = 50;

  constructor(api: AgentAPI) {
    super(api);
    console.log("[os-bridge] OSBridge Agent initialized");
  }

  /**
   * Agent lifecycle - called when agent is mounted
   */
  async onMount(): Promise<void> {
    // Check if Desktop Mode is enabled
    const config = this.api.config.getAll();
    this.desktopModeEnabled = config.desktop?.enabled || false;

    if (!this.desktopModeEnabled) {
      console.log("[os-bridge] Desktop Mode disabled, agent inactive");
      return;
    }

    console.log("[os-bridge] Desktop Mode enabled, activating...");

    // Register OS event listeners
    this.registerOSEventListeners();

    // Start clipboard watcher if explicitly enabled
    if (config.desktop?.features?.clipboard) {
      this.startClipboardWatcher();
    }

    // Register routes for OS events
    this.registerRoutes();

    // Setup menubar event handlers
    this.setupMenubarHandlers();

    console.log("[os-bridge] OSBridge active and listening");
  }

  /**
   * Setup menubar event handlers and callbacks
   */
  private setupMenubarHandlers(): void {
    // Set up event emitter that forwards to Ronin event system
    setEventEmitter({
      emit: (event: string, data: any) => {
        // Emit to Ronin event system
        this.api.events.emit(`menubar.${event}`, data, "os-bridge");

        // Log to console
        console.log(`[menubar] Event: ${event}`, data);
      },
    });

    // Set up callbacks for menubar actions
    setCallbacks({
      onToggleDesktop: (enabled: boolean) => {
        this.api.config.set("desktop.enabled", enabled);
        this.notify({
          title: "Desktop Mode",
          message: enabled ? "Enabled" : "Disabled",
        });
      },

      onToggleOffline: (enabled: boolean) => {
        // Store offline mode preference
        this.api.memory.store("menubar.offlineMode", enabled);
        this.notify({
          title: "Offline Mode",
          message: enabled ? "Using local AI only" : "Cloud AI available",
        });
      },

      onToggleClipboard: (enabled: boolean) => {
        this.api.config.set("desktop.features.clipboard", enabled);
        if (enabled) {
          this.startClipboardWatcher();
        } else {
          this.clipboardEnabled = false;
        }
        this.notify({
          title: "Clipboard",
          message: enabled ? "Monitoring enabled" : "Monitoring disabled",
        });
      },

      onSwitchAIProvider: (provider: "local" | "grok" | "gemini") => {
        this.api.config.set("defaultCLI", provider === "local" ? "qwen" : provider);
        this.notify({
          title: "AI Provider",
          message: `Switched to ${provider}`,
        });
      },

      onViewRecentFiles: () => {
        const files = this.getRecentFiles();
        console.log("[menubar] Recent files:", files);
        // Could open a window or show in notification
        this.notify({
          title: "Recent Files",
          message: `${files.length} files captured`,
        });
      },

      onViewRecentTexts: () => {
        const texts = this.getRecentTexts();
        console.log("[menubar] Recent texts:", texts);
        this.notify({
          title: "Recent Texts",
          message: `${texts.length} texts captured`,
        });
      },

      onOpenDashboard: () => {
        console.log("[menubar] Opening dashboard");
      },

      onQuit: () => {
        console.log("[menubar] Menubar quit");
        this.notify({
          title: "Ronin Desktop",
          message: "Menubar stopped",
        });
      },
    });
  }

  /**
   * Register listeners for OS-level events
   */
  private registerOSEventListeners(): void {
    // File selected from macOS Quick Action or other sources
    this.api.events.on("os.file.selected", async (data: unknown) => {
      const event = data as FileSelectedEvent;
      await this.handleFileSelected(event);
    }, "os-bridge");

    // Text selected from OS
    this.api.events.on("os.text.selected", async (data: unknown) => {
      const event = data as TextSelectedEvent;
      await this.handleTextSelected(event);
    }, "os-bridge");

    // Clipboard changed
    this.api.events.on("os.clipboard.changed", async (data: unknown) => {
      const event = data as ClipboardChangedEvent;
      await this.handleClipboardChanged(event);
    }, "os-bridge");

    // Shortcut triggered
    this.api.events.on("os.shortcut.triggered", async (data: unknown) => {
      const event = data as ShortcutTriggeredEvent;
      await this.handleShortcutTriggered(event);
    }, "os-bridge");

    // Notification clicked
    this.api.events.on("os.notification.clicked", async (data: unknown) => {
      const event = data as NotificationClickedEvent;
      await this.handleNotificationClicked(event);
    }, "os-bridge");

    console.log("[os-bridge] OS event listeners registered");
  }

  /**
   * Handle file selection from OS
   */
  private async handleFileSelected(event: FileSelectedEvent): Promise<void> {
    console.log(`[os-bridge] File selected: ${event.payload.path}`);

    try {
      // Get file metadata
      const fileStats = await stat(event.payload.path);
      const normalizedEvent = await this.normalizeFileEvent(
        event.payload.path,
        event.source
      );

      // Store in recent files
      this.addToRecentFiles(normalizedEvent);

      // Emit normalized event
      this.api.events.emit("file.received", {
        ...normalizedEvent,
        originalEvent: event,
      }, "os-bridge");

      // Also emit type-specific event
      if (normalizedEvent.metadata.isImage) {
        this.api.events.emit("image.received", normalizedEvent, "os-bridge");
      } else if (normalizedEvent.metadata.isCode) {
        this.api.events.emit("code.file.received", normalizedEvent, "os-bridge");
      }

      console.log(`[os-bridge] Normalized and emitted: file.received`);
    } catch (error) {
      console.error("[os-bridge] Error handling file selection:", error);
    }
  }

  /**
   * Normalize a file event with enriched metadata
   */
  private async normalizeFileEvent(
    filePath: string,
    source: string
  ): Promise<FileReceivedEvent> {
    const stats = await stat(filePath);
    const extension = extname(filePath).toLowerCase();
    const filename = basename(filePath);

    // Determine file type
    const type = this.detectFileType(extension);
    
    return {
      path: filePath,
      filename,
      extension,
      size: stats.size,
      modified: stats.mtime,
      source,
      metadata: {
        type,
        isText: this.isTextFile(extension),
        isImage: this.isImageFile(extension),
        isCode: this.isCodeFile(extension),
      },
    };
  }

  /**
   * Detect file type from extension
   */
  private detectFileType(extension: string): string {
    const typeMap: Record<string, string> = {
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".js": "application/javascript",
      ".ts": "application/typescript",
      ".py": "text/x-python",
      ".html": "text/html",
      ".css": "text/css",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    return typeMap[extension] || "application/octet-stream";
  }

  /**
   * Check if file is a text file
   */
  private isTextFile(extension: string): boolean {
    const textExtensions = [
      ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx",
      ".py", ".rb", ".php", ".java", ".cpp", ".c", ".h",
      ".html", ".css", ".scss", ".sass", ".less",
      ".xml", ".yaml", ".yml", ".toml", ".ini",
      ".sh", ".bash", ".zsh", ".fish",
      ".rs", ".go", ".swift", ".kt", ".scala",
    ];
    return textExtensions.includes(extension.toLowerCase());
  }

  /**
   * Check if file is an image
   */
  private isImageFile(extension: string): boolean {
    const imageExtensions = [
      ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg",
      ".webp", ".ico", ".tiff", ".tif", ".raw", ".heic",
    ];
    return imageExtensions.includes(extension.toLowerCase());
  }

  /**
   * Check if file is code
   */
  private isCodeFile(extension: string): boolean {
    const codeExtensions = [
      ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".php",
      ".java", ".cpp", ".c", ".h", ".hpp", ".cs", ".swift",
      ".go", ".rs", ".kt", ".scala", ".r", ".m", ".mm",
      ".sql", ".sh", ".bash", ".zsh", ".ps1", ".pl", ".lua",
    ];
    return codeExtensions.includes(extension.toLowerCase());
  }

  /**
   * Handle text selection from OS
   */
  private async handleTextSelected(event: TextSelectedEvent): Promise<void> {
    console.log(`[os-bridge] Text selected (${event.payload.text.length} chars)`);

    const normalizedEvent: TextCapturedEvent = {
      text: event.payload.text,
      length: event.payload.text.length,
      source: event.source,
      context: event.payload.context,
      timestamp: Date.now(),
    };

    // Store in recent texts
    this.addToRecentTexts(normalizedEvent);

    // Emit normalized event
    this.api.events.emit("text.captured", {
      ...normalizedEvent,
      originalEvent: event,
    }, "os-bridge");

    console.log("[os-bridge] Normalized and emitted: text.captured");
  }

  /**
   * Handle clipboard changes
   */
  private async handleClipboardChanged(event: ClipboardChangedEvent): Promise<void> {
    if (!this.clipboardEnabled) {
      return;
    }

    console.log("[os-bridge] Clipboard changed");

    // Emit normalized event
    this.api.events.emit("clipboard.updated", {
      ...event.payload,
      originalEvent: event,
    }, "os-bridge");
  }

  /**
   * Handle shortcut triggers
   */
  private async handleShortcutTriggered(event: ShortcutTriggeredEvent): Promise<void> {
    console.log(`[os-bridge] Shortcut triggered: ${event.payload.name}`);

    // Emit normalized event
    this.api.events.emit("shortcut.executed", {
      name: event.payload.name,
      modifier: event.payload.modifier,
      timestamp: Date.now(),
      originalEvent: event,
    }, "os-bridge");
  }

  /**
   * Handle notification clicks
   */
  private async handleNotificationClicked(event: NotificationClickedEvent): Promise<void> {
    console.log(`[os-bridge] Notification clicked: ${event.payload.id}`);

    // Emit normalized event
    this.api.events.emit("notification.action", {
      id: event.payload.id,
      action: event.payload.action,
      metadata: event.payload.metadata,
      timestamp: Date.now(),
      originalEvent: event,
    }, "os-bridge");
  }

  /**
   * Start clipboard watcher
   */
  private startClipboardWatcher(): void {
    this.clipboardEnabled = true;
    console.log("[os-bridge] Clipboard watcher started (explicit opt-in)");
    // Actual clipboard watching implementation would go here
    // This would use platform-specific APIs (NSEventMonitor on macOS, etc.)
  }

  /**
   * Register HTTP routes for receiving OS events
   */
  private registerRoutes(): void {
    // Route to receive events from OS integrations
    this.api.http.registerRoute("/api/os-bridge/events", async (req) => {
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      try {
        const body = await req.json();
        const { event, data } = body;

        if (!event) {
          return Response.json({ error: "Event type required" }, { status: 400 });
        }

        // Validate and emit the OS event
        this.api.events.emit(event, {
          ...data,
          timestamp: Date.now(),
          source: "os.external",
          platform: "mac", // Would detect from user-agent or config
        }, "os-bridge");

        return Response.json({ success: true, event });
      } catch (error) {
        console.error("[os-bridge] Error handling OS event:", error);
        return Response.json({ error: "Invalid event data" }, { status: 400 });
      }
    });

    // Route to get recent OS interactions
    this.api.http.registerRoute("/api/os-bridge/recent", async (req) => {
      if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }

      const type = new URL(req.url).searchParams.get("type");
      
      if (type === "files") {
        return Response.json(this.recentFiles);
      } else if (type === "texts") {
        return Response.json(this.recentTexts);
      }

      return Response.json({
        files: this.recentFiles,
        texts: this.recentTexts,
      });
    });

    // Route to get OSBridge status
    this.api.http.registerRoute("/api/os-bridge/status", async (req) => {
      if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }

      return Response.json({
        enabled: this.desktopModeEnabled,
        clipboard: this.clipboardEnabled,
        recentFiles: this.recentFiles.length,
        recentTexts: this.recentTexts.length,
        platform: "mac",
      });
    });

    console.log("[os-bridge] HTTP routes registered");
  }

  /**
   * Add file to recent files list
   */
  private addToRecentFiles(file: FileReceivedEvent): void {
    this.recentFiles.unshift(file);
    if (this.recentFiles.length > this.MAX_RECENT_ITEMS) {
      this.recentFiles.pop();
    }
  }

  /**
   * Add text to recent texts list
   */
  private addToRecentTexts(text: TextCapturedEvent): void {
    this.recentTexts.unshift(text);
    if (this.recentTexts.length > this.MAX_RECENT_ITEMS) {
      this.recentTexts.pop();
    }
  }

  /**
   * Send native macOS notification
   */
  async notify(options: {
    title: string;
    message: string;
    subtitle?: string;
    sound?: boolean;
    actions?: string[];
  }): Promise<void> {
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const execAsync = promisify(exec);

    // Build AppleScript for notification
    let script = `display notification "${options.message}" with title "${options.title}"`;
    
    if (options.subtitle) {
      script += ` subtitle "${options.subtitle}"`;
    }
    
    if (options.sound) {
      script += ` sound name "default"`;
    }

    try {
      await execAsync(`osascript -e '${script}'`);
      console.log(`[os-bridge] Notification sent: ${options.title}`);
    } catch (error) {
      console.error("[os-bridge] Failed to send notification:", error);
    }
  }

  /**
   * Get recent OS interactions
   */
  getRecentFiles(): FileReceivedEvent[] {
    return [...this.recentFiles];
  }

  getRecentTexts(): TextCapturedEvent[] {
    return [...this.recentTexts];
  }

  /**
   * Scheduled execution - for maintenance
   */
  async execute(): Promise<void> {
    // Cleanup old items periodically
    if (this.recentFiles.length > this.MAX_RECENT_ITEMS) {
      this.recentFiles = this.recentFiles.slice(0, this.MAX_RECENT_ITEMS);
    }
    if (this.recentTexts.length > this.MAX_RECENT_ITEMS) {
      this.recentTexts = this.recentTexts.slice(0, this.MAX_RECENT_ITEMS);
    }
  }
}
