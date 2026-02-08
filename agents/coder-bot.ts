import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

interface PlanApprovedPayload {
  id: string;
  title?: string;
  description?: string;
  approvedAt?: number;
  approvedBy?: string;
}

/**
 * Coder Bot Agent
 * 
 * Pure reactor - listens for PlanApproved events
 * Executes work (via AI/cursor/whatever)
 * Emits PlanCompleted or PlanFailed
 * 
 * NEVER touches Kanban - only emits events
 */
export default class CoderBotAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    this.registerEventHandlers();
    console.log("🤖 Coder Bot ready. Listening for PlanApproved events...");
  }

  /**
   * Register event handlers
   */
  private registerEventHandlers(): void {
    this.api.events.on("PlanApproved", (data: unknown) => {
      const payload = data as PlanApprovedPayload;
      this.handlePlanApproved(payload);
    });

    console.log("[coder-bot] Event handlers registered");
  }

  /**
   * Handle PlanApproved: Execute the work
   */
  private async handlePlanApproved(payload: PlanApprovedPayload): Promise<void> {
    console.log(`[coder-bot] Received PlanApproved: ${payload.id}`);
    console.log(`[coder-bot] Title: ${payload.title || "N/A"}`);

    try {
      // Check if we have enough context to work with
      if (!payload.description) {
        throw new Error("No description provided for plan");
      }

      // Execute the work
      const result = await this.executeWork(payload);

      // Emit completion
      this.api.events.emit("PlanCompleted", {
        id: payload.id,
        result,
        completedAt: Date.now(),
        completedBy: "coder-bot",
      });

      console.log(`[coder-bot] ✅ PlanCompleted emitted for ${payload.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Emit failure
      this.api.events.emit("PlanFailed", {
        id: payload.id,
        error: errorMessage,
        failedAt: Date.now(),
        failedBy: "coder-bot",
      });

      console.error(`[coder-bot] ❌ PlanFailed emitted for ${payload.id}:`, errorMessage);
    }
  }

  /**
   * Execute the actual work
   * This is where you'd integrate with Cursor, AI APIs, etc.
   */
  private async executeWork(payload: PlanApprovedPayload): Promise<string> {
    console.log(`[coder-bot] Executing work for: ${payload.title}`);
    console.log(`[coder-bot] Description: ${payload.description?.substring(0, 100)}...`);

    // TODO: Replace with actual implementation
    // Options:
    // 1. Call Cursor agent via CLI
    // 2. Use AI API (Ollama, Grok, Gemini)
    // 3. Execute shell commands
    // 4. Trigger external CI/CD

    // For now, simulate work
    await this.simulateWork();

    // Return result
    return `Work completed for: ${payload.title}\nDescription: ${payload.description}`;
  }

  /**
   * Simulate work execution
   * Replace this with actual implementation
   */
  private async simulateWork(): Promise<void> {
    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // In real implementation:
    // - Call Cursor: cursor --agent "do something"
    // - Or use AI: this.api.ai.complete(prompt)
    // - Or shell: this.api.shell.exec("npm run build")
  }

  /**
   * Alternative: Execute via AI
   */
  private async executeViaAI(description: string): Promise<string> {
    const prompt = `Execute this task: ${description}\n\nProvide a summary of what was done.`;
    
    try {
      const response = await this.api.ai.complete(prompt, {
        maxTokens: 500,
      });
      return response;
    } catch (error) {
      throw new Error(`AI execution failed: ${error}`);
    }
  }

  /**
   * Alternative: Execute via shell command
   */
  private async executeViaShell(command: string): Promise<string> {
    try {
      const result = await this.api.shell.execAsync(command);
      return `Shell execution completed:\n${result}`;
    } catch (error) {
      throw new Error(`Shell execution failed: ${error}`);
    }
  }

  async execute(): Promise<void> {
    // This agent is event-driven
    // Work happens in event handlers
    console.log("[coder-bot] Running...");
  }
}
