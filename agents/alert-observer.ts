import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

/**
 * Alert Observer Agent
 * 
 * Listens to all plan events and sends notifications
 * Pure observer - no state mutation
 */
export default class AlertObserverAgent extends BaseAgent {
  private botId: string | null = null;
  private chatId: string | number | null = null;

  constructor(api: AgentAPI) {
    super(api);
    this.initializeBot();
    this.registerEventHandlers();
    console.log("🔔 Alert Observer ready. Listening for plan events...");
  }

  /**
   * Initialize Telegram bot for alerts
   */
  private async initializeBot(): Promise<void> {
    try {
      // Get config from centralized config service first, then fallback to env/memory
      const configTelegram = this.api.config.getTelegram();
      const botToken = configTelegram.botToken || 
        process.env.TELEGRAM_BOT_TOKEN || 
        await this.api.memory.retrieve("telegram_bot_token");
      const chatId = configTelegram.chatId ||
        process.env.TELEGRAM_CHAT_ID ||
        await this.api.memory.retrieve("telegram_chat_id");
      
      if (!botToken || !chatId) {
        console.log("[alert-observer] Telegram not configured, alerts disabled");
        return;
      }

      this.botId = await this.api.telegram.initBot(botToken as string);
      this.chatId = chatId as string | number;
      console.log("[alert-observer] Telegram alerts enabled");
    } catch (error) {
      console.error("[alert-observer] Failed to initialize Telegram:", error);
    }
  }

  /**
   * Register event handlers for all plan events
   */
  private registerEventHandlers(): void {
    // Plan proposed
    this.api.events.on("PlanProposed", (data: unknown) => {
      const payload = data as { id: string; title: string; source: string };
      this.sendAlert("📋 Plan Proposed", payload.title, payload.id, "🆕");
    });

    // Plan approved
    this.api.events.on("PlanApproved", (data: unknown) => {
      const payload = data as { id: string; title?: string };
      this.sendAlert("✅ Plan Approved", payload.title || "N/A", payload.id, "🚀");
    });

    // Plan completed
    this.api.events.on("PlanCompleted", (data: unknown) => {
      const payload = data as { id: string; title?: string; result?: string };
      this.sendAlert("🎉 Plan Completed", payload.title || "N/A", payload.id, "✨");
    });

    // Plan failed
    this.api.events.on("PlanFailed", (data: unknown) => {
      const payload = data as { id: string; title?: string; error?: string };
      this.sendAlert("❌ Plan Failed", payload.title || "N/A", payload.id, "💥", payload.error);
    });

    // Plan rejected
    this.api.events.on("PlanRejected", (data: unknown) => {
      const payload = data as { id: string; title?: string; reason?: string };
      this.sendAlert("🚫 Plan Rejected", payload.title || "N/A", payload.id, "⛔", payload.reason);
    });

    // Plan blocked
    this.api.events.on("PlanBlocked", (data: unknown) => {
      const payload = data as { id: string; title?: string; reason?: string };
      this.sendAlert("🚧 Plan Blocked", payload.title || "N/A", payload.id, "⚠️", payload.reason);
    });

    console.log("[alert-observer] Event handlers registered");
  }

  /**
   * Send alert notification
   */
  private async sendAlert(
    status: string,
    title: string,
    planId: string,
    emoji: string,
    details?: string
  ): Promise<void> {
    const message = `${emoji} <b>${status}</b>\n\n` +
      `<b>Title:</b> ${title}\n` +
      `<b>ID:</b> <code>${planId}</code>\n` +
      `<b>Time:</b> ${new Date().toLocaleString()}` +
      (details ? `\n\n<b>Details:</b> ${details}` : "");

    // Log to console
    console.log(`[alert-observer] ${status}: ${title} (${planId})`);

    // Send Telegram notification if configured
    if (this.botId && this.chatId) {
      try {
        await this.api.telegram.sendMessage(
          this.botId,
          this.chatId,
          message,
          { parseMode: "HTML" }
        );
      } catch (error) {
        console.error("[alert-observer] Failed to send Telegram alert:", error);
      }
    }
  }

  async execute(): Promise<void> {
    // Event-driven agent
    console.log("[alert-observer] Running...");
  }
}
