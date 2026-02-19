import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

interface Board {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
  created_at: number;
}

interface Card {
  id: string;
  column_id: string;
  board_id: string;
  title: string;
  description: string | null;
  position: number;
  priority: 'low' | 'medium' | 'high';
  labels: string;
  due_date: number | null;
  created_at: number;
  updated_at: number;
}

interface Dependency {
  id: string;
  card_id: string;
  depends_on_id: string;
  created_at: number;
}

interface CardWithDependencies extends Card {
  dependencies: string[];
  dependents: string[];
}

interface IntelligentTaskTemplate {
  id: string;
  title: string;
  instructions: string;
  ai_refined_plan: string | null;
  available_tools: string[]; // Parsed from JSON
  available_events: string[]; // Parsed from JSON
  priority: string | null;
  last_instance_at: number | null;
  next_suggested_at: number | null;
  instance_count: number;
  status: 'active' | 'paused' | 'archived';
  created_at: number;
  updated_at: number;
}

interface IntelligentTaskInstance {
  id: string;
  template_id: string;
  card_id: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  created_at: number;
  completed_at: number | null;
}

interface AIInteraction {
  id: string;
  instance_id: string;
  interaction: string;
  result: string | null;
  tools_used: string[];
  events_emitted: string[];
  timestamp: number;
  success: boolean;
}

/**
 * Todo Agent - Kanban board with priorities, labels, due dates, and dependencies
 * Provides /todo UI and /api/todo endpoints for task management
 */
export default class TodoAgent extends BaseAgent {
  private defaultBoardId: string | null = null;
  private taskingRulesCache: string | null = null;
  private taskingRulesLastModified: number = 0;

  constructor(api: AgentAPI) {
    super(api);
    this.initializeDatabase();
    this.registerRoutes();
    this.registerEventHandlers();
    this.loadTaskingRules();
    // Watch for changes to tasking-rules.md
    this.api.files.watch('tasking-rules.md', () => {
      this.loadTaskingRules();
    });
    console.log("✅ Todo agent ready. Kanban boards available at /todo");
    console.log("📋 Listening for plan events...");
  }

  /**
   * Register event handlers for plan workflow
   * This agent is the state authority for tasks
   */
  private registerEventHandlers(): void {
    // PlanProposed → Create task in "To Do"
    this.api.events.on("PlanProposed", (data: unknown) => {
      const payload = data as {
        id: string;
        title: string;
        description: string;
        tags: string[];
        source: string;
        proposedAt: number;
      };
      this.handlePlanProposed(payload);
    });

    // PlanApproved → Move to "Doing"
    this.api.events.on("PlanApproved", (data: unknown) => {
      const payload = data as { id: string; approvedAt?: number };
      this.handlePlanApproved(payload);
    });

    // PlanCompleted → Move to "Done"
    this.api.events.on("PlanCompleted", (data: unknown) => {
      const payload = data as { id: string; result?: string; completedAt?: number };
      this.handlePlanCompleted(payload);
    });

    // PlanRejected → Archive/Delete
    this.api.events.on("PlanRejected", (data: unknown) => {
      const payload = data as { id: string; reason?: string; rejectedAt?: number };
      this.handlePlanRejected(payload);
    });

    // PlanBlocked → Add blocked label
    this.api.events.on("PlanBlocked", (data: unknown) => {
      const payload = data as { id: string; reason?: string; blockedAt?: number };
      this.handlePlanBlocked(payload);
    });

    // PlanFailed → Move to "Failed" column
    this.api.events.on("PlanFailed", (data: unknown) => {
      const payload = data as { id: string; error?: string; failedAt?: number };
      this.handlePlanFailed(payload);
    });

    // TaskAppendDescription → Append to card description
    this.api.events.on("TaskAppendDescription", (data: unknown) => {
      const payload = data as { planId: string; content: string; timestamp: number };
      this.handleTaskAppendDescription(payload);
    });

    // CommandReceived → Create #command card and queue for immediate execution
    this.api.events.on("CommandReceived", (data: unknown) => {
      const payload = data as {
        instruction: string;
        priority?: 'low' | 'medium' | 'high';
        source?: string;
        sourceChannel?: string;
        sourceUser?: string;
      };
      this.handleCommandReceived(payload);
    });

    // PendingResponse → Create task card for timed-out notify.ask (Todo configures the task)
    this.api.events.on("PendingResponse", (data: unknown) => {
      const payload = data as {
        taskId: string;
        title: string;
        message: string;
        buttons: string[];
        source?: string;
      };
      this.handlePendingResponse(payload);
    });

    // UserResponse → Resolve a pending-response card by taskId
    this.api.events.on("UserResponse", (data: unknown) => {
      const payload = data as { taskId: string; answer: string };
      this.handleUserResponse(payload);
    });

    console.log("[todo] Event handlers registered");
  }

  /**
   * Handle PlanProposed: Create task in "To Do"
   */
  private async handlePlanProposed(payload: {
    id: string;
    title: string;
    description: string;
    tags: string[];
    source: string;
    sourceChannel?: string;
    sourceUser?: string;
    proposedAt: number;
  }): Promise<void> {
    try {
      // Ensure default board exists
      const board = await this.ensureDefaultBoard();
      
      // Get "To Do" column
      const todoColumn = await this.getColumnByName(board.id, "To Do");
      if (!todoColumn) {
        console.error("[todo] To Do column not found");
        return;
      }

      // Create card with plan ID and source info
      const card = await this.createCard(
        todoColumn.id,
        board.id,
        payload.title,
        payload.description,
        "medium",
        [...payload.tags, "plan", payload.source],
        undefined,
        payload.id,
        payload.source,
        payload.sourceChannel,
        payload.sourceUser
      );

      console.log(`[todo] PlanProposed: Created card ${card.id} for plan ${payload.id}`);
      
      // Emit event for observers
      this.api.events.emit("TaskCreated", {
        planId: payload.id,
        cardId: card.id,
        title: payload.title,
        column: "To Do",
      }, "todo");
    } catch (error) {
      console.error("[todo] Failed to handle PlanProposed:", error);
    }
  }

  /**
   * Handle PlanApproved: Move to "Doing"
   */
  private async handlePlanApproved(payload: {
    id: string;
    approvedAt?: number;
  }): Promise<void> {
    try {
      // Find card by plan ID (stored in description or we need to track mapping)
      const card = await this.findCardByPlanId(payload.id);
      if (!card) {
        console.error(`[todo] PlanApproved: Card not found for plan ${payload.id}`);
        return;
      }

      // Get "Doing" column
      const doingColumn = await this.getColumnByName(card.board_id, "Doing");
      if (!doingColumn) {
        console.error("[todo] Doing column not found");
        return;
      }

      // Move card
      await this.moveCardToColumn(card.id, doingColumn.id);
      
      console.log(`[todo] PlanApproved: Moved card ${card.id} to Doing`);
      
      // Emit event
      this.api.events.emit("TaskMoved", {
        planId: payload.id,
        cardId: card.id,
        from: "To Do",
        to: "Doing",
      }, "todo");
    } catch (error) {
      console.error("[todo] Failed to handle PlanApproved:", error);
    }
  }

  /**
   * Handle PlanCompleted: Move to "Done"
   */
  private async handlePlanCompleted(payload: {
    id: string;
    result?: string;
    completedAt?: number;
  }): Promise<void> {
    try {
      const card = await this.findCardByPlanId(payload.id);
      if (!card) {
        console.error(`[todo] PlanCompleted: Card not found for plan ${payload.id}`);
        return;
      }

      // Get "Done" column
      const doneColumn = await this.getColumnByName(card.board_id, "Done");
      if (!doneColumn) {
        console.error("[todo] Done column not found");
        return;
      }

      // Move card
      await this.moveCardToColumn(card.id, doneColumn.id);
      
      // Update description with result
      if (payload.result) {
        const newDescription = `${card.description || ""}\n\n---\n✅ Completed:\n${payload.result}`;
        await this.updateCard(card.id, { description: newDescription });
      }
      
      console.log(`[todo] PlanCompleted: Moved card ${card.id} to Done`);
      
      // Emit event
      this.api.events.emit("TaskMoved", {
        planId: payload.id,
        cardId: card.id,
        from: "Doing",
        to: "Done",
        result: payload.result,
      }, "todo");
    } catch (error) {
      console.error("[todo] Failed to handle PlanCompleted:", error);
    }
  }

  /**
   * Handle PlanRejected: Delete/archive
   */
  private async handlePlanRejected(payload: {
    id: string;
    reason?: string;
    rejectedAt?: number;
  }): Promise<void> {
    try {
      const card = await this.findCardByPlanId(payload.id);
      if (!card) {
        console.error(`[todo] PlanRejected: Card not found for plan ${payload.id}`);
        return;
      }

      // Add rejected label and move to archive or delete
      const labels = JSON.parse(card.labels || "[]");
      labels.push("rejected");
      if (payload.reason) {
        labels.push("reason:" + payload.reason.substring(0, 20));
      }
      
      await this.updateCard(card.id, { labels: JSON.stringify(labels) });
      
      // Optionally delete or move to archive column
      // For now, we just label it
      console.log(`[todo] PlanRejected: Marked card ${card.id} as rejected`);
      
      // Emit event
      this.api.events.emit("TaskRejected", {
        planId: payload.id,
        cardId: card.id,
        reason: payload.reason,
      }, "todo");
    } catch (error) {
      console.error("[todo] Failed to handle PlanRejected:", error);
    }
  }

  /**
   * Handle PlanBlocked: Add blocked label
   */
  private async handlePlanBlocked(payload: {
    id: string;
    reason?: string;
    blockedAt?: number;
  }): Promise<void> {
    try {
      const card = await this.findCardByPlanId(payload.id);
      if (!card) {
        console.error(`[todo] PlanBlocked: Card not found for plan ${payload.id}`);
        return;
      }

      // Add blocked label
      const labels = JSON.parse(card.labels || "[]");
      labels.push("blocked");
      if (payload.reason) {
        labels.push("blocked:" + payload.reason.substring(0, 20));
      }
      
      await this.updateCard(card.id, { labels: JSON.stringify(labels) });
      
      console.log(`[todo] PlanBlocked: Marked card ${card.id} as blocked`);
      
      // Emit event
      this.api.events.emit("TaskBlocked", {
        planId: payload.id,
        cardId: card.id,
        reason: payload.reason,
      }, "todo");
    } catch (error) {
      console.error("[todo] Failed to handle PlanBlocked:", error);
    }
  }

  /**
   * Handle PlanFailed: Move to "Failed" column
   */
  private async handlePlanFailed(payload: {
    id: string;
    error?: string;
    failedAt?: number;
  }): Promise<void> {
    try {
      const card = await this.findCardByPlanId(payload.id);
      if (!card) {
        console.error(`[todo] PlanFailed: Card not found for plan ${payload.id}`);
        return;
      }

      // Get or create "Failed" column
      const failedColumn = await this.getOrCreateColumn(card.board_id, "Failed", 3);
      if (!failedColumn) {
        console.error("[todo] Failed to get/create Failed column");
        return;
      }

      // Move card to Failed
      await this.moveCardToColumn(card.id, failedColumn.id);

      // Update description with error
      if (payload.error) {
        const newDescription = `${card.description || ""}\n\n---\n❌ Failed:\n${payload.error}`;
        await this.updateCard(card.id, { description: newDescription });
      }

      // Add failed label
      const labels = JSON.parse(card.labels || "[]");
      if (!labels.includes("failed")) {
        labels.push("failed");
      }
      await this.updateCard(card.id, { labels: JSON.stringify(labels) });

      console.log(`[todo] PlanFailed: Moved card ${card.id} to Failed column`);

      // Emit event
      this.api.events.emit("TaskFailed", {
        planId: payload.id,
        cardId: card.id,
        error: payload.error,
      }, "todo");
      // Standardized failure event for SkillMaker
      this.api.events.emit("agent.task.failed", {
        agent: "tasking",
        taskId: payload.id,
        error: payload.error ?? "Plan failed",
        timestamp: Date.now(),
        failureNotes: payload.error,
        request: "Plan execution",
        description: card.title,
      }, "tasking");
    } catch (error) {
      console.error("[todo] Failed to handle PlanFailed:", error);
    }
  }

