import type { DutyAPI } from "./api.js";

/**
 * Base Duty interface that all duties must implement
 */
export interface Duty {
  /**
   * Main execution method called when duty is triggered
   */
  execute(): Promise<void>;

  /**
   * Optional: Called when a watched file changes
   */
  onFileChange?(path: string, event: "create" | "update" | "delete"): Promise<void>;

  /**
   * Optional: Called when a webhook is received
   */
  onWebhook?(payload: unknown): Promise<void>;
}

/**
 * Duty class constructor type
 */
export interface DutyConstructor {
  new (api: DutyAPI): Duty;
  
  /**
   * Optional: Human-readable description of what the duty does
   */
  description?: string;
  
  /**
   * Optional: Cron schedule expression, for example one that runs every 6 hours.
   */
  schedule?: string;
  
  /**
   * Optional: File patterns to watch, for example log files or JSON data files.
   */
  watch?: string[];
  
  /**
   * Optional: HTTP webhook path (e.g., "/webhook/my-duty")
   */
  webhook?: string;
}

/**
 * Metadata about a loaded duty
 */
export interface DutyMetadata {
  name: string;
  filePath: string;
  description?: string;
  schedule?: string;
  watch?: string[];
  webhook?: string;
  instance: Duty;
}
