import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { kiosaTheme } from "../src/utils/theme.js";
import { getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaStylesheetLink } from "../src/utils/kiosa.js";

export interface SendTelegramMessagePayload {
  text: string;
  chatId?: string | number;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  source?: string;
}

interface TelegramSubscriptionConfig {
  enabled: boolean;
  defaultChatId?: string;
  defaultParseMode?: "HTML" | "Markdown" | "MarkdownV2";
}

/**
 * Telegram bridge: outbound sender for the SendTelegramMessage bus event,
 * plus the /telegram-subscription config page (default chat, parse mode).
 * Inbound polling was removed — messenger.ts owns the bot's getUpdates
 * long-poll (Telegram consumes the offset globally per bot, so two pollers
 * steal each other's updates).
 */
export default class TelegramSubscriptionAgent extends BaseDuty {
  private static readonly CONFIG_KEY = "telegram_subscription_config";
  private lastHomeFeedEmitAt = 0;

  constructor(api: DutyAPI) {
    super(api);
    this.registerRoutes();
    this.api.events.on("SendTelegramMessage", (data: unknown) => {
      this.handleSendTelegramMessage(data).catch((err) =>
        console.error("[telegram-subscription] SendTelegramMessage error:", err)
      );
    });
    console.log("[telegram-subscription] Outbound bridge ready. Listening for SendTelegramMessage");
    this.emitHomeFeed("Ready", "Outbound bridge ready");
    setTimeout(() => this.emitHomeFeed("Ready", "Outbound bridge ready"), 3000);
  }

  async execute(): Promise<void> {
    // Event-driven only — SendTelegramMessage listener does the work.
  }

  private emitHomeFeed(status: string, detail: string, priority = 81): void {
    const now = Date.now();
    if (now - this.lastHomeFeedEmitAt < 15_000) return;
    this.lastHomeFeedEmitAt = now;
    this.api.events.emit(
      "home-feed",
      {
        agent: "telegram_subscription",
        title: "Telegram Subscription",
        priority,
        updatedAt: new Date(now).toISOString(),
        html: `<div><strong>Telegram Subscription</strong><div>${status}</div><small>${detail}</small></div>`,
      },
      "telegram-subscription"
    );
  }

  private getDefaultConfig(): TelegramSubscriptionConfig {
    const cfg = this.api.config.getTelegram();
    return {
      enabled: true,
      defaultChatId: cfg.chatId ? String(cfg.chatId) : undefined,
      defaultParseMode: "HTML",
    };
  }

  private async getConfig(): Promise<TelegramSubscriptionConfig> {
    const raw = await this.api.memory.retrieve(TelegramSubscriptionAgent.CONFIG_KEY);
    const defaults = this.getDefaultConfig();
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(String(raw)) as Partial<TelegramSubscriptionConfig>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }

  private async saveConfig(next: TelegramSubscriptionConfig): Promise<void> {
    await this.api.memory.store(TelegramSubscriptionAgent.CONFIG_KEY, JSON.stringify(next));
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/telegram-subscription", this.handleConfigPage.bind(this));
    this.api.http.registerRoute("/api/telegram-subscription/config", this.handleConfigAPI.bind(this));
  }