  /**
   * Handle TaskAppendDescription: Append content to card description
   */
  private async handleTaskAppendDescription(payload: {
    planId: string;
    content: string;
    timestamp: number;
  }): Promise<void> {
    try {
      const card = await this.findCardByPlanId(payload.planId);
      if (!card) {
        console.error(`[todo] TaskAppendDescription: Card not found for plan ${payload.planId}`);
        return;
      }

      // Append content to description
      const newDescription = `${card.description || ""}${payload.content}`;
      await this.updateCard(card.id, { description: newDescription });

      console.log(`[todo] TaskAppendDescription: Updated card ${card.id}`);
    } catch (error) {
      console.error("[todo] Failed to handle TaskAppendDescription:", error);
    }
  }

  /**
   * Handle CommandReceived: Create a #command card and queue it for immediate execution.
   * Commands skip the PlanProposed→PlanApproved flow and go straight to "Doing".
   */
  private async handleCommandReceived(payload: {
    instruction: string;
    priority?: 'low' | 'medium' | 'high';
    source?: string;
    sourceChannel?: string;
    sourceUser?: string;
  }): Promise<void> {
    try {
      const board = await this.ensureDefaultBoard();
      const doingColumn = await this.getColumnByName(board.id, "Doing");
      if (!doingColumn) {
        console.error("[todo] Doing column not found for command");
        return;
      }

      const planId = crypto.randomUUID();
      const card = await this.createCard(
        doingColumn.id,
        board.id,
        payload.instruction.length > 80 ? payload.instruction.substring(0, 77) + "..." : payload.instruction,
        payload.instruction,
        payload.priority || "high",
        ["#command", payload.source || "user"],
        undefined,
        planId,
        payload.source,
        payload.sourceChannel,
        payload.sourceUser
      );

      console.log(`[todo] CommandReceived: Created command card ${card.id} in Doing`);

      this.api.events.emit("TaskCreated", {
        planId,
        cardId: card.id,
        title: card.title,
        column: "Doing",
        type: "command",
      }, "todo");
    } catch (error) {
      console.error("[todo] Failed to handle CommandReceived:", error);
    }
  }

