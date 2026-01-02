import type { AgentAPI } from "./api.js";

/**
 * Base Agent interface that all agents must implement
 */
export interface Agent {
  /**
   * Main execution method called when agent is triggered
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
 * Agent class constructor type
 */
export interface AgentConstructor {
  new (api: AgentAPI): Agent;
  
  /**
   * Optional: Cron schedule expression (e.g., "0 */6 * * *")
   */
  schedule?: string;
  
  /**
   * Optional: File patterns to watch (e.g., ["**/*.log", "data/**/*.json"])
   */
  watch?: string[];
  
  /**
   * Optional: HTTP webhook path (e.g., "/webhook/my-agent")
   */
  webhook?: string;
}

/**
 * Metadata about a loaded agent
 */
export interface AgentMetadata {
  name: string;
  filePath: string;
  schedule?: string;
  watch?: string[];
  webhook?: string;
  instance: Agent;
}