  private async handleConfigPage(req: Request): Promise<Response> {
    if (req.method === "POST") {
      const form = await req.formData();
      const cfg: TelegramSubscriptionConfig = {
        enabled: form.get("enabled") === "on",
        defaultChatId: String(form.get("defaultChatId") || "").trim() || undefined,
        defaultParseMode: (String(form.get("defaultParseMode") || "HTML") as "HTML" | "Markdown" | "MarkdownV2"),
      };
      await this.saveConfig(cfg);
      this.emitHomeFeed("Config updated", `Default chat: ${cfg.defaultChatId ?? "none"}`);
      return Response.redirect("/telegram-subscription?saved=1", 303);
    }

    const cfg = await this.getConfig();
    const saved = new URL(req.url).searchParams.get("saved") === "1";
    const accent = getKiosaAccentForPath("/telegram-subscription");
    const accentHex = kiosaTheme.colors.accent;
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Telegram Subscription Config</title>
      ${getKiosaStylesheetLink(accent)}
<style>
        body { padding: 0; }
        .page { max-width: 720px; margin: 0 auto; padding: 1.25rem; }
        label { display: block; font-size: 12px; margin: 12px 0 6px; }
        .row { display: flex; gap: 12px; } .row > div { flex: 1; }
        .check { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
        .check input { width: auto; }
        .ok { padding: 8px; border-radius: 4px; margin-bottom: 10px; }
      </style></head><body>
      ${getKiosaTopbarHTML({ title: "RONIN", subtitle: "TELEGRAM", chips: [], tabs: [] })}
      <div class="page"><div class="ui-panel">
        ${saved ? '<div class="ok ui-badge ui-badge--success">Saved.</div>' : ""}
        <form method="POST" action="/telegram-subscription">
          <div class="check"><input id="enabled" name="enabled" type="checkbox" ${cfg.enabled ? "checked" : ""}/><label for="enabled" style="margin:0">Enabled</label></div>
          <div class="row">
            <div><label for="defaultParseMode">Default parse mode</label>
              <select class="ui-input" id="defaultParseMode" name="defaultParseMode">
                <option value="HTML" ${cfg.defaultParseMode === "HTML" ? "selected" : ""}>HTML</option>
                <option value="Markdown" ${cfg.defaultParseMode === "Markdown" ? "selected" : ""}>Markdown</option>
                <option value="MarkdownV2" ${cfg.defaultParseMode === "MarkdownV2" ? "selected" : ""}>MarkdownV2</option>
              </select>
            </div>
          </div>
          <label for="defaultChatId">Default outbound chat ID (optional override)</label>
          <input class="ui-input" id="defaultChatId" name="defaultChatId" value="${cfg.defaultChatId ?? ""}" placeholder="e.g. -1001234567890"/>
          <button class="ui-btn ui-btn--primary" type="submit" style="margin-top:14px">Save</button>
        </form>
        <p style="font-size:12px;margin-top:14px">Schedule is managed via <a href="/schedule">/schedule</a>.</p>
      </div></div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  private async handleConfigAPI(req: Request): Promise<Response> {
    if (req.method === "GET") return Response.json(await this.getConfig());
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Partial<TelegramSubscriptionConfig>;
      const current = await this.getConfig();
      const next: TelegramSubscriptionConfig = {
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        defaultChatId: typeof body.defaultChatId === "string" && body.defaultChatId.trim() ? body.defaultChatId.trim() : current.defaultChatId,
        defaultParseMode: body.defaultParseMode || current.defaultParseMode,
      };
      await this.saveConfig(next);
      return Response.json({ ok: true, config: next });
    }
    return new Response("Method not allowed", { status: 405 });
  }

  /**
   * Handle outbound SendTelegramMessage event: resolve botId/chatId and send.
   */
  private async handleSendTelegramMessage(data: unknown): Promise<void> {
    if (!this.api.telegram) {
      console.warn("[telegram-subscription] Telegram plugin not available, skipping SendTelegramMessage");
      return;
    }
    const payload = data as SendTelegramMessagePayload;
    if (!payload?.text || typeof payload.text !== "string") {
      console.warn("[telegram-subscription] SendTelegramMessage missing text");
      return;
    }
    const configTelegram = this.api.config.getTelegram();
    const token =
      configTelegram.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      ((await this.api.memory.retrieve("telegram_bot_token")) as string | undefined);
    if (!token) {
      console.warn("[telegram-subscription] No Telegram token, skipping send");
      return;
    }
    let botId = (await this.api.memory.retrieve("telegram_bot_id")) as string | undefined;
    if (!botId) {
      try {
        botId = await this.api.telegram.initBot(token);
        await this.api.memory.store("telegram_bot_id", botId);
      } catch (err) {
        console.error("[telegram-subscription] Failed to init bot for send:", err);
        return;
      }
    }
    let chatId: string | number | undefined = payload.chatId;
    const subConfig = await this.getConfig();
    if (chatId == null) {
      chatId = (await this.api.memory.retrieve("telegram_chat_id")) as string | number | undefined;
      if (chatId == null) chatId = subConfig.defaultChatId ?? configTelegram.chatId;
    }
    if (chatId == null) {
      console.warn("[telegram-subscription] No chatId in payload or default, skipping send");
      return;
    }
    const doSend = async (): Promise<void> => {
      await this.api.telegram!.sendMessage(botId!, chatId!, payload.text, {
        parseMode: payload.parseMode ?? subConfig.defaultParseMode,
      });
    };
    try {
      await doSend();
      if (payload.source) {
        console.log(`[telegram-subscription] Sent message (source: ${payload.source})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Bot not initialized")) {
        console.log("[telegram-subscription] Bot not in plugin map (e.g. after restart), re-initializing…");
        try {
          botId = await this.api.telegram!.initBot(token);
          await this.api.memory.store("telegram_bot_id", botId);
          await doSend();
          if (payload.source) {
            console.log(`[telegram-subscription] Sent message (source: ${payload.source})`);
          }
        } catch (retryErr) {
          console.error("[telegram-subscription] Failed to send message after re-init:", retryErr);
        }
      } else {
        console.error("[telegram-subscription] Failed to send message:", err);
      }
    }
  }
}
