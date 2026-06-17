import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

interface TelegramWatcherConfig {
  enabled: boolean;
  sourceChats: string[];
  targetChat: string;
  rewriteModel: string;
  parseMode: "HTML" | "Markdown" | "MarkdownV2";
  maxContextItems: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    chat: { id: number; type: string; title?: string; username?: string };
    text?: string;
    caption?: string;
    date: number;
  };
}

type WatcherPostRow = {
  id: number;
  source_chat_id: string;
  source_chat_name: string | null;
  source_message_id: number;
  original_text: string;
  rewritten_text: string;
  keywords_json: string | null;
  created_at: number;
  update_id: number;
};

const CONFIG_KEY = "telegram_watcher_config";
const BOT_ID_KEY = "telegram_watcher_bot_id";
const PERSONA_FILE = "telegram-watcher.persona.md";
const WATCHER_SOURCE = "telegram-watcher";
const MAX_REWRITE_INPUT = 3000;
const MAX_REWRITE_OUTPUT = 3500;
const registeredBots = new Set<string>();
const seenUpdates = new Map<number, number>();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSourceEntry(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) return trimmed.toLowerCase();
  return trimmed;
}

function splitSourceChats(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((v) => normalizeSourceEntry(v))
    .filter(Boolean);
}

function extractKeywords(text: string): string[] {
  const stop = new Set([
    "that","this","with","from","have","will","about","there","their","they","your","just","into","over","under","after","before","when","where","what","which","while","then","than","because","could","would","should","https","http","www"
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 3 && !stop.has(w));
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

export default class TelegramWatcherAgent extends BaseDuty {
  static schedule = "*/5 * * * *";
  private lastHomeFeedEmitAt = 0;

  constructor(api: DutyAPI) {
    super(api);
    this.registerRoutes();
    this.emitHomeFeed("Ready", "Watcher initialized");
  }

  async execute(): Promise<void> {
    try {
      const cfg = await this.getConfig();
      await this.ensureSchema();
      await this.ensurePersonaFile();
      if (!cfg.enabled) {
        this.emitHomeFeed("Disabled", "Watcher disabled");
        return;
      }
      const botId = await this.ensureBot();
      if (!botId) return;
      this.registerMessageHandler(botId);
      this.emitHomeFeed("Watching", `${cfg.sourceChats.length} source chats -> ${cfg.targetChat || "(no target)"}`);
    } catch (error) {
      const msg =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : typeof error === "object"
            ? JSON.stringify(error)
            : String(error);
      console.error("[telegram-watcher] execute failed:", msg);
      this.emitHomeFeed("Error", msg.slice(0, 160), 90);
    }
  }

  private getDefaultConfig(): TelegramWatcherConfig {
    const t = this.api.config.getTelegram();
    return {
      enabled: true,
      sourceChats: [],
      targetChat: t.chatId ? String(t.chatId) : "",
      rewriteModel: "smart",
      parseMode: "HTML",
      maxContextItems: 3,
    };
  }

  private async getConfig(): Promise<TelegramWatcherConfig> {
    const raw = await this.api.memory.retrieve(CONFIG_KEY);
    const defaults = this.getDefaultConfig();
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(String(raw)) as Partial<TelegramWatcherConfig>;
      return {
        ...defaults,
        ...parsed,
        sourceChats: Array.isArray(parsed.sourceChats)
          ? parsed.sourceChats.map((v) => normalizeSourceEntry(String(v))).filter(Boolean)
          : defaults.sourceChats,
        maxContextItems: Number.isFinite(Number(parsed.maxContextItems))
          ? Math.max(0, Math.min(6, Number(parsed.maxContextItems)))
          : defaults.maxContextItems,
      };
    } catch {
      return defaults;
    }
  }

  private async saveConfig(next: TelegramWatcherConfig): Promise<void> {
    await this.api.memory.store(CONFIG_KEY, JSON.stringify(next));
  }

  private getPersonaPath(): string {
    return join(homedir(), ".ronin", PERSONA_FILE);
  }

  private async ensurePersonaFile(): Promise<void> {
    const path = this.getPersonaPath();
    const dir = join(homedir(), ".ronin");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    if (existsSync(path)) return;
    const starter = `# Telegram Watcher Persona

You are an intelligence-focused analyst rewriting inbound Telegram channel reports.

Style guidance:
- concise, factual, and neutral by default
- emphasize operational relevance and confidence
- preserve key facts (who/what/where/when), avoid invented details
- include useful context links to related prior reports when provided
`;
    await writeFile(path, starter, "utf-8");
  }

  private async readPersona(): Promise<string> {
    await this.ensurePersonaFile();
    return readFile(this.getPersonaPath(), "utf-8");
  }

  private async ensureSchema(): Promise<void> {
    await this.api.db.execute(
      `CREATE TABLE IF NOT EXISTS telegram_watcher_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        update_id INTEGER UNIQUE NOT NULL,
        source_chat_id TEXT NOT NULL,
        source_chat_name TEXT,
        source_message_id INTEGER NOT NULL,
        target_chat_id TEXT NOT NULL,
        original_text TEXT NOT NULL,
        rewritten_text TEXT NOT NULL,
        keywords_json TEXT,
        created_at INTEGER NOT NULL
      )`
    );
    await this.api.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_telegram_watcher_posts_created_at ON telegram_watcher_posts(created_at DESC)`
    );
  }

  private async ensureBot(): Promise<string | null> {
    if (!this.api.telegram) {
      this.emitHomeFeed("Error", "Telegram plugin not available");
      return null;
    }
    const t = this.api.config.getTelegram();
    const token = t.botToken || process.env.TELEGRAM_BOT_TOKEN || (await this.api.memory.retrieve("telegram_bot_token")) as string | undefined;
    if (!token) {
      this.emitHomeFeed("Blocked", "Missing bot token");
      return null;
    }
    let botId = (await this.api.memory.retrieve(BOT_ID_KEY)) as string | undefined;
    if (botId) {
      try {
        await this.api.telegram.getBotInfo(botId);
      } catch {
        botId = undefined;
      }
    }
    if (!botId) {
      try {
        botId = await this.api.telegram.initBot(token);
        await this.api.memory.store(BOT_ID_KEY, botId);
      } catch (error) {
        console.error("[telegram-watcher] initBot failed:", error);
        this.emitHomeFeed("Error", "Bot initialization failed");
        return null;
      }
    }
    return botId;
  }

  private registerMessageHandler(botId: string): void {
    if (registeredBots.has(botId)) return;
    this.api.telegram?.onMessage(botId, (update: TelegramUpdate) => {
      this.processUpdate(botId, update).catch((error) => {
        console.error("[telegram-watcher] process update failed:", error);
        this.emitHomeFeed("Error", error instanceof Error ? error.message.slice(0, 120) : "Processing failed");
      });
    });
    registeredBots.add(botId);
  }

  private isSourceMatch(chat: { id: number; username?: string; title?: string }, sourceChats: string[]): boolean {
    if (sourceChats.length === 0) return false;
    const id = String(chat.id);
    const username = chat.username ? `@${chat.username.toLowerCase()}` : "";
    const title = chat.title ? chat.title.toLowerCase() : "";
    return sourceChats.some((entry) => {
      const e = normalizeSourceEntry(entry);
      return e === id || (!!username && e === username) || (!!title && e === title);
    });
  }

  private cleanSeenUpdates(): void {
    const now = Date.now();
    if (seenUpdates.size < 500) return;
    for (const [id, ts] of seenUpdates) {
      if (now - ts > 10 * 60_000) seenUpdates.delete(id);
    }
  }

  private async processUpdate(botId: string, update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg) return;
    this.cleanSeenUpdates();
    if (seenUpdates.has(update.update_id)) return;
    seenUpdates.set(update.update_id, Date.now());

    const cfg = await this.getConfig();
    if (!cfg.enabled) return;
    if (!this.isSourceMatch(msg.chat, cfg.sourceChats)) return;
    if (!cfg.targetChat) {
      this.emitHomeFeed("Blocked", "No target chat configured");
      return;
    }

    const text = (msg.text || msg.caption || "").trim();
    if (!text) return;

    const rewritten = await this.rewriteWithPersona(text, msg.chat, cfg);
    const finalText = rewritten.slice(0, MAX_REWRITE_OUTPUT);
    await this.api.telegram!.sendMessage(botId, cfg.targetChat, finalText, { parseMode: cfg.parseMode });
    await this.persistPost(update, msg, cfg.targetChat, text, finalText);
    this.emitHomeFeed("Reposted", `${msg.chat.title || msg.chat.username || msg.chat.id} -> ${cfg.targetChat}`);
  }

  private async getRelatedContext(keywords: string[], limit: number): Promise<WatcherPostRow[]> {
    if (limit <= 0 || keywords.length === 0) return [];
    const rows = await this.api.db.query<WatcherPostRow>(
      `SELECT id, source_chat_id, source_chat_name, source_message_id, original_text, rewritten_text, keywords_json, created_at, update_id
       FROM telegram_watcher_posts ORDER BY created_at DESC LIMIT 80`
    );
    const scored = rows
      .map((row) => {
        const rowKeywords = row.keywords_json ? (JSON.parse(row.keywords_json) as string[]) : [];
        const overlap = rowKeywords.filter((k) => keywords.includes(k)).length;
        return { row, overlap };
      })
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit)
      .map((x) => x.row);
    return scored;
  }

  private async rewriteWithPersona(
    incomingText: string,
    chat: { id: number; title?: string; username?: string },
    cfg: TelegramWatcherConfig
  ): Promise<string> {
    const persona = await this.readPersona();
    const keywords = extractKeywords(incomingText);
    const related = await this.getRelatedContext(keywords, cfg.maxContextItems);
    const relatedBlock = related.length
      ? related
          .map((r, idx) => `${idx + 1}) ${r.source_chat_name || r.source_chat_id}: ${r.rewritten_text.slice(0, 260)}`)
          .join("\n")
      : "None";
    const sourceName = chat.title || chat.username || String(chat.id);
    const prompt = `Persona:
${persona}

Task:
Rewrite the inbound Telegram report in the persona style while preserving factual content.
Output ONLY the rewritten post text, ready to publish.
Do not invent facts. Keep it concise and useful.
If relevant, incorporate historical context from related posts.

Source: ${sourceName}
Incoming report:
${incomingText.slice(0, MAX_REWRITE_INPUT)}

Related prior posts:
${relatedBlock}`;
    try {
      const response = await this.api.ai.complete(prompt, { model: cfg.rewriteModel || "smart", maxTokens: 900 });
      if (response?.trim()) return response.trim();
      return incomingText;
    } catch (error) {
      console.error("[telegram-watcher] rewrite failed:", error);
      return incomingText;
    }
  }

  private async persistPost(
    update: TelegramUpdate,
    msg: NonNullable<TelegramUpdate["message"]>,
    targetChat: string,
    original: string,
    rewritten: string
  ): Promise<void> {
    const keywords = extractKeywords(original);
    await this.api.db.execute(
      `INSERT OR IGNORE INTO telegram_watcher_posts
      (update_id, source_chat_id, source_chat_name, source_message_id, target_chat_id, original_text, rewritten_text, keywords_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        update.update_id,
        String(msg.chat.id),
        msg.chat.title || msg.chat.username || null,
        msg.message_id,
        targetChat,
        original,
        rewritten,
        JSON.stringify(keywords),
        Date.now(),
      ]
    );
  }

  private emitHomeFeed(status: string, detail: string, priority = 81): void {
    const now = Date.now();
    if (now - this.lastHomeFeedEmitAt < 5000) return;
    this.lastHomeFeedEmitAt = now;
    this.api.events.emit(
      "home-feed",
      {
        agent: "telegram-watcher",
        title: "Telegram Watcher",
        priority,
        updatedAt: new Date(now).toISOString(),
        html: `<div><strong>Telegram Watcher</strong><div>${escapeHtml(status)}</div><small>${escapeHtml(detail)}</small></div>`,
      },
      WATCHER_SOURCE
    );
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/telegram-watcher", this.handleConfigPage.bind(this));
    this.api.http.registerRoute("/telegram-watcher/persona", this.handlePersonaPage.bind(this));
    this.api.http.registerRoute("/api/telegram-watcher/config", this.handleConfigAPI.bind(this));
    this.api.http.registerRoute("/api/telegram-watcher/posts", this.handlePostsAPI.bind(this));
  }

  private async handleConfigPage(req: Request): Promise<Response> {
    if (req.method === "POST") {
      const form = await req.formData();
      const current = await this.getConfig();
      const next: TelegramWatcherConfig = {
        enabled: form.get("enabled") === "on",
        sourceChats: splitSourceChats(String(form.get("sourceChats") || "")),
        targetChat: String(form.get("targetChat") || "").trim(),
        rewriteModel: String(form.get("rewriteModel") || current.rewriteModel || "smart").trim() || "smart",
        parseMode: (String(form.get("parseMode") || "HTML") as TelegramWatcherConfig["parseMode"]),
        maxContextItems: Math.max(0, Math.min(6, Number(form.get("maxContextItems") || current.maxContextItems))),
      };
      await this.saveConfig(next);
      this.emitHomeFeed("Config updated", `${next.sourceChats.length} sources -> ${next.targetChat || "(none)"}`);
      return Response.redirect("/telegram-watcher?saved=1", 303);
    }
    const cfg = await this.getConfig();
    const saved = new URL(req.url).searchParams.get("saved") === "1";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Telegram Watcher</title>
      <style>body{font-family:Arial;background:#111;color:#eee;padding:20px}.card{max-width:820px;margin:auto;background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:16px}textarea,input,select{width:100%;background:#111;border:1px solid #333;color:#eee;border-radius:6px;padding:8px}label{display:block;color:#aaa;font-size:12px;margin:10px 0 6px}.check{display:flex;gap:8px;align-items:center;margin:8px 0}.check input{width:auto}button{background:#84cc16;color:#111;border:0;padding:10px 14px;border-radius:6px;font-weight:700;cursor:pointer;margin-top:12px}a{color:#84cc16}.ok{background:#16320d;border:1px solid #2d6a1f;color:#9be67a;padding:8px;border-radius:6px;margin-bottom:10px}</style></head><body><div class="card">
      <h1>Telegram Watcher</h1>
      ${saved ? '<div class="ok">Saved.</div>' : ""}
      <form method="POST" action="/telegram-watcher">
      <div class="check"><input id="enabled" name="enabled" type="checkbox" ${cfg.enabled ? "checked" : ""}><label for="enabled" style="margin:0">Enabled</label></div>
      <label for="sourceChats">Source chats/channels (IDs or @usernames, comma/newline separated)</label>
      <textarea id="sourceChats" name="sourceChats" rows="5">${escapeHtml(cfg.sourceChats.join("\n"))}</textarea>
      <label for="targetChat">Target chat/channel ID</label>
      <input id="targetChat" name="targetChat" value="${escapeHtml(cfg.targetChat)}" placeholder="-1001234567890">
      <label for="rewriteModel">Rewrite model</label>
      <input id="rewriteModel" name="rewriteModel" value="${escapeHtml(cfg.rewriteModel)}" placeholder="smart">
      <label for="parseMode">Parse mode</label>
      <select id="parseMode" name="parseMode">
        <option value="HTML" ${cfg.parseMode === "HTML" ? "selected" : ""}>HTML</option>
        <option value="Markdown" ${cfg.parseMode === "Markdown" ? "selected" : ""}>Markdown</option>
        <option value="MarkdownV2" ${cfg.parseMode === "MarkdownV2" ? "selected" : ""}>MarkdownV2</option>
      </select>
      <label for="maxContextItems">Related context items (0-6)</label>
      <input id="maxContextItems" name="maxContextItems" type="number" min="0" max="6" value="${cfg.maxContextItems}">
      <button type="submit">Save</button>
      </form>
      <p style="font-size:12px;color:#888;margin-top:12px">Edit persona: <a href="/telegram-watcher/persona">/telegram-watcher/persona</a></p>
      </div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  private async handlePersonaPage(req: Request): Promise<Response> {
    if (req.method === "POST") {
      const form = await req.formData();
      const content = String(form.get("content") || "");
      await writeFile(this.getPersonaPath(), content, "utf-8");
      this.emitHomeFeed("Persona updated", PERSONA_FILE);
      return Response.redirect("/telegram-watcher/persona?saved=1", 303);
    }
    const content = await this.readPersona();
    const saved = new URL(req.url).searchParams.get("saved") === "1";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Telegram Watcher Persona</title>
      <style>body{font-family:Arial;background:#111;color:#eee;padding:20px}.card{max-width:860px;margin:auto;background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:16px}textarea{width:100%;height:65vh;background:#111;border:1px solid #333;color:#eee;border-radius:6px;padding:10px;font-family:ui-monospace,Menlo,monospace;font-size:12px}button{background:#84cc16;color:#111;border:0;padding:10px 14px;border-radius:6px;font-weight:700;cursor:pointer;margin-top:12px}.ok{background:#16320d;border:1px solid #2d6a1f;color:#9be67a;padding:8px;border-radius:6px;margin-bottom:10px}a{color:#84cc16}</style></head><body><div class="card">
      <h1>telegram-watcher.persona.md</h1>
      ${saved ? '<div class="ok">Saved.</div>' : ""}
      <form method="POST" action="/telegram-watcher/persona">
      <textarea name="content">${escapeHtml(content)}</textarea>
      <div><button type="submit">Save Persona</button> <a href="/telegram-watcher" style="margin-left:12px">Back</a></div>
      </form></div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  private async handleConfigAPI(req: Request): Promise<Response> {
    if (req.method === "GET") return Response.json(await this.getConfig());
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Partial<TelegramWatcherConfig>;
      const current = await this.getConfig();
      const next: TelegramWatcherConfig = {
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        sourceChats: Array.isArray(body.sourceChats) ? body.sourceChats.map((v) => normalizeSourceEntry(String(v))).filter(Boolean) : current.sourceChats,
        targetChat: typeof body.targetChat === "string" ? body.targetChat.trim() : current.targetChat,
        rewriteModel: typeof body.rewriteModel === "string" && body.rewriteModel.trim() ? body.rewriteModel.trim() : current.rewriteModel,
        parseMode: body.parseMode || current.parseMode,
        maxContextItems: Number.isFinite(Number(body.maxContextItems)) ? Math.max(0, Math.min(6, Number(body.maxContextItems))) : current.maxContextItems,
      };
      await this.saveConfig(next);
      return Response.json({ ok: true, config: next });
    }
    return new Response("Method not allowed", { status: 405 });
  }

  private async handlePostsAPI(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    await this.ensureSchema();
    const limit = Math.max(1, Math.min(100, Number(new URL(req.url).searchParams.get("limit") || "20")));
    const rows = await this.api.db.query<WatcherPostRow>(
      `SELECT id, source_chat_id, source_chat_name, source_message_id, original_text, rewritten_text, keywords_json, created_at, update_id
       FROM telegram_watcher_posts ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return Response.json(rows);
  }
}
