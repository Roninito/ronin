import type { Agent, AgentAPI } from "../types/index.js";

/**
 * Base Agent class that all agents should extend
 */
export abstract class BaseAgent implements Agent {
  protected api: AgentAPI;

  constructor(api: AgentAPI) {
    this.api = api;
  }

  /**
   * Main execution method - must be implemented by subclasses
   */
  abstract execute(): Promise<void>;

  /**
   * Optional: Called when a watched file changes
   */
  async onFileChange?(_path: string, _event: "create" | "update" | "delete"): Promise<void> {
    // Default: do nothing
  }

  /**
   * Optional: Called when a webhook is received
   */
  async onWebhook?(_payload: unknown): Promise<void> {
    // Default: do nothing
  }
}

