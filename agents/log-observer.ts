import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { join } from "path";
import { homedir } from "os";
import { appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

interface EventLog {
  timestamp: number;
  eventType: string;
  payload: unknown;
  source: string;
}

/**
 * Log Observer Agent
 * 
 * Logs all plan events to file and console
 * Pure observer - no state mutation
 * Useful for debugging and audit trails
 */
export default class LogObserverAgent extends BaseAgent {
  private logDir: string;
  private logFile: string;

  constructor(api: AgentAPI) {
    super(api);
    this.logDir = join(homedir(), ".ronin", "logs");
    this.logFile = join(this.logDir, "plan-events.log");
    this.initializeLogDirectory();
    this.registerEventHandlers();
    console.log("📝 Log Observer ready. Logging plan events to:", this.logFile);
  }

  /**
   * Initialize log directory
   */
  private async initializeLogDirectory(): Promise<void> {
    if (!existsSync(this.logDir)) {
      await mkdir(this.logDir, { recursive: true });
    }
  }

  /**
   * Register event handlers for all events (catch-all)
   */
  private registerEventHandlers(): void {
    // Use a wildcard approach by registering for specific events
    const events = [
      "PlanProposed",
      "PlanApproved",
      "PlanCompleted",
      "PlanFailed",
      "PlanRejected",
      "PlanBlocked",
      "TaskCreated",
      "TaskMoved",
      "TaskRejected",
      "TaskBlocked",
    ];

    for (const eventType of events) {
      this.api.events.on(eventType, (data: unknown) => {
        this.logEvent(eventType, data);
      });
    }

    console.log("[log-observer] Event handlers registered for", events.length, "events");
  }

  /**
   * Log an event to file and console
   */
  private async logEvent(eventType: string, payload: unknown): Promise<void> {
    const logEntry: EventLog = {
      timestamp: Date.now(),
      eventType,
      payload,
      source: "log-observer",
    };

    const logLine = JSON.stringify(logEntry) + "\n";

    // Log to console
    console.log(`[log-observer] ${eventType}:`, JSON.stringify(payload, null, 2));

    // Append to log file
    try {
      await appendFile(this.logFile, logLine);
    } catch (error) {
      console.error("[log-observer] Failed to write to log file:", error);
    }
  }

  async execute(): Promise<void> {
    // Event-driven agent
    console.log("[log-observer] Running...");
  }
}
