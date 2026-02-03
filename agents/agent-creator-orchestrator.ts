import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { writeFile } from "fs/promises";
import { join } from "path";
import { ensureDefaultExternalAgentDir } from "../src/cli/commands/config.js";

/**
 * Event-driven orchestrator for agent creation using LangGraph
 * Listens for 'create_agent' events and 'cancel_creation' events
 */
export default class AgentCreatorOrchestrator extends BaseAgent {
  private activeCreations: Map<
    string,
    { promise: Promise<any>; cancel: () => void }
  > = new Map();
  private taskIdCounter = 0;

  constructor(api: AgentAPI) {
    super(api);

    // Register event listeners
    this.api.events.on("create_agent", this.handleCreate.bind(this));
    this.api.events.on("cancel_creation", this.handleCancel.bind(this));

    console.log("🎯 Agent Creator Orchestrator ready, listening for events...");
  }

  async execute(): Promise<void> {
    // Orchestrator is event-driven, so execute() can be empty
    // It waits for events to trigger agent creation
  }

  /**
   * Handle create_agent event
   */
  private async handleCreate(payload: { task: string }): Promise<void> {
    if (!this.api.langchain) {
      console.error("❌ LangChain plugin not loaded. Cannot create agents.");
      return;
    }

    const taskId = `creation-${this.taskIdCounter++}`;
    const cancellationToken = { isCancelled: false };

    console.log(`🚀 Starting agent creation: ${taskId} for task "${payload.task}"`);

    // Build graph with cancellation token
    const graph = await this.api.langchain.buildAgentCreationGraph(
      cancellationToken,
      this.api
    );

    // Run graph asynchronously
    const creationPromise = graph
      .invoke({ task: payload.task })
      .then(async (result: any) => {
        if (result.passed && result.finalCode) {
          // Determine agent directory
          const agentDir = ensureDefaultExternalAgentDir();
          const agentPath = join(agentDir, `${taskId}-agent.ts`);

          // Write agent code to file
          await writeFile(agentPath, result.finalCode, "utf-8");
          console.log(`✅ Agent created successfully: ${agentPath}`);

          // Emit success event
          this.api.events.emit("agent_created", {
            taskId,
            path: agentPath,
            success: true,
          });
        } else {
          console.error(`❌ Agent creation failed for ${taskId}`);
          if (result.errors) {
            console.error("Errors:", result.errors);
          }

          this.api.events.emit("agent_created", {
            taskId,
            success: false,
            errors: result.errors,
          });
        }
      })
      .catch((err: Error) => {
        if (err.message === "Creation cancelled") {
          console.log(`⏹️  Agent creation cancelled: ${taskId}`);
        } else {
          console.error(`❌ Error in agent creation ${taskId}:`, err);
        }

        this.api.events.emit("agent_created", {
          taskId,
          success: false,
          error: err.message,
        });
      })
      .finally(() => {
        this.activeCreations.delete(taskId);
      });

    // Track for cancellation
    this.activeCreations.set(taskId, {
      promise: creationPromise,
      cancel: () => {
        cancellationToken.isCancelled = true;
      },
    });

    // Don't await - let it run asynchronously
    creationPromise.catch(() => {
      // Errors already handled above
    });
  }

  /**
   * Handle cancel_creation event
   */
  private async handleCancel(payload: { taskId?: string }): Promise<void> {
    if (payload.taskId) {
      // Cancel specific creation
      const creation = this.activeCreations.get(payload.taskId);
      if (creation) {
        creation.cancel();
        this.activeCreations.delete(payload.taskId);
        console.log(`⏹️  Cancelled specific creation: ${payload.taskId}`);
      } else {
        console.log(`⚠️  Creation ${payload.taskId} not found`);
      }
    } else {
      // Cancel all active creations
      for (const [id, creation] of this.activeCreations) {
        creation.cancel();
        this.activeCreations.delete(id);
      }
      console.log("⏹️  Cancelled all active creations");
    }
  }
}
