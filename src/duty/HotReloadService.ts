import { watch } from "fs";
import { join, dirname, basename, extname } from "path";
import { existsSync } from "fs";
import type { DutyRegistry } from "./DutyRegistry.js";
import type { DutyAPI } from "../types/api.js";
import { logger } from "../utils/logger.js";

interface HotReloadOptions {
  dutiesDir: string;
  externalDutiesDir: string;
  registry: DutyRegistry;
  api: DutyAPI;
}

interface ReloadResult {
  success: boolean;
  dutyName?: string;
  error?: string;
  routes?: string[];
  schedules?: string[];
  stable?: boolean;
}

/**
 * Hot Reload Service
 * 
 * Watches duty directories for new/changed files and loads them
 * without restarting the entire Ronin system.
 */
export class HotReloadService {
  private dutiesDir: string;
  private externalDutiesDir: string;
  private registry: DutyRegistry;
  private api: DutyAPI;
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();
  private loadedDuties: Map<string, string> = new Map(); // filePath -> dutyName
  private stabilityCheckDuration = 10000; // 10 seconds

  constructor(options: HotReloadOptions) {
    this.dutiesDir = options.dutiesDir;
    this.externalDutiesDir = options.externalDutiesDir;
    this.registry = options.registry;
    this.api = options.api;
  }

  /**
   * Start watching duty directories
   */
  start(): void {
    logger.debug("Hot reload starting file watchers");
    
    // Watch built-in duties directory
    if (existsSync(this.dutiesDir)) {
      this.watchDirectory(this.dutiesDir);
    }
    
    // Watch external duties directory
    if (existsSync(this.externalDutiesDir)) {
      this.watchDirectory(this.externalDutiesDir);
    }
  }

  /**
   * Stop all watchers
   */
  stop(): void {
    logger.debug("Hot reload stopping file watchers");
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      logger.debug("Hot reload stopped watching", { path });
    }
    this.watchers.clear();
  }

  /**
   * Watch a directory for changes (recursive when supported so schedule-manager and nested duties reload).
   */
  private watchDirectory(dir: string): void {
    const onEvent = (eventType: string, filename: string | null) => {
      if (!filename) return;
      if (!filename.endsWith(".ts")) return;
      const filePath = join(dir, filename);
      setTimeout(() => this.handleFileChange(filePath, eventType), 100);
    };

    let watcher: ReturnType<typeof watch>;
    try {
      watcher = watch(dir, { recursive: true }, onEvent);
      logger.debug("Hot reload watching directory", { dir, recursive: true });
    } catch {
      watcher = watch(dir, { recursive: false }, onEvent);
      logger.debug("Hot reload watching directory", { dir, recursive: false });
    }
    this.watchers.set(dir, watcher);
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(filePath: string, eventType: string): Promise<void> {
    if (eventType === 'rename' || eventType === 'change') {
      if (!existsSync(filePath)) {
        // File deleted - ignore for now (could add unload later)
        return;
      }

      // Check if already loaded (reload) or new
      const isReload = this.loadedDuties.has(filePath);
      
      if (isReload) {
        logger.debug("Hot reload detected change", { file: basename(filePath) });
      } else {
        logger.debug("Hot reload detected new duty", { file: basename(filePath) });
      }

      // Load the duty
      const result = await this.loadDuty(filePath);
      
      if (result.success) {
        // Emit event for other duties to track
        this.api.events.emit(isReload ? 'duty_reloaded' : 'duty_created', {
          dutyName: result.dutyName,
          filePath,
          routes: result.routes,
          schedules: result.schedules,
          stable: result.stable,
          timestamp: Date.now(),
        }, 'hot-reload');
      }
    }
  }

  /**
   * Load a duty from file
   */
  async loadDuty(filePath: string): Promise<ReloadResult> {
    try {
      // Check file exists
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      // Import the duty module
      const module = await import(filePath + '?t=' + Date.now()); // Cache bust
      const DutyClass = module.default;

      if (!DutyClass) {
        return { success: false, error: `No default export found in ${filePath}` };
      }

      // Use same name as DutyLoader (file basename without extension) so we replace the
      // existing registry entry instead of creating a duplicate with the class name (e.g. NOAANewsDuty).
      const base = basename(filePath);
      const dutyName = base.replace(/\.(ts|js)$/, "");

      // Check if duty is already registered (same key as initial load from loader)
      const existingDuty = this.registry.get(dutyName);
      if (existingDuty) {
        logger.debug("Hot reload reloading duty", { duty: dutyName });
        // Unload existing first
        this.registry.unregister(dutyName);
      }

      // Instantiate the duty
      const dutyInstance = new DutyClass(this.api);

      // Extract metadata (include filePath so registry.getDuties() has it for schedule manager etc.)
      const metadata = {
        name: dutyName,
        filePath,
        description: DutyClass.description || `${dutyName} duty`,
        schedule: DutyClass.schedule,
        watch: DutyClass.watch,
        webhook: DutyClass.webhook,
        events: DutyClass.events,
        beams: DutyClass.beams,
        queries: DutyClass.queries,
        instance: dutyInstance,
      };

      // Register with the registry
      this.registry.register(metadata);
      this.loadedDuties.set(filePath, dutyName);

      // Collect info about what was registered
      const routes: string[] = [];
      const schedules: string[] = [];

      if (metadata.webhook) {
        routes.push(metadata.webhook);
      }
      
      // Check for HTTP routes registered by the duty
      if (dutyInstance.routes) {
        routes.push(...dutyInstance.routes);
      }

      if (metadata.schedule) {
        schedules.push(metadata.schedule);
      }

      logger.info("Hot reload loaded duty", { duty: dutyName, routes, schedules });

      // Run stability observation in background so we return immediately (registry is already updated)
      this.observeStability(dutyName, dutyInstance).then((isStable) => {
        if (!isStable) {
          logger.warn("Hot reload duty had errors during observation", { duty: dutyName });
        }
      });

      return {
        success: true,
        dutyName,
        routes,
        schedules,
        stable: true,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Hot reload failed to load duty", { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Observe duty for stability
   */
  private async observeStability(dutyName: string, dutyInstance: any): Promise<boolean> {
    logger.debug("Hot reload observing duty stability", { duty: dutyName, durationMs: this.stabilityCheckDuration });
    
    return new Promise((resolve) => {
      let errors = 0;
      let errorHandler: (err: Error) => void;

      // Track errors during observation period
      errorHandler = (err: Error) => {
        errors++;
        logger.error("Hot reload observed error during stability check", { duty: dutyName, error: err.message });
      };

      // Listen for errors if duty has error event
      if (dutyInstance.on) {
        dutyInstance.on('error', errorHandler);
      }

      // Wait for observation period
      setTimeout(() => {
        // Cleanup
        if (dutyInstance.off) {
          dutyInstance.off('error', errorHandler);
        }

        const isStable = errors === 0;
        if (isStable) {
          logger.debug("Hot reload duty stable", { duty: dutyName });
        } else {
          logger.warn("Hot reload duty had errors during observation", { duty: dutyName, errors });
        }
        
        resolve(isStable);
      }, this.stabilityCheckDuration);
    });
  }

  /**
   * Get list of loaded duties
   */
  getLoadedDuties(): Array<{ filePath: string; dutyName: string }> {
    return Array.from(this.loadedDuties.entries()).map(([filePath, dutyName]) => ({
      filePath,
      dutyName,
    }));
  }

  /**
   * Check if duty is loaded from specific file
   */
  isLoaded(filePath: string): boolean {
    return this.loadedDuties.has(filePath);
  }
}