  /**
   * Handle PendingResponse: create a task card for a timed-out notify.ask.
   * Todo agent configures board, column, labels, and description including taskId for later resolution.
   */
  private async handlePendingResponse(payload: {
    taskId: string;
    title: string;
    message: string;
    buttons: string[];
    source?: string;
  }): Promise<void> {
    try {
      const board = await this.ensureDefaultBoard();
      const todoColumn = await this.getColumnByName(board.id, "To Do");
      if (!todoColumn) {
        console.error("[todo] To Do column not found for PendingResponse");
        return;
      }

      const buttonLine = payload.buttons.length > 0
        ? `Options: ${payload.buttons.map((b, i) => `${i + 1}) ${b}`).join("  ")}`
        : "";
      const description = `[pending-response:${payload.taskId}]\n\n${payload.message}${buttonLine ? `\n\n${buttonLine}` : ""}\n\n(Respond via chat or command to complete this task.)`;

      const card = await this.createCard(
        todoColumn.id,
        board.id,
        payload.title,
        description,
        "high",
        ["#pending-response", payload.source || "notify.ask"]
      );

      console.log(`[todo] PendingResponse: Created card ${card.id} for taskId ${payload.taskId}`);

      this.api.events.emit("TaskCreated", {
        cardId: card.id,
        title: payload.title,
        column: "To Do",
        type: "pending-response",
        taskId: payload.taskId,
      }, "todo");
    } catch (error) {
      console.error("[todo] Failed to handle PendingResponse:", error);
    }
  }

  /**
   * Handle UserResponse: resolve a pending-response card by taskId (update with answer, move to Done).
   */
  private async handleUserResponse(payload: { taskId: string; answer: string }): Promise<void> {
    try {
      const cards = await this.api.db.query<Card>(
        `SELECT * FROM kanban_cards WHERE description LIKE ?`,
        [`%[pending-response:${payload.taskId}]%`]
      );
      if (cards.length === 0) {
        console.error(`[todo] UserResponse: No card found for taskId ${payload.taskId}`);
        return;
      }

      const card = cards[0];
      const doneColumn = await this.getColumnByName(card.board_id, "Done");
      if (!doneColumn) {
        console.error("[todo] Done column not found");
        return;
      }

      const newDescription = `${card.description || ""}\n\n---\n✅ User responded: ${payload.answer}`;
      await this.updateCard(card.id, { description: newDescription });
      await this.moveCardToColumn(card.id, doneColumn.id);

      this.api.events.emit("ResponseReceived", {
        taskId: payload.taskId,
        cardId: card.id,
        answer: payload.answer,
      }, "todo");

      console.log(`[todo] UserResponse: Resolved card ${card.id} for taskId ${payload.taskId}`);
    } catch (error) {
      console.error("[todo] Failed to handle UserResponse:", error);
    }
  }

  /**
   * Handle #command tag on a card - enqueue for immediate execution
   */
  private async handleCommandTag(cardId: string, title: string, description: string): Promise<void> {
    try {
      const id = crypto.randomUUID();
      const now = Date.now();

      await this.api.db.execute(
        `INSERT INTO kanban_command_queue (id, card_id, instruction, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`,
        [id, cardId, description || title, now]
      );

      // Move card to Doing immediately
      const card = await this.getCard(cardId);
      if (card) {
        const doingColumn = await this.getColumnByName(card.board_id, "Doing");
        if (doingColumn && card.column_id !== doingColumn.id) {
          await this.moveCardToColumn(cardId, doingColumn.id);
        }
      }

      console.log(`[todo] #command queued: ${id} for card ${cardId}`);
    } catch (error) {
      console.error("[todo] Failed to handle #command tag:", error);
    }
  }

  /**
   * Process pending commands from the command queue.
   * Runs one command at a time to completion before picking up the next.
   */
  private async processCommandQueue(): Promise<void> {
    // Check for a running command first - only one at a time
    const running = await this.api.db.query<{ id: string }>(
      `SELECT id FROM kanban_command_queue WHERE status = 'running' LIMIT 1`
    );
    if (running.length > 0) return;

    // Get next pending command (FIFO, highest priority first)
    const pending = await this.api.db.query<{
      id: string;
      card_id: string;
      instruction: string;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT cq.id, cq.card_id, cq.instruction, cq.attempts, cq.max_attempts
       FROM kanban_command_queue cq
       JOIN kanban_cards kc ON kc.id = cq.card_id
       WHERE cq.status = 'pending'
       ORDER BY
         CASE kc.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         cq.created_at ASC
       LIMIT 1`
    );

    if (pending.length === 0) return;

    const cmd = pending[0];
    const now = Date.now();

    // Mark as running
    await this.api.db.execute(
      `UPDATE kanban_command_queue SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ?`,
      [now, cmd.id]
    );

    try {
      // Get available tools
      const availableTools = this.api.tools.list().map(t => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as { type: "object"; properties: Record<string, { type: string; description?: string }>; required?: string[] },
        },
      }));

      const rules = this.getTaskingRules();

      const systemPrompt = `You are Ronin's command executor. The user has issued a direct command that must be completed immediately.

Command: ${cmd.instruction}

Rules:
${rules}

Execute this command to completion using the available tools. If you cannot complete it, explain what is needed.
If the task requires skills you don't have, use local.notify.ask to ask the user whether to create them.
Be thorough but efficient. Report your result when done.`;

      const result = await this.api.ai.callTools(systemPrompt, availableTools, {
        temperature: 0.3,
        maxTokens: 4000,
      });

      const toolsUsed = result.toolCalls.map(tc => tc.name);

      // Mark completed
      await this.api.db.execute(
        `UPDATE kanban_command_queue SET status = 'completed', result = ?, tools_used = ?, completed_at = ? WHERE id = ?`,
        [result.message.content, JSON.stringify(toolsUsed), Date.now(), cmd.id]
      );

      // Move card to Done
      const card = await this.getCard(cmd.card_id);
      if (card) {
        const doneColumn = await this.getColumnByName(card.board_id, "Done");
        if (doneColumn) {
          await this.moveCardToColumn(cmd.card_id, doneColumn.id);
          const desc = `${card.description || ""}\n\n---\n✅ Command completed:\n${result.message.content}`;
          await this.updateCard(cmd.card_id, { description: desc });
        }
      }

      this.api.events.emit("CommandCompleted", {
        commandId: cmd.id,
        cardId: cmd.card_id,
        result: result.message.content,
        toolsUsed,
      }, "todo");

      console.log(`[todo] Command ${cmd.id} completed successfully`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      if (cmd.attempts + 1 >= cmd.max_attempts) {
        // Max retries exhausted
        await this.api.db.execute(
          `UPDATE kanban_command_queue SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
          [errMsg, Date.now(), cmd.id]
        );

        // Move card to Failed
        const card = await this.getCard(cmd.card_id);
        if (card) {
          const failedColumn = await this.getOrCreateColumn(card.board_id, "Failed", 3);
          if (failedColumn) {
            await this.moveCardToColumn(cmd.card_id, failedColumn.id);
            const desc = `${card.description || ""}\n\n---\n❌ Command failed after ${cmd.max_attempts} attempts:\n${errMsg}`;
            await this.updateCard(cmd.card_id, { description: desc });
          }
        }

        this.api.events.emit("CommandFailed", {
          commandId: cmd.id,
          cardId: cmd.card_id,
          error: errMsg,
          attempts: cmd.attempts + 1,
        }, "todo");

        this.api.events.emit("agent.task.failed", {
          agent: "tasking",
          taskId: cmd.id,
          error: errMsg,
          timestamp: Date.now(),
          failureNotes: `Command failed after ${cmd.max_attempts} attempts`,
          request: cmd.instruction,
          description: cmd.instruction,
        }, "tasking");
      } else {
        // Retry: reset to pending
        await this.api.db.execute(
          `UPDATE kanban_command_queue SET status = 'pending', error = ? WHERE id = ?`,
          [errMsg, cmd.id]
        );
      }

      console.error(`[todo] Command ${cmd.id} failed (attempt ${cmd.attempts + 1}):`, errMsg);
    }
  }

  /**
   * Get or create a column by name
   */
  private async getOrCreateColumn(boardId: string, name: string, position?: number): Promise<Column | null> {
    // Try to find existing column
    const existing = await this.getColumnByName(boardId, name);
    if (existing) return existing;

    // Create new column
    try {
      const columns = await this.getColumns(boardId);
      const newPosition = position !== undefined ? position : columns.length;
      return await this.createColumn(boardId, name, newPosition);
    } catch (error) {
      console.error(`[todo] Failed to create column ${name}:`, error);
      return null;
    }
  }

  /**
   * Ensure default board exists (for plan workflow)
   */
  private async ensureDefaultBoard(): Promise<Board> {
    if (this.defaultBoardId) {
      const board = await this.getBoard(this.defaultBoardId);
      if (board) return board;
    }

    // Check if "Plans" board exists
    const boards = await this.getBoards();
    const plansBoard = boards.find(b => b.name === "Plans");
    
    if (plansBoard) {
      this.defaultBoardId = plansBoard.id;
      return plansBoard;
    }

    // Create new board
    const newBoard = await this.createBoard("Plans", "Auto-generated board for plan workflow");
    this.defaultBoardId = newBoard.id;
    return newBoard;
  }

  /**
   * Get column by name within a board
   */
  private async getColumnByName(boardId: string, name: string): Promise<Column | null> {
    const columns = await this.getColumns(boardId);
    return columns.find(c => c.name === name) || null;
  }

  /**
   * Find card by plan ID (stored in card metadata or description)
   */
  private async findCardByPlanId(planId: string): Promise<Card | null> {
    // Search for card with plan ID in description
    const cards = await this.api.db.query<Card>(
      `SELECT * FROM kanban_cards WHERE description LIKE ?`,
      [`%${planId}%`]
    );
    return cards[0] || null;
  }

  /**
   * Move card to a different column
   */
  private async moveCardToColumn(cardId: string, columnId: string): Promise<void> {
    const now = Date.now();
    await this.api.db.execute(
      `UPDATE kanban_cards SET column_id = ?, updated_at = ? WHERE id = ?`,
      [columnId, now, cardId]
    );
  }

  /**
   * Update card fields
   */
  private async updateCard(cardId: string, updates: Partial<Card>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    
    if (updates.title !== undefined) {
      sets.push("title = ?");
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      values.push(updates.description);
    }
    if (updates.labels !== undefined) {
      sets.push("labels = ?");
      values.push(updates.labels);
    }
    if (updates.column_id !== undefined) {
      sets.push("column_id = ?");
      values.push(updates.column_id);
    }
    
    sets.push("updated_at = ?");
    values.push(Date.now());
    values.push(cardId);

    await this.api.db.execute(
      `UPDATE kanban_cards SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
  }

  /**
   * Initialize database tables
   */
  private async initializeDatabase(): Promise<void> {
    try {
      // Boards table
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_boards (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // Columns table
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_columns (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          name TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      // Cards table with priorities, labels, due dates
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_cards (
          id TEXT PRIMARY KEY,
          column_id TEXT NOT NULL,
          board_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          position INTEGER NOT NULL,
          priority TEXT CHECK(priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
          labels TEXT,
          due_date INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // Dependencies table
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_dependencies (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL,
          depends_on_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(card_id, depends_on_id)
        )
      `);

      // Intelligent task templates table (persistent task definitions)
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_ai_task_templates (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          instructions TEXT NOT NULL,
          ai_refined_plan TEXT,
          available_tools TEXT,
          available_events TEXT,
          priority TEXT,
          last_instance_at INTEGER,
          next_suggested_at INTEGER,
          instance_count INTEGER DEFAULT 0,
          status TEXT CHECK(status IN ('active', 'paused', 'archived')) DEFAULT 'active',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // Intelligent task instances table (card instances)
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_ai_task_instances (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          card_id TEXT NOT NULL,
          status TEXT CHECK(status IN ('pending', 'active', 'completed', 'failed')) DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY(template_id) REFERENCES kanban_ai_task_templates(id),
          FOREIGN KEY(card_id) REFERENCES kanban_cards(id)
        )
      `);

      // Intelligent task history table (execution history per instance)
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_ai_task_history (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL,
          interaction TEXT NOT NULL,
          result TEXT,
          tools_used TEXT,
          events_emitted TEXT,
          timestamp INTEGER NOT NULL,
          success INTEGER CHECK(success IN (0, 1)) DEFAULT 0,
          FOREIGN KEY(instance_id) REFERENCES kanban_ai_task_instances(id)
        )
      `);

      // Command queue table for #command tasks (immediate user-prompted instructions)
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS kanban_command_queue (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL,
          instruction TEXT NOT NULL,
          status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
          result TEXT,
          error TEXT,
          tools_used TEXT,
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY(card_id) REFERENCES kanban_cards(id)
        )
      `);

      // Create indexes
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_kanban_columns_board ON kanban_columns(board_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_kanban_cards_column ON kanban_cards(column_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_kanban_cards_board ON kanban_cards(board_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_kanban_deps_card ON kanban_dependencies(card_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_kanban_deps_depends ON kanban_dependencies(depends_on_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_ai_templates_status ON kanban_ai_task_templates(status)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_ai_templates_next_suggested ON kanban_ai_task_templates(next_suggested_at)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_ai_instances_template ON kanban_ai_task_instances(template_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_ai_instances_card ON kanban_ai_task_instances(card_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_ai_instances_status ON kanban_ai_task_instances(status)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_ai_history_instance ON kanban_ai_task_history(instance_id)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_command_queue_status ON kanban_command_queue(status)`);
      await this.api.db.execute(`CREATE INDEX IF NOT EXISTS idx_command_queue_card ON kanban_command_queue(card_id)`);

      console.log("[Todo] Database initialized");
    } catch (error) {
      console.error("[Todo] Failed to initialize database:", error);
    }
  }

  /**
   * Load and cache tasking-rules.md file
   */
  private async loadTaskingRules(): Promise<void> {
    try {
      const rules = await this.api.files.read('./tasking-rules.md');
      this.taskingRulesCache = rules;
      this.taskingRulesLastModified = Date.now();
      console.log("[Todo] Loaded tasking-rules.md");
    } catch (error) {
      // File doesn't exist or can't be read - use empty rules
      this.taskingRulesCache = null;
      console.log("[Todo] No tasking-rules.md found, using defaults");
    }
  }

  /**
   * Get cached tasking rules
   */
  private getTaskingRules(): string {
    return this.taskingRulesCache || "No specific rules defined. Use your best judgment.";
  }

  async execute(): Promise<void> {
    try {
      // Process any pending commands first (immediate user instructions)
      await this.processCommandQueue();

      // Load rules
      const rules = this.getTaskingRules();

      // Get available tools and events
      const availableTools = this.api.tools.list().map(t => t.name);
      const registeredEvents = (this.api.events as any).getRegisteredEvents ? (this.api.events as any).getRegisteredEvents() : [];
      const availableEvents = registeredEvents.map((e: {event: string}) => e.event);

      // Query active templates
      const templates = await this.api.db.query<{
        id: string;
        title: string;
        instructions: string;
        ai_refined_plan: string | null;
        available_tools: string;
        available_events: string;
        priority: string | null;
        last_instance_at: number | null;
        next_suggested_at: number | null;
        instance_count: number;
        status: string;
      }>(
        `SELECT * FROM kanban_ai_task_templates WHERE status = 'active'`
      );

      if (templates.length === 0) {
        return; // No templates to process
      }

      const now = Date.now();
      const templateDecisions: Array<{ template: IntelligentTaskTemplate; priority_score: number; should_create: boolean; reason: string; next_suggested_at: number | null }> = [];

      // For each template, get AI decision
      for (const t of templates) {
        // Skip if next_suggested_at is in the future
        if (t.next_suggested_at && t.next_suggested_at > now) {
          continue;
        }

        // Load template history (last 3-5 instances)
        const recentInstances = await this.api.db.query<{
          id: string;
          status: string;
          completed_at: number | null;
        }>(
          `SELECT id, status, completed_at FROM kanban_ai_task_instances 
           WHERE template_id = ? ORDER BY created_at DESC LIMIT 5`,
          [t.id]
        );

        const successCount = recentInstances.filter(i => i.status === 'completed').length;
        const failureCount = recentInstances.filter(i => i.status === 'failed').length;
        const successRate = recentInstances.length > 0 ? successCount / recentInstances.length : 1.0;

        // Get current board state
        const board = await this.ensureDefaultBoard();
        const columns = await this.getColumns(board.id);
        const cardsInProgress = await this.api.db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM kanban_cards 
           WHERE board_id = ? AND column_id IN (SELECT id FROM kanban_columns WHERE name IN ('To Do', 'Doing'))`,
          [board.id]
        );
        const cardsInProgressCount = cardsInProgress[0]?.count || 0;

        // Build AI prompt
        const prompt = `You are deciding which intelligent task templates to instantiate.

Task Template:
Title: ${t.title}
Instructions: ${t.instructions}
AI Refined Plan: ${t.ai_refined_plan || 'Not yet refined'}
Priority Hint: ${t.priority || 'none'}
Instance Count: ${t.instance_count}
Last Instance: ${t.last_instance_at ? new Date(t.last_instance_at).toISOString() : 'never'}
Success Rate: ${(successRate * 100).toFixed(1)}% (${successCount} success, ${failureCount} failures)

Current Board State:
- Cards in progress: ${cardsInProgressCount}
- Available columns: ${columns.map(c => c.name).join(', ')}

Tasking Rules:
${rules}

Available Tools: ${availableTools.join(', ')}
Available Events: ${availableEvents.join(', ')}

Respond with JSON:
{
  "should_create_instance": boolean,
  "priority_score": number (0-100),
  "reason": "explanation",
  "next_suggested_at": timestamp or null
}`;

        try {
          const response = await this.api.ai.complete(prompt, { temperature: 0.3 });
          
          // Parse JSON response
          let decision: { should_create_instance?: boolean; priority_score?: number; reason?: string; next_suggested_at?: number | null } = {};
          try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              decision = JSON.parse(jsonMatch[0]);
            }
          } catch {
            // Fallback: if AI doesn't return JSON, make conservative decision
            decision = {
              should_create_instance: false,
              priority_score: 50,
              reason: "Could not parse AI response",
              next_suggested_at: now + 3600000 // 1 hour from now
            };
          }

          const templateObj: IntelligentTaskTemplate = {
            id: t.id,
            title: t.title,
            instructions: t.instructions,
            ai_refined_plan: t.ai_refined_plan,
            available_tools: t.available_tools ? JSON.parse(t.available_tools) : [],
            available_events: t.available_events ? JSON.parse(t.available_events) : [],
            priority: t.priority,
            last_instance_at: t.last_instance_at,
            next_suggested_at: t.next_suggested_at,
            instance_count: t.instance_count,
            status: t.status as 'active' | 'paused' | 'archived',
            created_at: 0,
            updated_at: 0
          };

          templateDecisions.push({
            template: templateObj,
            priority_score: decision.priority_score || 50,
            should_create: decision.should_create_instance || false,
            reason: decision.reason || 'No reason provided',
            next_suggested_at: decision.next_suggested_at || null
          });

          // Update template next_suggested_at
          await this.api.db.execute(
            `UPDATE kanban_ai_task_templates SET next_suggested_at = ?, updated_at = ? WHERE id = ?`,
            [decision.next_suggested_at || null, now, t.id]
          );
        } catch (error) {
          console.error(`[Todo] Failed to get AI decision for template ${t.id}:`, error);
        }
      }

      // Rank and select top templates (default: top 1-3)
      templateDecisions.sort((a, b) => b.priority_score - a.priority_score);
      const topTemplates = templateDecisions.filter(d => d.should_create).slice(0, 3);

      // Create instances for selected templates
      for (const decision of topTemplates) {
        try {
          await this.createTaskInstance(decision.template.id);
          console.log(`[Todo] Created instance for template "${decision.template.title}": ${decision.reason}`);
        } catch (error) {
          console.error(`[Todo] Failed to create instance for template ${decision.template.id}:`, error);
        }
      }
    } catch (error) {
      console.error("[Todo] Error in execute():", error);
    }
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    // UI Routes
    this.api.http.registerRoute("/todo", this.handleBoardsList.bind(this));
    this.api.http.registerRoute("/todo/", this.handleBoardView.bind(this));

    // API Routes - Boards
    this.api.http.registerRoute("/api/todo/boards", this.handleBoardsAPI.bind(this));
    this.api.http.registerRoute("/api/todo/boards/", this.handleBoardByIdAPI.bind(this));

    // API Routes - Columns
    this.api.http.registerRoute("/api/todo/columns/", this.handleColumnByIdAPI.bind(this));

    // API Routes - Cards
    this.api.http.registerRoute("/api/todo/cards", this.handleCardsAPI.bind(this));
    this.api.http.registerRoute("/api/todo/cards/", this.handleCardByIdAPI.bind(this));

    // API Routes - Dependencies
    this.api.http.registerRoute("/api/todo/dependencies", this.handleDependenciesAPI.bind(this));

    // API Routes - Intelligent Tasks Templates
    this.api.http.registerRoute("/api/todo/ai-templates", this.handleAITemplatesAPI.bind(this));
    this.api.http.registerRoute("/api/todo/ai-templates/", this.handleAITemplateByIdAPI.bind(this));

    // API Routes - Intelligent Task Instances
    this.api.http.registerRoute("/api/todo/ai-instances", this.handleAIInstancesAPI.bind(this));
    this.api.http.registerRoute("/api/todo/ai-instances/", this.handleAIInstanceByIdAPI.bind(this));

    // API Routes - Tasking Rules
    this.api.http.registerRoute("/api/todo/rules", this.handleRulesAPI.bind(this));

    // API Routes - Command Queue
    this.api.http.registerRoute("/api/todo/commands", this.handleCommandsAPI.bind(this));
    this.api.http.registerRoute("/api/todo/commands/", this.handleCommandByIdAPI.bind(this));

    // API Routes - Events
    this.api.http.registerRoute("/api/todo/events", this.handleEventsAPI.bind(this));
  }

  // ==================== Database Operations ====================

  private async createBoard(name: string, description?: string): Promise<Board> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.api.db.execute(
      `INSERT INTO kanban_boards (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, name, description || null, now, now]
    );

    // Create default columns: To Do, Doing, Done, Failed
    await this.createColumn(id, "To Do", 0);
    await this.createColumn(id, "Doing", 1);
    await this.createColumn(id, "Done", 2);
    await this.createColumn(id, "Failed", 3);

    return { id, name, description: description || null, created_at: now, updated_at: now };
  }

  private async getBoards(): Promise<Board[]> {
    return await this.api.db.query<Board>(
      `SELECT * FROM kanban_boards ORDER BY updated_at DESC`
    );
  }

  private async getBoard(id: string): Promise<Board | null> {
    const boards = await this.api.db.query<Board>(
      `SELECT * FROM kanban_boards WHERE id = ?`,
      [id]
    );
    return boards[0] || null;
  }

  private async updateBoard(id: string, updates: Partial<Board>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    
    if (updates.name !== undefined) {
      sets.push("name = ?");
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      values.push(updates.description);
    }
    
    sets.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    await this.api.db.execute(
      `UPDATE kanban_boards SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
  }

  private async deleteBoard(id: string): Promise<void> {
    // Delete dependencies first
    await this.api.db.execute(`
      DELETE FROM kanban_dependencies 
      WHERE card_id IN (SELECT id FROM kanban_cards WHERE board_id = ?)
      OR depends_on_id IN (SELECT id FROM kanban_cards WHERE board_id = ?)
    `, [id, id]);

    // Delete cards
    await this.api.db.execute(`DELETE FROM kanban_cards WHERE board_id = ?`, [id]);

    // Delete columns
    await this.api.db.execute(`DELETE FROM kanban_columns WHERE board_id = ?`, [id]);

    // Delete board
    await this.api.db.execute(`DELETE FROM kanban_boards WHERE id = ?`, [id]);
  }

  private async createColumn(boardId: string, name: string, position: number): Promise<Column> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.api.db.execute(
      `INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, boardId, name, position, now]
    );
    return { id, board_id: boardId, name, position, created_at: now };
  }

  private async getColumns(boardId: string): Promise<Column[]> {
    return await this.api.db.query<Column>(
      `SELECT * FROM kanban_columns WHERE board_id = ? ORDER BY position ASC`,
      [boardId]
    );
  }

  private async updateColumn(id: string, name: string): Promise<void> {
    await this.api.db.execute(
      `UPDATE kanban_columns SET name = ? WHERE id = ?`,
      [name, id]
    );
  }

  private async deleteColumn(id: string): Promise<void> {
    // Move cards to first remaining column or delete them
    const columns = await this.api.db.query<{ board_id: string; position: number }>(
      `SELECT board_id, position FROM kanban_columns WHERE id = ?`,
      [id]
    );
    
    if (columns.length === 0) return;

    const otherColumn = await this.api.db.query<{ id: string }>(
      `SELECT id FROM kanban_columns WHERE board_id = ? AND id != ? ORDER BY position ASC LIMIT 1`,
      [columns[0].board_id, id]
    );

    if (otherColumn.length > 0) {
      await this.api.db.execute(
        `UPDATE kanban_cards SET column_id = ? WHERE column_id = ?`,
        [otherColumn[0].id, id]
      );
    } else {
      // Delete cards if no other column exists
      await this.api.db.execute(`DELETE FROM kanban_cards WHERE column_id = ?`, [id]);
    }

    await this.api.db.execute(`DELETE FROM kanban_columns WHERE id = ?`, [id]);
  }

  private async createCard(
    columnId: string,
    boardId: string,
    title: string,
    description?: string,
    priority: 'low' | 'medium' | 'high' = 'medium',
    labels: string[] = [],
    dueDate?: number,
    planId?: string,
    source?: string,
    sourceChannel?: string,
    sourceUser?: string
  ): Promise<Card> {
    const id = crypto.randomUUID();
    const now = Date.now();

    // Include plan ID and source info in description if provided
    let finalDescription = description || null;
    if (planId) {
      finalDescription = `[plan:${planId}]`;
      if (source) finalDescription += `[source:${source}]`;
      if (sourceChannel) finalDescription += `[channel:${sourceChannel}]`;
      if (sourceUser) finalDescription += `[user:${sourceUser}]`;
      finalDescription += ` ${description || ""}`;
    }

    // Get max position in column
    const maxPos = await this.api.db.query<{ max_pos: number }>(
      `SELECT MAX(position) as max_pos FROM kanban_cards WHERE column_id = ?`,
      [columnId]
    );
    const position = (maxPos[0]?.max_pos || 0) + 1;

    await this.api.db.execute(
      `INSERT INTO kanban_cards (id, column_id, board_id, title, description, position, priority, labels, due_date, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, columnId, boardId, title, finalDescription, position, priority, JSON.stringify(labels), dueDate || null, now, now]
    );

    // Check for #ai tag and create/link template and instance
    const hasAiTag = labels.some(l => l === '#ai' || l === 'ai' || l.toLowerCase() === '#ai' || l.toLowerCase() === 'ai');
    if (hasAiTag) {
      await this.handleAiTagCard(id, title, finalDescription || '', labels);
    }

    // Check for #command tag and queue for immediate execution
    const hasCommandTag = labels.some(l => l === '#command' || l === 'command' || l.toLowerCase() === '#command');
    if (hasCommandTag) {
      await this.handleCommandTag(id, title, finalDescription || '');
    }

    return {
      id, column_id: columnId, board_id: boardId, title,
      description: finalDescription, position, priority,
      labels: JSON.stringify(labels), due_date: dueDate || null,
      created_at: now, updated_at: now
    };
  }

  private async getCards(columnId: string): Promise<CardWithDependencies[]> {
    const cards = await this.api.db.query<Card>(
      `SELECT * FROM kanban_cards WHERE column_id = ? ORDER BY position ASC`,
      [columnId]
    );

    const cardsWithDeps: CardWithDependencies[] = [];
    for (const card of cards) {
      const deps = await this.getCardDependencies(card.id);
      cardsWithDeps.push({ ...card, ...deps });
    }

    return cardsWithDeps;
  }

  private async getCard(cardId: string): Promise<CardWithDependencies | null> {
    const cards = await this.api.db.query<Card>(
      `SELECT * FROM kanban_cards WHERE id = ?`,
      [cardId]
    );
    
    if (cards.length === 0) return null;

    const deps = await this.getCardDependencies(cardId);
    return { ...cards[0], ...deps };
  }

  private async updateCard(id: string, updates: Partial<Card>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      sets.push("title = ?");
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      values.push(updates.description);
    }
    if (updates.priority !== undefined) {
      sets.push("priority = ?");
      values.push(updates.priority);
    }
    if (updates.labels !== undefined) {
      sets.push("labels = ?");
      values.push(typeof updates.labels === 'string' ? updates.labels : JSON.stringify(updates.labels));
    }
    if (updates.due_date !== undefined) {
      sets.push("due_date = ?");
      values.push(updates.due_date);
    }
    if (updates.column_id !== undefined) {
      sets.push("column_id = ?");
      values.push(updates.column_id);
    }
    if (updates.position !== undefined) {
      sets.push("position = ?");
      values.push(updates.position);
    }

    sets.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    await this.api.db.execute(
      `UPDATE kanban_cards SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
  }

  private async deleteCard(id: string): Promise<void> {
    // Delete dependencies
    await this.api.db.execute(
      `DELETE FROM kanban_dependencies WHERE card_id = ? OR depends_on_id = ?`,
      [id, id]
    );

    await this.api.db.execute(`DELETE FROM kanban_cards WHERE id = ?`, [id]);
  }

  private async moveCard(cardId: string, newColumnId: string, newPosition: number): Promise<void> {
    const card = await this.getCard(cardId);
    if (!card) return;

    // Get column names for lifecycle integration
    const oldColumn = await this.api.db.query<{ name: string }>(
      `SELECT name FROM kanban_columns WHERE id = ?`,
      [card.column_id]
    );
    const newColumn = await this.api.db.query<{ name: string }>(
      `SELECT name FROM kanban_columns WHERE id = ?`,
      [newColumnId]
    );
    const oldColumnName = oldColumn[0]?.name || '';
    const newColumnName = newColumn[0]?.name || '';

    // Check if moving to "Done" column
    const doneColumn = await this.api.db.query<{ id: string }>(
      `SELECT id FROM kanban_columns WHERE board_id = ? AND name = 'Done'`,
      [card.board_id]
    );

    if (doneColumn.length > 0 && newColumnId === doneColumn[0].id) {
      // Check dependencies
      const incompleteDeps = await this.api.db.query<{ id: string }>(`
        SELECT c.id FROM kanban_cards c
        JOIN kanban_dependencies d ON c.id = d.depends_on_id
        WHERE d.card_id = ? AND c.column_id != ?
      `, [cardId, doneColumn[0].id]);

      if (incompleteDeps.length > 0) {
        throw new Error("Cannot complete: has incomplete dependencies");
      }
    }

    // Update positions of other cards in new column
    await this.api.db.execute(
      `UPDATE kanban_cards SET position = position + 1 
       WHERE column_id = ? AND position >= ? AND id != ?`,
      [newColumnId, newPosition, cardId]
    );

    // Move card
    await this.api.db.execute(
      `UPDATE kanban_cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?`,
      [newColumnId, newPosition, Date.now(), cardId]
    );

    // Update intelligent task instance status based on card movement
    const labels = JSON.parse(card.labels || '[]');
    const hasAiTag = labels.some((l: string) => l === '#ai' || l === 'ai' || l.toLowerCase() === '#ai' || l.toLowerCase() === 'ai');
    
    if (hasAiTag) {
      const instance = await this.api.db.query<{ id: string; status: string }>(
        `SELECT id, status FROM kanban_ai_task_instances WHERE card_id = ?`,
        [cardId]
      );

      if (instance.length > 0) {
        const inst = instance[0];
        let newStatus: 'pending' | 'active' | 'completed' | 'failed' = inst.status as any;

        if (newColumnName === 'Doing') {
          newStatus = 'active';
          // Optionally execute the task when moved to Doing
          // await this.executeTaskInstance(inst.id);
        } else if (newColumnName === 'Done') {
          newStatus = 'completed';
          await this.api.db.execute(
            `UPDATE kanban_ai_task_instances SET completed_at = ? WHERE id = ?`,
            [Date.now(), inst.id]
          );
        } else if (newColumnName === 'Failed') {
          newStatus = 'failed';
        } else if (newColumnName === 'To Do') {
          newStatus = 'pending';
        }

        if (newStatus !== inst.status) {
          await this.api.db.execute(
            `UPDATE kanban_ai_task_instances SET status = ? WHERE id = ?`,
            [newStatus, inst.id]
          );
          console.log(`[Todo] Updated instance ${inst.id} status: ${inst.status} -> ${newStatus}`);
        }
      }
    }
  }

  private async getCardDependencies(cardId: string): Promise<{ dependencies: string[]; dependents: string[] }> {
    const deps = await this.api.db.query<{ depends_on_id: string }>(
      `SELECT depends_on_id FROM kanban_dependencies WHERE card_id = ?`,
      [cardId]
    );

    const dependents = await this.api.db.query<{ card_id: string }>(
      `SELECT card_id FROM kanban_dependencies WHERE depends_on_id = ?`,
      [cardId]
    );

    return {
      dependencies: deps.map(d => d.depends_on_id),
      dependents: dependents.map(d => d.card_id)
    };
  }

  private async addDependency(cardId: string, dependsOnId: string): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.api.db.execute(
      `INSERT INTO kanban_dependencies (id, card_id, depends_on_id, created_at) VALUES (?, ?, ?, ?)`,
      [id, cardId, dependsOnId, now]
    );
  }

  private async removeDependency(cardId: string, dependsOnId: string): Promise<void> {
    await this.api.db.execute(
      `DELETE FROM kanban_dependencies WHERE card_id = ? AND depends_on_id = ?`,
      [cardId, dependsOnId]
    );
  }

  // ==================== Intelligent Task Template Operations ====================

  /**
   * Handle #ai tag detection - create or link template and create instance
   */
  private async handleAiTagCard(cardId: string, title: string, description: string, labels: string[]): Promise<void> {
    try {
      // Check if description contains template ID reference
      const templateIdMatch = description.match(/\[template:([^\]]+)\]/);
      let templateId = templateIdMatch ? templateIdMatch[1] : null;

      if (!templateId) {
        // Create new template from card
        const template = await this.createTaskTemplate(title, description || title, null);
        templateId = template.id;
      }

      // Create task instance linking template to card
      await this.createTaskInstance(templateId, cardId);
    } catch (error) {
      console.error("[Todo] Failed to handle #ai tag:", error);
    }
  }

  /**
   * Create a new task template
   */
  private async createTaskTemplate(
    title: string,
    instructions: string,
    priority: string | null = null
  ): Promise<IntelligentTaskTemplate> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await this.api.db.execute(
      `INSERT INTO kanban_ai_task_templates 
       (id, title, instructions, ai_refined_plan, available_tools, available_events, priority, 
        last_instance_at, next_suggested_at, instance_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, title, instructions, null, JSON.stringify([]), JSON.stringify([]), priority,
        null, null, 0, 'active', now, now
      ]
    );

    return {
      id, title, instructions, ai_refined_plan: null,
      available_tools: [], available_events: [], priority,
      last_instance_at: null, next_suggested_at: null, instance_count: 0,
      status: 'active', created_at: now, updated_at: now
    };
  }

  /**
   * Refine a task template using AI to generate plan with tools/events
   */
  private async refineTaskTemplate(templateId: string): Promise<void> {
    try {
      const template = await this.getTaskTemplate(templateId);
      if (!template) throw new Error(`Template ${templateId} not found`);

      // Get available tools and events
      const availableTools = this.api.tools.list().map(t => t.name);
      const registeredEvents = (this.api.events as any).getRegisteredEvents ? (this.api.events as any).getRegisteredEvents() : [];
      const availableEvents = registeredEvents.map((e: {event: string}) => e.event);

      // Build AI prompt for refinement
      const prompt = `You are refining a task template into an execution plan.

Task Title: ${template.title}
Task Instructions: ${template.instructions}

Available Tools: ${availableTools.join(', ')}
Available Events: ${availableEvents.join(', ')}

Generate a JSON response with:
{
  "plan": "Detailed step-by-step plan of attack",
  "tools": ["list", "of", "tools", "to", "use"],
  "events": ["list", "of", "events", "to", "emit"]
}

Focus on which tools and events would be most useful for accomplishing this task.`;

      const response = await this.api.ai.complete(prompt, { temperature: 0.7 });
      
      // Try to parse JSON from response
      let planData: { plan?: string; tools?: string[]; events?: string[] } = {};
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          planData = JSON.parse(jsonMatch[0]);
        } else {
          planData = { plan: response, tools: [], events: [] };
        }
      } catch {
        planData = { plan: response, tools: [], events: [] };
      }

      // Update template with refined plan
      const now = Date.now();
      await this.api.db.execute(
        `UPDATE kanban_ai_task_templates 
         SET ai_refined_plan = ?, available_tools = ?, available_events = ?, updated_at = ?
         WHERE id = ?`,
        [
          planData.plan || response,
          JSON.stringify(planData.tools || []),
          JSON.stringify(planData.events || []),
          now,
          templateId
        ]
      );
    } catch (error) {
      console.error(`[Todo] Failed to refine template ${templateId}:`, error);
      throw error;
    }
  }

  /**
   * Get a task template by ID
   */
  private async getTaskTemplate(templateId: string): Promise<IntelligentTaskTemplate | null> {
    const templates = await this.api.db.query<{
      id: string;
      title: string;
      instructions: string;
      ai_refined_plan: string | null;
      available_tools: string;
      available_events: string;
      priority: string | null;
      last_instance_at: number | null;
      next_suggested_at: number | null;
      instance_count: number;
      status: string;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT * FROM kanban_ai_task_templates WHERE id = ?`,
      [templateId]
    );

    if (templates.length === 0) return null;

    const t = templates[0];
    return {
      id: t.id,
      title: t.title,
      instructions: t.instructions,
      ai_refined_plan: t.ai_refined_plan,
      available_tools: t.available_tools ? JSON.parse(t.available_tools) : [],
      available_events: t.available_events ? JSON.parse(t.available_events) : [],
      priority: t.priority,
      last_instance_at: t.last_instance_at,
      next_suggested_at: t.next_suggested_at,
      instance_count: t.instance_count,
      status: t.status as 'active' | 'paused' | 'archived',
      created_at: t.created_at,
      updated_at: t.updated_at
    };
  }

  /**
   * Create a task instance (card) from a template
   */
  private async createTaskInstance(templateId: string, cardId?: string): Promise<IntelligentTaskInstance> {
    const template = await this.getTaskTemplate(templateId);
    if (!template) throw new Error(`Template ${templateId} not found`);

    const instanceId = crypto.randomUUID();
    const now = Date.now();

    // If cardId not provided, create a new card
    if (!cardId) {
      const board = await this.ensureDefaultBoard();
      const todoColumn = await this.getColumnByName(board.id, "To Do");
      if (!todoColumn) throw new Error("To Do column not found");

      const card = await this.createCard(
        todoColumn.id,
        board.id,
        template.title,
        `${template.instructions}\n\n---\nAI Refined Plan:\n${template.ai_refined_plan || 'Not yet refined'}`,
        'medium',
        ['#ai', `template:${templateId}`]
      );
      cardId = card.id;
    }

    // Create instance record
    await this.api.db.execute(
      `INSERT INTO kanban_ai_task_instances 
       (id, template_id, card_id, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [instanceId, templateId, cardId, 'pending', now, null]
    );

    // Update template stats
    await this.api.db.execute(
      `UPDATE kanban_ai_task_templates 
       SET last_instance_at = ?, instance_count = instance_count + 1, updated_at = ?
       WHERE id = ?`,
      [now, now, templateId]
    );

    // Emit event
    this.api.events.emit("TaskInstanceCreated", {
      instanceId,
      templateId,
      cardId,
      templateTitle: template.title
    }, "todo");

    return {
      id: instanceId,
      template_id: templateId,
      card_id: cardId,
      status: 'pending',
      created_at: now,
      completed_at: null
    };
  }

  /**
   * Execute a task instance
   */
  private async executeTaskInstance(instanceId: string): Promise<void> {
    try {
      const instance = await this.api.db.query<{
        id: string;
        template_id: string;
        card_id: string;
        status: string;
      }>(
        `SELECT * FROM kanban_ai_task_instances WHERE id = ?`,
        [instanceId]
      );

      if (instance.length === 0) throw new Error(`Instance ${instanceId} not found`);

      const inst = instance[0];
      const template = await this.getTaskTemplate(inst.template_id);
      if (!template) throw new Error(`Template ${inst.template_id} not found`);

      // Load instance history
      const history = await this.api.db.query<{
        interaction: string;
        result: string | null;
        tools_used: string;
        events_emitted: string;
        success: number;
      }>(
        `SELECT interaction, result, tools_used, events_emitted, success 
         FROM kanban_ai_task_history WHERE instance_id = ? ORDER BY timestamp DESC LIMIT 10`,
        [instanceId]
      );

      const rules = this.getTaskingRules();

      // Build execution prompt
      const historyText = history.map(h => 
        `- ${h.interaction}${h.result ? `\n  Result: ${h.result}` : ''}\n  Success: ${h.success ? 'Yes' : 'No'}`
      ).join('\n\n');

      const prompt = `Execute this intelligent task:

Task: ${template.title}
Instructions: ${template.instructions}
AI Refined Plan: ${template.ai_refined_plan || 'Not yet refined'}

Available Tools: ${template.available_tools.join(', ')}
Available Events: ${template.available_events.join(', ')}

Previous Execution History:
${historyText || 'None'}

Tasking Rules:
${rules}

Execute the task using the available tools and emit events as needed. Provide a summary of what was done.`;

      // Execute with tool calling if tools are available
      let executionResult = '';
      let toolsUsed: string[] = [];
      let eventsEmitted: string[] = [];

      if (template.available_tools.length > 0) {
        // Use tool calling
        try {
          const toolSchemas = this.api.tools.getSchemas();
          const relevantTools = toolSchemas.filter(t => 
            template.available_tools.some(at => at === t.function.name)
          );

          if (relevantTools.length > 0) {
            const result = await this.api.ai.callTools(prompt, relevantTools);
            executionResult = result.message.content || 'Task executed';
            toolsUsed = result.toolCalls.map(tc => tc.name);
          } else {
            executionResult = await this.api.ai.complete(prompt);
          }
        } catch {
          executionResult = await this.api.ai.complete(prompt);
        }
      } else {
        executionResult = await this.api.ai.complete(prompt);
      }

      // Store interaction in history
      const interactionId = crypto.randomUUID();
      await this.api.db.execute(
        `INSERT INTO kanban_ai_task_history 
         (id, instance_id, interaction, result, tools_used, events_emitted, timestamp, success)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          interactionId,
          instanceId,
          'Task execution',
          executionResult,
          JSON.stringify(toolsUsed),
          JSON.stringify(eventsEmitted),
          Date.now(),
          1 // Assume success for now
        ]
      );

      // Update card description with execution results
      const card = await this.getCard(inst.card_id);
      if (card) {
        const newDescription = `${card.description || ''}\n\n---\n🤖 AI Execution (${new Date().toISOString()}):\n${executionResult}`;
        await this.updateCard(inst.card_id, { description: newDescription });
      }

      console.log(`[Todo] Executed task instance ${instanceId}`);
    } catch (error) {
      console.error(`[Todo] Failed to execute instance ${instanceId}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Emit for SkillMaker (failureNotes, request, description)
      let templateTitle = "intelligent task";
      try {
        const instance = await this.api.db.query<{ template_id: string }>(
          `SELECT template_id FROM kanban_ai_task_instances WHERE id = ?`,
          [instanceId]
        );
        if (instance.length > 0) {
          const t = await this.getTaskTemplate(instance[0].template_id);
          if (t) templateTitle = t.title;
        }
      } catch {}
      this.api.events.emit(
        "agent.task.failed",
        {
          agent: "tasking",
          taskId: instanceId,
          error: errorMessage,
          timestamp: Date.now(),
          failureNotes: errorMessage,
          request: "Execute intelligent task",
          description: templateTitle,
        },
        "tasking"
      );
      // Store failure in history
      try {
        const interactionId = crypto.randomUUID();
        await this.api.db.execute(
          `INSERT INTO kanban_ai_task_history 
           (id, instance_id, interaction, result, tools_used, events_emitted, timestamp, success)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            interactionId,
            instanceId,
            'Task execution failed',
            errorMessage,
            JSON.stringify([]),
            JSON.stringify([]),
            Date.now(),
            0
          ]
        );
      } catch {}
      throw error;
    }
  }

  // ==================== Route Handlers ====================

  private async handleBoardsList(req: Request): Promise<Response> {
    // Single board mode - always redirect to the Plans board
    const board = await this.ensureDefaultBoard();
    const url = new URL(req.url);
    url.searchParams.set("board", board.id);
    return this.handleBoardView(new Request(url.toString()));
  }

  private async handleBoardView(req: Request): Promise<Response> {
   try {
    const url = new URL(req.url);
    const boardId = url.searchParams.get("board") || url.pathname.split('/').pop();

    if (!boardId) {
      return new Response("Board ID required", { status: 400 });
    }

    const board = await this.getBoard(boardId);
    if (!board) {
      return new Response("Board not found", { status: 404 });
    }

    const columns = await this.getColumns(boardId);
    const columnsWithCards = await Promise.all(
      columns.map(async col => ({
        ...col,
        cards: await this.getCards(col.id)
      }))
    );

    // Get all cards for dependency selection
    const allCards = await this.api.db.query<Card>(
      `SELECT id, title FROM kanban_cards WHERE board_id = ?`,
      [boardId]
    );

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(board.name)} - Kanban</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: ${roninTheme.colors.background};
      color: ${roninTheme.colors.textPrimary};
      min-height: 100vh;
      overflow-x: auto;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .back-link {
      color: ${roninTheme.colors.textSecondary};
      text-decoration: none;
      font-size: 0.875rem;
    }

    .back-link:hover {
      color: ${roninTheme.colors.textPrimary};
    }

    .board-description {
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }

    .add-card-btn {
      background: ${roninTheme.colors.accent};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.5rem 1rem;
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.875rem;
    }

    .add-card-btn:hover {
      background: ${roninTheme.colors.accentHover};
    }

    .board {
      display: flex;
      gap: 1rem;
      padding: 1.5rem 2rem;
      min-height: calc(100vh - 80px);
      align-items: flex-start;
    }

    .column {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      min-width: 300px;
      max-width: 300px;
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 120px);
    }

    .column-header {
      padding: 1rem;
      border-bottom: 1px solid ${roninTheme.colors.border};
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .column-title {
      font-weight: 500;
      font-size: 0.875rem;
    }

    .column-count {
      background: ${roninTheme.colors.backgroundTertiary};
      padding: 0.125rem 0.5rem;
      border-radius: ${roninTheme.borderRadius.sm};
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
    }

    .column-content {
      padding: 0.75rem;
      overflow-y: auto;
      flex: 1;
      min-height: 100px;
    }

    .column-content.drag-over {
      background: ${roninTheme.colors.backgroundTertiary};
    }

    .card {
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      cursor: grab;
      transition: all 0.2s;
    }

    .card:hover {
      border-color: ${roninTheme.colors.borderHover};
    }

    .card.dragging {
      opacity: 0.5;
      cursor: grabbing;
    }

    .card-title {
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
      line-height: 1.4;
    }

    .card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }

    .priority {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .priority-low { background: #28a745; }
    .priority-medium { background: #f59e0b; }
    .priority-high { background: #dc3545; }

    .labels {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .label {
      font-size: 0.6875rem;
      padding: 0.125rem 0.375rem;
      border-radius: ${roninTheme.borderRadius.sm};
      background: ${roninTheme.colors.accent};
      color: ${roninTheme.colors.textSecondary};
    }

    .due-date {
      font-size: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .due-future { color: #28a745; }
    .due-today { color: #f59e0b; }
    .due-overdue { color: #dc3545; }

    .dependency-indicator {
      font-size: 0.75rem;
      color: ${roninTheme.colors.warning};
    }

    .card-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 0.5rem;
    }

    .badge {
      font-size: 0.625rem;
      font-weight: 600;
      padding: 0.125rem 0.375rem;
      border-radius: ${roninTheme.borderRadius.sm};
      text-transform: uppercase;
      letter-spacing: 0.025em;
    }

    .badge-build {
      background: #28a745;
      color: white;
    }

    .badge-auto {
      background: #fd7e14;
      color: white;
    }

    .badge-cli {
      font-weight: 700;
    }

    .badge-qwen {
      background: #dc3545;
      color: white;
    }

    .badge-cursor {
      background: #007bff;
      color: white;
    }

    .badge-opencode {
      background: #6f42c1;
      color: white;
    }

    .badge-gemini {
      background: #20c997;
      color: white;
    }

    .badge-app {
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textSecondary};
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.625rem;
    }

    .add-card-column-btn {
      width: 100%;
      padding: 0.5rem;
      background: transparent;
      border: 1px dashed ${roninTheme.colors.border};
      color: ${roninTheme.colors.textSecondary};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }

    .add-card-column-btn:hover {
      border-color: ${roninTheme.colors.borderHover};
      color: ${roninTheme.colors.textPrimary};
    }

    /* Modal Styles */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      padding: 2rem;
    }

    .modal.active {
      display: flex;
    }

    .modal-content {
      background: ${roninTheme.colors.background};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.lg};
      padding: 1.5rem;
      max-width: 600px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-header {
      margin-bottom: 1rem;
    }

    .modal-header h2 {
      font-size: 1.25rem;
      font-weight: 400;
    }

    .form-group {
      margin-bottom: 0.75rem;
    }

    .form-group label {
      display: block;
      margin-bottom: 0.25rem;
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
    }

    .form-group input,
    .form-group textarea,
    .form-group select {
      width: 100%;
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      color: ${roninTheme.colors.textPrimary};
      padding: 0.5rem;
      border-radius: ${roninTheme.borderRadius.md};
      font-family: inherit;
      font-size: 0.75rem;
    }

    .form-group textarea {
      min-height: 120px;
      resize: vertical;
    }

    .markdown-preview-container {
      margin-top: 0.5rem;
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      background: ${roninTheme.colors.backgroundSecondary};
    }

    .preview-label {
      display: block;
      padding: 0.25rem 0.5rem;
      font-size: 0.7rem;
      color: ${roninTheme.colors.textSecondary};
      border-bottom: 1px solid ${roninTheme.colors.border};
      background: ${roninTheme.colors.background};
      border-radius: ${roninTheme.borderRadius.md} ${roninTheme.borderRadius.md} 0 0;
    }

    .markdown-preview {
      padding: 0.75rem;
      font-size: 0.75rem;
      line-height: 1.5;
      max-height: 200px;
      overflow-y: auto;
    }

    .markdown-preview h1,
    .markdown-preview h2,
    .markdown-preview h3,
    .markdown-preview h4 {
      margin-top: 0.5rem;
      margin-bottom: 0.25rem;
      font-weight: 600;
    }

    .markdown-preview h1 { font-size: 1rem; }
    .markdown-preview h2 { font-size: 0.9rem; }
    .markdown-preview h3 { font-size: 0.8rem; }

    .markdown-preview p {
      margin-bottom: 0.5rem;
    }

    .markdown-preview ul,
    .markdown-preview ol {
      margin-left: 1rem;
      margin-bottom: 0.5rem;
    }

    .markdown-preview li {
      margin-bottom: 0.25rem;
    }

    .markdown-preview code {
      background: ${roninTheme.colors.background};
      padding: 0.1rem 0.25rem;
      border-radius: 3px;
      font-family: monospace;
    }

    .markdown-preview pre {
      background: ${roninTheme.colors.background};
      padding: 0.5rem;
      border-radius: ${roninTheme.borderRadius.md};
      overflow-x: auto;
      margin: 0.5rem 0;
    }

    .markdown-preview pre code {
      background: transparent;
      padding: 0;
    }

    .markdown-preview blockquote {
      border-left: 3px solid ${roninTheme.colors.border};
      padding-left: 0.75rem;
      margin: 0.5rem 0;
      color: ${roninTheme.colors.textSecondary};
    }

    .markdown-preview a {
      color: ${roninTheme.colors.accent};
      text-decoration: none;
    }

    .markdown-preview a:hover {
      text-decoration: underline;
    }

    .markdown-preview table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.5rem 0;
      font-size: 0.7rem;
    }

    .markdown-preview th,
    .markdown-preview td {
      border: 1px solid ${roninTheme.colors.border};
      padding: 0.25rem 0.5rem;
      text-align: left;
    }

    .markdown-preview th {
      background: ${roninTheme.colors.background};
    }

    .form-group input:focus,
    .form-group textarea:focus,
    .form-group select:focus {
      outline: none;
      border-color: ${roninTheme.colors.borderHover};
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-height: 150px;
      overflow-y: auto;
      padding: 0.5rem;
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }

    .checkbox-item input[type="checkbox"] {
      width: auto;
    }

    .form-actions {
      display: flex;
      gap: 1rem;
      justify-content: flex-end;
      margin-top: 1.5rem;
    }

    .btn-secondary {
      background: transparent;
      color: ${roninTheme.colors.textSecondary};
      border: 1px solid ${roninTheme.colors.border};
    }

    .btn-secondary:hover {
      background: ${roninTheme.colors.backgroundSecondary};
      color: ${roninTheme.colors.textPrimary};
    }

    .btn-danger {
      background: rgba(220, 53, 69, 0.1);
      color: #dc3545;
      border: 1px solid rgba(220, 53, 69, 0.3);
    }

    .btn-danger:hover {
      background: rgba(220, 53, 69, 0.2);
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <div class="header-left">
      <a href="/todo" class="back-link">← Back to Boards</a>
      <div>
        <h1>${this.escapeHtml(board.name)}</h1>
        ${board.description ? `<div class="board-description">${this.escapeHtml(board.description)}</div>` : ''}
      </div>
    </div>
    <div class="header-actions">
      <button class="add-card-btn" onclick="openCreateModal()">+ Add Card</button>
    </div>
  </div>

  <div class="board">
    ${columnsWithCards.map(column => `
      <div class="column" data-column-id="${column.id}">
        <div class="column-header">
          <span class="column-title">${this.escapeHtml(column.name)}</span>
          <span class="column-count">${column.cards.length}</span>
        </div>
        <div class="column-content" data-column-id="${column.id}">
          ${column.cards.map(card => this.renderCard(card)).join('')}
        </div>
        <button class="add-card-column-btn" onclick="openCreateModal('${column.id}')">+ Add a card</button>
      </div>
    `).join('')}
  </div>

  <!-- Create/Edit Card Modal -->
  <div class="modal" id="cardModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle">Add Card</h2>
      </div>
      <form id="cardForm">
        <input type="hidden" id="cardId">
        <input type="hidden" id="columnId">
        
        <div class="form-group">
          <label for="cardTitle">Title</label>
          <input type="text" id="cardTitle" required placeholder="What needs to be done?">
        </div>
        
        <div class="form-group">
          <label for="cardDescription">Description (Markdown supported)</label>
          <textarea id="cardDescription" rows="8" placeholder="Add details..."></textarea>
          <div class="markdown-preview-container">
            <label class="preview-label">Preview</label>
            <div id="descriptionPreview" class="markdown-preview"></div>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label for="cardPriority">Priority</label>
            <select id="cardPriority">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          
          <div class="form-group">
            <label for="cardDueDate">Due Date</label>
            <input type="datetime-local" id="cardDueDate">
          </div>
        </div>
        
        <div class="form-group">
          <label for="cardLabels">Labels (comma-separated)</label>
          <input type="text" id="cardLabels" placeholder="bug, feature, urgent">
        </div>
        
        <div class="form-group">
          <label>Dependencies</label>
          <div class="checkbox-group">
            ${allCards.map(c => `
              <label class="checkbox-item">
                <input type="checkbox" name="dependencies" value="${c.id}">
                ${this.escapeHtml(c.title)}
              </label>
            `).join('')}
          </div>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="button" class="btn-danger" id="deleteBtn" style="display:none" onclick="deleteCard()">Delete</button>
          <button type="submit" class="add-card-btn">Save Card</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const boardId = '${boardId}';
    let draggedCard = null;
    let draggedCardId = null;

    // Drag and Drop
    document.querySelectorAll('.column-content').forEach(column => {
      column.addEventListener('dragover', (e) => {
        e.preventDefault();
        column.classList.add('drag-over');
      });

      column.addEventListener('dragleave', () => {
        column.classList.remove('drag-over');
      });

      column.addEventListener('drop', async (e) => {
        e.preventDefault();
        column.classList.remove('drag-over');
        
        if (!draggedCardId) return;
        
        const newColumnId = column.dataset.columnId;
        const cards = Array.from(column.querySelectorAll('.card'));
        const newPosition = cards.length;

        try {
          const res = await fetch(\`/api/todo/cards/\${draggedCardId}/move\`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ column_id: newColumnId, position: newPosition })
          });

          if (res.ok) {
            window.location.reload();
          } else {
            const err = await res.text();
            alert(err);
          }
        } catch (err) {
          alert('Error moving card: ' + err.message);
        }
      });
    });

    document.querySelectorAll('.card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedCard = card;
        draggedCardId = card.dataset.cardId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        draggedCard = null;
        draggedCardId = null;
      });

      card.addEventListener('click', () => openEditModal(card.dataset.cardId));
    });

    // Modal functions
    function openCreateModal(columnId = null) {
      document.getElementById('modalTitle').textContent = 'Add Card';
      document.getElementById('cardForm').reset();
      document.getElementById('cardId').value = '';
      document.getElementById('columnId').value = columnId || '';
      document.getElementById('deleteBtn').style.display = 'none';
      document.getElementById('cardModal').classList.add('active');
    }

    async function openEditModal(cardId) {
      try {
        const res = await fetch(\`/api/todo/cards/\${cardId}\`);
        if (!res.ok) throw new Error('Failed to load card');
        
        const card = await res.json();
        
        document.getElementById('modalTitle').textContent = 'Edit Card';
        document.getElementById('cardId').value = card.id;
        document.getElementById('columnId').value = card.column_id;
        document.getElementById('cardTitle').value = card.title;
        document.getElementById('cardDescription').value = card.description || '';
        document.getElementById('cardPriority').value = card.priority;
        document.getElementById('cardLabels').value = card.labels ? JSON.parse(card.labels).join(', ') : '';
        
        if (card.due_date) {
          const date = new Date(card.due_date);
          document.getElementById('cardDueDate').value = date.toISOString().slice(0, 16);
        } else {
          document.getElementById('cardDueDate').value = '';
        }

        // Set dependencies
        document.querySelectorAll('input[name="dependencies"]').forEach(cb => {
          cb.checked = card.dependencies && card.dependencies.includes(cb.value);
        });

        document.getElementById('deleteBtn').style.display = 'inline-block';
        document.getElementById('cardModal').classList.add('active');
      } catch (err) {
        alert('Error loading card: ' + err.message);
      }
    }

    function closeModal() {
      document.getElementById('cardModal').classList.remove('active');
    }

    async function deleteCard() {
      const cardId = document.getElementById('cardId').value;
      if (!cardId) return;
      
      if (!confirm('Are you sure you want to delete this card?')) return;

      try {
        const res = await fetch(\`/api/todo/cards/\${cardId}\`, { method: 'DELETE' });
        if (res.ok) {
          window.location.reload();
        } else {
          alert('Failed to delete card');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    // Form submission
    document.getElementById('cardForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const cardId = document.getElementById('cardId').value;
      const columnId = document.getElementById('columnId').value;
      const title = document.getElementById('cardTitle').value;
      const description = document.getElementById('cardDescription').value;
      const priority = document.getElementById('cardPriority').value;
      const dueDate = document.getElementById('cardDueDate').value;
      const labels = document.getElementById('cardLabels').value.split(',').map(l => l.trim()).filter(Boolean);
      
      const dependencies = Array.from(document.querySelectorAll('input[name="dependencies"]:checked'))
        .map(cb => cb.value);

      const data = {
        title,
        description,
        priority,
        labels,
        due_date: dueDate ? new Date(dueDate).getTime() : null,
        dependencies
      };

      try {
        let res;
        if (cardId) {
          res = await fetch(\`/api/todo/cards/\${cardId}\`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
        } else {
          res = await fetch(\`/api/todo/columns/\${columnId}/cards\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
        }

        if (res.ok) {
          window.location.reload();
        } else {
          alert('Failed to save card');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });

    // Close modal on backdrop click
    document.getElementById('cardModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // Markdown rendering
    const descriptionTextarea = document.getElementById('cardDescription');
    const descriptionPreview = document.getElementById('descriptionPreview');

    function renderMarkdown() {
      if (descriptionTextarea && descriptionPreview && window.marked) {
        const markdown = descriptionTextarea.value || '';
        descriptionPreview.innerHTML = window.marked.parse(markdown);
      }
    }

    if (descriptionTextarea) {
      descriptionTextarea.addEventListener('input', renderMarkdown);
    }

    // Override openCreateModal to initialize preview
    const originalOpenCreateModal = openCreateModal;
    window.openCreateModal = function(columnId) {
      originalOpenCreateModal(columnId);
      renderMarkdown();
    };

    // Override openEditModal to initialize preview
    const originalOpenEditModal = openEditModal;
    window.openEditModal = async function(cardId) {
      await originalOpenEditModal(cardId);
      renderMarkdown();
    };
  </script>

  <!-- Load marked.js for markdown rendering -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
   } catch (error) {
    console.error('[Todo] Board view error:', error);
    return new Response(`<h1>Error</h1><pre>${String(error)}</pre>`, { status: 500, headers: { "Content-Type": "text/html" } });
   }
  }

  private renderCard(card: CardWithDependencies): string {
    const labels = card.labels ? JSON.parse(card.labels) : [];
    let dueDateClass = '';
    let dueDateText = '';

    if (card.due_date) {
      const now = Date.now();
      const due = card.due_date;
      const today = new Date().setHours(0, 0, 0, 0);
      const dueDay = new Date(due).setHours(0, 0, 0, 0);

      if (dueDay < today) {
        dueDateClass = 'due-overdue';
        dueDateText = 'Overdue';
      } else if (dueDay === today) {
        dueDateClass = 'due-today';
        dueDateText = 'Today';
      } else {
        dueDateClass = 'due-future';
        dueDateText = new Date(due).toLocaleDateString();
      }
    }

    const hasDeps = card.dependencies && card.dependencies.length > 0;
    
    // Extract special tags for badges
    const hasBuild = labels.includes('build');
    const hasAuto = labels.includes('auto');
    const cliTag = labels.find((l: string) => ['qwen', 'cursor', 'opencode', 'gemini'].includes(l));
    const appTag = labels.find((l: string) => l.startsWith('app-'));

    return `
      <div class="card" draggable="true" data-card-id="${card.id}">
        <div class="card-badges">
          ${hasBuild ? '<span class="badge badge-build" title="Auto-execute on approval">BUILD</span>' : ''}
          ${hasAuto ? '<span class="badge badge-auto" title="Execute immediately">AUTO</span>' : ''}
          ${cliTag ? `<span class="badge badge-cli badge-${cliTag}">${cliTag}</span>` : ''}
          ${appTag ? `<span class="badge badge-app">${appTag.replace('app-', '')}</span>` : ''}
        </div>
        <div class="card-title">${this.escapeHtml(card.title)}</div>
        <div class="card-meta">
          <span class="priority priority-${card.priority}" title="${card.priority} priority"></span>
          ${labels.length > 0 ? `
            <div class="labels">
              ${labels.map((l: string) => `<span class="label">${this.escapeHtml(l)}</span>`).join('')}
            </div>
          ` : ''}
          ${card.due_date ? `
            <span class="due-date ${dueDateClass}">
              📅 ${dueDateText}
            </span>
          ` : ''}
          ${hasDeps ? `<span class="dependency-indicator" title="Has dependencies">⚠️</span>` : ''}
        </div>
      </div>
    `;
  }

  // ==================== API Handlers ====================

  private async handleBoardsAPI(req: Request): Promise<Response> {
    try {
      if (req.method === 'GET') {
        const boards = await this.getBoards();
        return Response.json(boards);
      }

      if (req.method === 'POST') {
        const body = await req.json();
        const board = await this.createBoard(body.name, body.description);
        return Response.json(board, { status: 201 });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Boards API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleBoardByIdAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split('/').filter(Boolean);
      // For /api/todo/boards/:id, parts = ['api', 'todo', 'boards', ':id']
      const boardsIdx = parts.indexOf('boards');
      const boardId = boardsIdx >= 0 ? parts[boardsIdx + 1] : undefined;

      if (!boardId) {
        return new Response('Board ID required', { status: 400 });
      }

      if (req.method === 'GET') {
        const board = await this.getBoard(boardId);
        if (!board) return new Response('Board not found', { status: 404 });

        const columns = await this.getColumns(boardId);
        const columnsWithCards = await Promise.all(
          columns.map(async col => ({
            ...col,
            cards: await this.getCards(col.id)
          }))
        );

        return Response.json({ ...board, columns: columnsWithCards });
      }

      if (req.method === 'PUT') {
        const body = await req.json();
        await this.updateBoard(boardId, body);
        return Response.json({ success: true });
      }

      if (req.method === 'DELETE') {
        await this.deleteBoard(boardId);
        return Response.json({ success: true });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Board API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleColumnByIdAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split('/').filter(Boolean);
      // For /api/todo/columns/:id/cards, parts = ['api', 'todo', 'columns', ':id', 'cards']
      // For /api/todo/columns/:id, parts = ['api', 'todo', 'columns', ':id']
      const columnsIdx = parts.indexOf('columns');
      const columnId = columnsIdx >= 0 ? parts[columnsIdx + 1] : undefined;

      if (!columnId) {
        return new Response('Column ID required', { status: 400 });
      }

      // Handle POST /api/todo/columns/:id/cards
      if (req.method === 'POST' && url.pathname.includes('/cards')) {
        const body = await req.json();
        const column = await this.api.db.query<{ board_id: string }>(
          `SELECT board_id FROM kanban_columns WHERE id = ?`,
          [columnId]
        );

        if (column.length === 0) {
          return new Response('Column not found', { status: 404 });
        }

        const card = await this.createCard(
          columnId,
          column[0].board_id,
          body.title,
          body.description,
          body.priority,
          body.labels,
          body.due_date
        );

        // Add dependencies
        if (body.dependencies && body.dependencies.length > 0) {
          for (const depId of body.dependencies) {
            await this.addDependency(card.id, depId);
          }
        }

        return Response.json(card, { status: 201 });
      }

      if (req.method === 'PUT') {
        const body = await req.json();
        await this.updateColumn(columnId, body.name);
        return Response.json({ success: true });
      }

      if (req.method === 'DELETE') {
        await this.deleteColumn(columnId);
        return Response.json({ success: true });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Column API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleCardsAPI(req: Request): Promise<Response> {
    return new Response('Method not allowed', { status: 405 });
  }

  private async handleCardByIdAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split('/').filter(Boolean);
      // For /api/todo/cards/:id/move, parts = ['api', 'todo', 'cards', ':id', 'move']
      // For /api/todo/cards/:id, parts = ['api', 'todo', 'cards', ':id']
      const cardsIdx = parts.indexOf('cards');
      const cardId = cardsIdx >= 0 ? parts[cardsIdx + 1] : undefined;

      if (!cardId) {
        return new Response('Card ID required', { status: 400 });
      }

      // Handle PUT /api/todo/cards/:id/move
      if (req.method === 'PUT' && url.pathname.includes('/move')) {
        const body = await req.json();
        try {
          // Get card info before moving
          const card = await this.getCard(cardId);
          if (!card) {
            return new Response('Card not found', { status: 404 });
          }
          
          // Get old column name
          const oldColumn = await this.api.db.query<{ name: string }>(
            `SELECT name FROM kanban_columns WHERE id = ?`,
            [card.column_id]
          );
          const fromColumn = oldColumn[0]?.name || 'Unknown';
          
          // Get new column name
          const newColumn = await this.api.db.query<{ name: string }>(
            `SELECT name FROM kanban_columns WHERE id = ?`,
            [body.column_id]
          );
          const toColumn = newColumn[0]?.name || 'Unknown';
          
          // Move the card
          await this.moveCard(cardId, body.column_id, body.position);
          
          // Extract info from description (stored as [plan:xxx][source:xxx][channel:xxx][user:xxx])
          const planIdMatch = card.description?.match(/\[plan:([^\]]+)\]/);
          const planId = planIdMatch ? planIdMatch[1] : undefined;
          const sourceMatch = card.description?.match(/\[source:([^\]]+)\]/);
          const source = sourceMatch ? sourceMatch[1] : undefined;
          const channelMatch = card.description?.match(/\[channel:([^\]]+)\]/);
          const sourceChannel = channelMatch ? channelMatch[1] : undefined;
          const userMatch = card.description?.match(/\[user:([^\]]+)\]/);
          const sourceUser = userMatch ? userMatch[1] : undefined;
          
          // Emit TaskMoved event so other agents know
          const labels = JSON.parse(card.labels || '[]');
          this.api.events.emit('TaskMoved', {
            planId: planId,
            cardId: card.id,
            title: card.title,
            description: card.description,
            tags: labels,
            from: fromColumn,
            to: toColumn,
            source: source,
            sourceChannel: sourceChannel,
            sourceUser: sourceUser,
          }, 'todo');
          
          console.log(`[todo] Emitted TaskMoved with planId: ${planId || 'none'}`);
          
          console.log(`[todo] Card ${cardId} moved from "${fromColumn}" to "${toColumn}"`);
          
          return Response.json({ success: true, from: fromColumn, to: toColumn });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : 'Failed to move card', { status: 400 });
        }
      }

      if (req.method === 'GET') {
        const card = await this.getCard(cardId);
        if (!card) return new Response('Card not found', { status: 404 });
        return Response.json(card);
      }

      if (req.method === 'PUT') {
        const body = await req.json();
        
        await this.updateCard(cardId, {
          title: body.title,
          description: body.description,
          priority: body.priority,
          labels: JSON.stringify(body.labels),
          due_date: body.due_date
        });

        // Update dependencies
        if (body.dependencies !== undefined) {
          // Remove existing dependencies
          await this.api.db.execute(
            `DELETE FROM kanban_dependencies WHERE card_id = ?`,
            [cardId]
          );

          // Add new dependencies
          for (const depId of body.dependencies) {
            await this.addDependency(cardId, depId);
          }
        }

        return Response.json({ success: true });
      }

      if (req.method === 'DELETE') {
        await this.deleteCard(cardId);
        return Response.json({ success: true });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Card API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleDependenciesAPI(req: Request): Promise<Response> {
    try {
      if (req.method === 'POST') {
        const body = await req.json();
        await this.addDependency(body.card_id, body.depends_on_id);
        return Response.json({ success: true }, { status: 201 });
      }

      if (req.method === 'DELETE') {
        const url = new URL(req.url);
        const cardId = url.searchParams.get('card_id');
        const dependsOnId = url.searchParams.get('depends_on_id');

        if (!cardId || !dependsOnId) {
          return new Response('card_id and depends_on_id required', { status: 400 });
        }

        await this.removeDependency(cardId, dependsOnId);
        return Response.json({ success: true });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Dependencies API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==================== Intelligent Tasks API Handlers ====================

  private async handleAITemplatesAPI(req: Request): Promise<Response> {
    try {
      if (req.method === 'GET') {
        const templates = await this.api.db.query<{
          id: string;
          title: string;
          instructions: string;
          ai_refined_plan: string | null;
          available_tools: string;
          available_events: string;
          priority: string | null;
          last_instance_at: number | null;
          next_suggested_at: number | null;
          instance_count: number;
          status: string;
          created_at: number;
          updated_at: number;
        }>(
          `SELECT * FROM kanban_ai_task_templates ORDER BY created_at DESC`
        );
        const parsed = templates.map(t => ({
          id: t.id,
          title: t.title,
          instructions: t.instructions,
          ai_refined_plan: t.ai_refined_plan,
          available_tools: t.available_tools ? JSON.parse(t.available_tools) : [],
          available_events: t.available_events ? JSON.parse(t.available_events) : [],
          priority: t.priority,
          last_instance_at: t.last_instance_at,
          next_suggested_at: t.next_suggested_at,
          instance_count: t.instance_count,
          status: t.status,
          created_at: t.created_at,
          updated_at: t.updated_at
        }));
        return Response.json(parsed);
      }

      if (req.method === 'POST') {
        const body = await req.json();
        const template = await this.createTaskTemplate(body.title, body.instructions, body.priority || null);
        return Response.json(template, { status: 201 });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] AI Templates API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleAITemplateByIdAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split('/').filter(Boolean);
      const templatesIdx = parts.indexOf('ai-templates');
      const templateId = templatesIdx >= 0 ? parts[templatesIdx + 1] : undefined;

      if (!templateId) {
        return new Response('Template ID required', { status: 400 });
      }

      // Handle POST /api/todo/ai-templates/:id/refine
      if (req.method === 'POST' && url.pathname.includes('/refine')) {
        await this.refineTaskTemplate(templateId);
        const template = await this.getTaskTemplate(templateId);
        return Response.json(template);
      }

      // Handle POST /api/todo/ai-templates/:id/instantiate
      if (req.method === 'POST' && url.pathname.includes('/instantiate')) {
        const instance = await this.createTaskInstance(templateId);
        return Response.json(instance, { status: 201 });
      }

      if (req.method === 'GET') {
        const template = await this.getTaskTemplate(templateId);
        if (!template) return new Response('Template not found', { status: 404 });
        return Response.json(template);
      }

      if (req.method === 'PUT') {
        const body = await req.json();
        const now = Date.now();
        const sets: string[] = [];
        const values: unknown[] = [];

        if (body.title !== undefined) {
          sets.push("title = ?");
          values.push(body.title);
        }
        if (body.instructions !== undefined) {
          sets.push("instructions = ?");
          values.push(body.instructions);
        }
        if (body.priority !== undefined) {
          sets.push("priority = ?");
          values.push(body.priority);
        }
        if (body.status !== undefined) {
          sets.push("status = ?");
          values.push(body.status);
        }

        sets.push("updated_at = ?");
        values.push(now);
        values.push(templateId);

        await this.api.db.execute(
          `UPDATE kanban_ai_task_templates SET ${sets.join(", ")} WHERE id = ?`,
          values
        );

        const template = await this.getTaskTemplate(templateId);
        return Response.json(template);
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] AI Template API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleAIInstancesAPI(req: Request): Promise<Response> {
    try {
      if (req.method === 'GET') {
        const url = new URL(req.url);
        const templateId = url.searchParams.get('template_id');
        
        let query = `SELECT * FROM kanban_ai_task_instances`;
        const params: unknown[] = [];
        
        if (templateId) {
          query += ` WHERE template_id = ?`;
          params.push(templateId);
        }
        
        query += ` ORDER BY created_at DESC`;
        
        const instances = await this.api.db.query<{
          id: string;
          template_id: string;
          card_id: string;
          status: string;
          created_at: number;
          completed_at: number | null;
        }>(query, params);
        return Response.json(instances);
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] AI Instances API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleAIInstanceByIdAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split('/').filter(Boolean);
      const instancesIdx = parts.indexOf('ai-instances');
      const instanceId = instancesIdx >= 0 ? parts[instancesIdx + 1] : undefined;

      if (!instanceId) {
        return new Response('Instance ID required', { status: 400 });
      }

      // Handle GET /api/todo/ai-instances/:id/history
      if (req.method === 'GET' && url.pathname.includes('/history')) {
        const history = await this.api.db.query<{
          id: string;
          instance_id: string;
          interaction: string;
          result: string | null;
          tools_used: string;
          events_emitted: string;
          timestamp: number;
          success: number;
        }>(
          `SELECT * FROM kanban_ai_task_history WHERE instance_id = ? ORDER BY timestamp DESC`,
          [instanceId]
        );
        const parsed = history.map(h => ({
          id: h.id,
          instance_id: h.instance_id,
          interaction: h.interaction,
          result: h.result,
          tools_used: h.tools_used ? JSON.parse(h.tools_used) : [],
          events_emitted: h.events_emitted ? JSON.parse(h.events_emitted) : [],
          timestamp: h.timestamp,
          success: h.success === 1
        }));
        return Response.json(parsed);
      }

      // Handle POST /api/todo/ai-instances/:id/execute
      if (req.method === 'POST' && url.pathname.includes('/execute')) {
        await this.executeTaskInstance(instanceId);
        return Response.json({ success: true });
      }

      if (req.method === 'GET') {
        const instances = await this.api.db.query<{
          id: string;
          template_id: string;
          card_id: string;
          status: string;
          created_at: number;
          completed_at: number | null;
        }>(
          `SELECT * FROM kanban_ai_task_instances WHERE id = ?`,
          [instanceId]
        );
        if (instances.length === 0) return new Response('Instance not found', { status: 404 });
        return Response.json(instances[0]);
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] AI Instance API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleRulesAPI(req: Request): Promise<Response> {
    try {
      if (req.method === 'GET') {
        return Response.json({ rules: this.getTaskingRules() });
      }

      if (req.method === 'PUT') {
        const body = await req.json();
        await this.api.files.write('./tasking-rules.md', body.rules || '');
        await this.loadTaskingRules();
        return Response.json({ success: true });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Rules API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleCommandsAPI(req: Request): Promise<Response> {
    try {
      if (req.method === 'GET') {
        const status = new URL(req.url).searchParams.get('status');
        const query = status
          ? `SELECT * FROM kanban_command_queue WHERE status = ? ORDER BY created_at DESC`
          : `SELECT * FROM kanban_command_queue ORDER BY created_at DESC`;
        const params = status ? [status] : [];
        const commands = await this.api.db.query(query, params);
        return Response.json(commands);
      }

      if (req.method === 'POST') {
        const body = await req.json() as { instruction: string; priority?: 'low' | 'medium' | 'high'; source?: string };
        if (!body.instruction) {
          return Response.json({ error: 'instruction is required' }, { status: 400 });
        }
        this.api.events.emit("CommandReceived", {
          instruction: body.instruction,
          priority: body.priority || 'high',
          source: body.source || 'api',
        }, "todo-api");
        return Response.json({ queued: true, instruction: body.instruction }, { status: 202 });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Commands API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleCommandByIdAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split('/');
      const commandId = parts[parts.length - 1] || parts[parts.length - 2];

      if (req.method === 'GET') {
        const commands = await this.api.db.query(
          `SELECT * FROM kanban_command_queue WHERE id = ?`, [commandId]
        );
        if (commands.length === 0) return new Response('Not found', { status: 404 });
        return Response.json(commands[0]);
      }

      if (req.method === 'DELETE') {
        await this.api.db.execute(`DELETE FROM kanban_command_queue WHERE id = ?`, [commandId]);
        return Response.json({ deleted: true });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Command by ID API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private async handleEventsAPI(req: Request): Promise<Response> {
    try {
      if (req.method === 'GET') {
        const events = (this.api.events as any).getRegisteredEvents ? (this.api.events as any).getRegisteredEvents() : [];
        return Response.json(events);
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (error) {
      console.error('[Todo] Events API error:', error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }
}
