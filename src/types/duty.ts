import type { DutyAPI } from "./api.js";

/**
 * Declared event topology — purely declarative, no runtime effect on its own.
 * A duty still calls this.api.events.emit/beam/query imperatively; this is
 * read by DutyLoader/HotReloadService so external tooling (e.g. a graph
 * introspection duty) doesn't have to re-derive it by scanning source.
 */
export interface DutyEventsDecl {
  in?: string[];
  out?: string[];
}

export interface DutyBeamDecl {
  target: string;
  eventType: string;
}

export interface DutyQueryOutDecl {
  target: string;
  queryType: string;
  timeoutMs?: number;
}

export interface DutyQueriesDecl {
  out?: DutyQueryOutDecl[];
  served?: string[];
}

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

  /**
   * Optional: declared event topology (events consumed/emitted). Additive —
   * duties that don't declare this still load exactly as before.
   */
  events?: DutyEventsDecl;

  /**
   * Optional: declared targeted beams this duty sends.
   */
  beams?: DutyBeamDecl[];

  /**
   * Optional: declared queries this duty makes and/or serves.
   */
  queries?: DutyQueriesDecl;
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
  events?: DutyEventsDecl;
  beams?: DutyBeamDecl[];
  queries?: DutyQueriesDecl;
  instance: Duty;
}
