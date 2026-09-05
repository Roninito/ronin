import type { DutyConstructor, DutyMetadata } from "../types/duty.js";
import type { DutyAPI } from "../types/api.js";
import { logger } from "../utils/logger.js";
import { readdir } from "fs/promises";
import { join, extname } from "path";

export interface LoadDutyOptions {
  dutyDir?: string;
  api: DutyAPI;
}

/**
 * Discovers and loads duty files from a directory
 */
export class DutyLoader {
  private dutyDir: string;
  private externalDutyDir: string | null;

  constructor(dutyDir: string = "./duties", externalDutyDir?: string | null) {
    this.dutyDir = dutyDir;
    // Allow override via argument, fallback to environment variable
    this.externalDutyDir = externalDutyDir ?? process.env.RONIN_EXTERNAL_DUTY_DIR ?? null;
  }

  /**
   * Discover all duty files in the duty directory (recursively)
   * Also checks external duty directory if RONIN_EXTERNAL_DUTY_DIR is set
   */
  async discoverDuties(): Promise<string[]> {
    const files: string[] = [];
    
    // Discover duties in local directory
    await this.discoverRecursive(this.dutyDir, files);
    
    // Discover duties in external directory if set
    if (this.externalDutyDir && this.externalDutyDir !== this.dutyDir) {
      try {
        await this.discoverRecursive(this.externalDutyDir, files);
      } catch (error) {
        // External directory might not exist, that's okay
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.warn("Could not read external duty directory", { dir: this.externalDutyDir, error });
        }
      }
    }
    
    return files.filter(file => !file.includes(".test.") && !file.includes(".spec."));
  }

  /**
   * Recursively discover files in a directory
   */
  private async discoverRecursive(dir: string, files: string[]): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await this.discoverRecursive(fullPath, files);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (ext === ".ts" || ext === ".js") {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Directory might not exist, ignore
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn("Error reading directory", { dir, error });
      }
    }
  }

  /**
   * Load a single duty file
   */
  async loadDuty(filePath: string, api: DutyAPI): Promise<DutyMetadata | null> {
    try {
      // Dynamic import of the duty file
      const module = await import(filePath);
      
      // Get the default export (should be the duty class)
      const DutyClass = module.default;
      
      if (!DutyClass) {
        logger.warn("No default export in duty file", { filePath });
        return null;
      }

      // Validate it's a constructor function
      if (typeof DutyClass !== "function") {
        logger.warn("Default export is not a constructor", { filePath });
        return null;
      }

      // Check if it has the required execute method (will be checked when instantiated)
      const dutyConstructor = DutyClass as DutyConstructor;
      
      // Extract duty name from file path
      const name = this.extractDutyName(filePath);
      
      // Instantiate the duty
      const instance = new dutyConstructor(api);

      // Validate instance has execute method
      if (typeof instance.execute !== "function") {
        // Only warn if the duty has no other hooks — duties that rely purely on
        // routes, events, or webhooks registered in the constructor are valid.
        const hasWebhook = typeof dutyConstructor.webhook === "string";
        const hasSchedule = typeof dutyConstructor.schedule === "string";
        const hasWatch = Array.isArray(dutyConstructor.watch) && dutyConstructor.watch.length > 0;
        const hasOnWebhook = typeof (instance as any).onWebhook === "function";
        const hasOnFileChange = typeof (instance as any).onFileChange === "function";
        if (!hasWebhook && !hasSchedule && !hasWatch && !hasOnWebhook && !hasOnFileChange) {
          logger.warn("Duty missing execute method", { duty: name });
        }
        return null;
      }

      return {
        name,
        filePath,
        schedule: dutyConstructor.schedule,
        watch: dutyConstructor.watch,
        webhook: dutyConstructor.webhook,
        events: dutyConstructor.events,
        beams: dutyConstructor.beams,
        queries: dutyConstructor.queries,
        instance,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack?.split("\n").slice(0, 4).join(" | ") : undefined;
      logger.error("Failed to load duty", { filePath, error: msg, stack });
      return null;
    }
  }

  /**
   * Load all duties from the duty directory
   */
  async loadAllDuties(api: DutyAPI): Promise<DutyMetadata[]> {
    const files = await this.discoverDuties();
    const duties: DutyMetadata[] = [];

    for (const file of files) {
      const duty = await this.loadDuty(file, api);
      if (duty) {
        duties.push(duty);
      }
    }

    return duties;
  }

  /**
   * Extract duty name from file path
   */
  private extractDutyName(filePath: string): string {
    const basename = filePath.split("/").pop() || filePath;
    return basename.replace(/\.(ts|js)$/, "");
  }
}

// Backward compatibility aliases
export { DutyLoader as AgentLoader };
export type { LoadDutyOptions as LoadAgentOptions };

