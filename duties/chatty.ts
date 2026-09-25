import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import type { Tool } from "../src/types/api.js";
import { standardSAR } from "../src/chains/templates.js";
import { ensureRoninDataDir } from "../src/utils/paths.js";
import { hankoTheme, getSharedUIPrimitivesCSS, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";
import {
  getRoninContext,
  buildSystemPrompt,
  buildToolPrompt,
  windowMessages,
  invalidateChatSummary,
  injectMermaidLinkIntoResponse,
  injectContractProposalCardIntoResponse,
  injectWorkflowProposalCardIntoResponse,
  injectDutyProposalCardIntoResponse,
} from "../src/utils/prompt.js";
import { discoverWorkflow } from "../src/workflow/discovery.js";
import { loadToolContext, expandToolContextForCategory } from "../src/tools/toolDocs.js";
import { getOrCreateRouteToken, hasValidRouteToken, isLocalRequest } from "../plugins/cloudflare/src/routeToken.js";
import { renderProviderIconSvg, getProviderVisual } from "../src/utils/providerIcons.js";
import { ArtifactStore } from "../src/artifacts/store.js";
import { parseReActToolCalls } from "../src/utils/reactTools.js";
import { registerArtifactRoutes, registerArtifactAssetRoute } from "../src/artifacts/tools.js";
import { runArtifactMigrations } from "../src/artifacts/migrations.js";
import { getArtifactAssetsDir, sanitizeAssetFilename, resolveStoredAssetPath } from "../src/artifacts/storage.js";

/** Server-side HTML escaping for values interpolated into the page shell (not the embedded client script). */
function escapeHtmlServer(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Chat {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  metadata?: string;
}

interface ChatMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

/**
 * Chatty Agent - Context-aware chat interface for Ronin
 * Provides /chat UI and /api/chat endpoint for chatting with AI
 * that understands Ronin's architecture, agents, plugins, and routes
 */
export default class ChattyAgent extends BaseDuty {
  private localModel: string;
  private toolModel: string;
  private chatCount = 0;
  private readonly maxToolIterations = 3;
  private readonly maxToolsPerIteration = 4;
  private lastHomeFeedEmitAt = 0;

  private normalizeRequestedModel(model?: string): string | undefined {
    if (!model) return undefined;
    const m = model.trim().toLowerCase();
    if (!m || m === "local" || m === "ollama") return undefined;
    if (m === "cloud" || m === "ninja") return "smart";
    return model.trim();
  }

  /**
   * Detect @ninja tag in message text. Returns the cleaned message and whether ninja mode was requested.
   */
  private static extractNinjaTag(message: string): { cleaned: string; ninja: boolean } {
    const ninjaPattern = /\s*@ninja\b\s*/gi;
    if (ninjaPattern.test(message)) {
      return { cleaned: message.replace(/\s*@ninja\b\s*/gi, " ").trim(), ninja: true };
    }
    return { cleaned: message, ninja: false };
  }

  constructor(api: DutyAPI) {
    super(api);
    this.localModel = this.resolveLocalModel();
    this.toolModel = this.resolveToolModel();
    this.initializeDatabase();
    this.registerRoutes();

    // Analytics: report lifecycle
    this.api.events.emit("agent.lifecycle", {
      agent: "chatty", status: "started", timestamp: Date.now(),
    }, "chatty");
    this.emitHomeFeed("Ready", "Chat UI online");
    setTimeout(() => this.emitHomeFeed("Ready", "Chat UI online"), 3000);

    console.log(`💬 Chatty agent ready. Local model: ${this.localModel}, Tool model: ${this.toolModel}`);
  }

  /** Local model for general chat — fast, low-latency. */
  private resolveLocalModel(): string {
    const ai = this.api.config.getAI();
    return ai.models?.default ?? ai.ollamaModel ?? "ministral-3:3b";
  }

  /** Smart model for tool-calling rounds where accuracy matters. */
  private resolveToolModel(): string {
    const ai = this.api.config.getAI();
    if (ai.provider === "ollama" && (ai.ollamaSmartUrl ?? "").trim() && ai.models?.smart) {
      return "smart";
    }
    return ai.models?.default ?? ai.ollamaModel ?? "ministral-3:3b";
  }

  /**
   * Initialize database tables for chats and messages
   */
  private async initializeDatabase(): Promise<void> {
    try {
      // Create chats table
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          metadata TEXT
        )
      `);

      // Create chat_messages table
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
        )
      `);

      // Create indexes
      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id)
      `);
      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at)
      `);
    } catch (error) {
      console.error("[Chatty] Failed to initialize database:", error);
    }
  }

  /**
   * Create a new chat
   */
  private async createChat(title: string = "New Chat"): Promise<Chat> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.api.db.execute(
      `INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [id, title, now, now]
    );
    return { id, title, created_at: now, updated_at: now };
  }

  /**
   * Get all chats sorted by updated_at (most recent first)
   */
  private async getChats(): Promise<Chat[]> {
    return await this.api.db.query<Chat>(
      `SELECT * FROM chats ORDER BY updated_at DESC`
    );
  }

  /**
   * Get a single chat by ID
   */
  private async getChat(chatId: string): Promise<Chat | null> {
    const chats = await this.api.db.query<Chat>(
      `SELECT * FROM chats WHERE id = ?`,
      [chatId]
    );
    return chats[0] || null;
  }

  /**
   * Get all messages for a chat
   */
  private async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    return await this.api.db.query<ChatMessage>(
      `SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC`,
      [chatId]
    );
  }

  /**
   * Add a message to a chat
   */
  private async addMessage(chatId: string, role: "user" | "assistant", content: string): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.api.db.execute(
      `INSERT INTO chat_messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, chatId, role, content, now]
    );
    // Update chat's updated_at timestamp
    await this.api.db.execute(
      `UPDATE chats SET updated_at = ? WHERE id = ?`,
      [now, chatId]
    );
  }

  /**
   * Delete a chat and all its messages
   */
  private async deleteChat(chatId: string): Promise<void> {
    await this.api.db.execute(`DELETE FROM chats WHERE id = ?`, [chatId]);
  }

  /**
   * Update chat title
   */
  private async updateChatTitle(chatId: string, title: string): Promise<void> {
    await this.api.db.execute(
      `UPDATE chats SET title = ?, updated_at = ? WHERE id = ?`,
      [title, Date.now(), chatId]
    );
  }

  /**
   * Generate a title from the first user message
   */
  private generateTitle(message: string): string {
    // Simple truncation - can be enhanced with AI later
    const maxLength = 50;
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength).trim() + "...";
  }

  async execute(): Promise<void> {
    // Chatty is route-driven, so execute() can be empty
    // Ensure Ollama and model are ready
    try {
      const modelExists = await this.api.ai.complete("test", { model: this.localModel, maxTokens: 1 }).catch(() => null);
      if (!modelExists) {
        console.log(`⚠️  Model ${this.localModel} may not be available. Ensure Ollama is running and model is pulled.`);
      }
    } catch (error) {
      console.warn("Could not verify model availability:", error);
    }
  }

  private emitHomeFeed(status: string, detail: string, priority = 90): void {
    const now = Date.now();
    if (now - this.lastHomeFeedEmitAt < 2000) return;
    this.lastHomeFeedEmitAt = now;
    this.api.events.emit(
      "home-feed",
      {
        agent: "chatty",
        title: "Chatty",
        priority,
        updatedAt: new Date(now).toISOString(),
        html: `<div><strong>Chatty</strong><div>${status}</div><small>${detail}</small></div>`,
      },
      "chatty"
    );
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/chat", this.handleChatUI.bind(this));
    this.api.http.registerRoute("/api/chat", this.handleChatAPI.bind(this));
    this.api.http.registerRoute("/api/chats", this.handleChatsAPI.bind(this));
    // Register route with trailing slash for prefix matching (handles /api/chats/xxx)
    this.api.http.registerRoute("/api/chats/", this.handleChatByIdAPI.bind(this));
    // PWA install support — manifest, service worker, icon.
    this.api.http.registerRoute("/chat/manifest.json", this.handleManifest.bind(this));
    this.api.http.registerRoute("/chat/sw.js", this.handleServiceWorker.bind(this));
    this.api.http.registerRoute("/chat/icon.svg", this.handleIcon.bind(this));
    // Voice input/output for the chat UI.
    this.api.http.registerRoute("/api/chat/transcribe", this.handleTranscribe.bind(this));
    this.api.http.registerRoute("/api/chat/speak", this.handleSpeak.bind(this));
    // Files panel — save a chat-session file into the real Artifact library, and browse it.
    this.api.http.registerRoute("/api/chat/artifact/save", this.handleArtifactSave.bind(this));
    this.api.http.registerRoute("/api/chat/artifact/library", this.handleArtifactLibrary.bind(this));
    this.api.http.registerRoute("/api/chat/artifact/load", this.handleArtifactLoad.bind(this));
  }

  /** Text-ish extensions the /chat files panel will inline as content; anything else is download-only via its asset URL. */
  private static readonly TEXT_ASSET_EXTENSIONS = new Set([
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h",
    ".css", ".scss", ".html", ".htm", ".xml", ".svg", ".sh", ".bash", ".yaml", ".yml", ".toml", ".ini",
    ".json", ".md", ".txt", ".csv", ".sql",
  ]);

  /**
   * Creates a new artifact (or appends to an existing one) from a file shown
   * in the /chat files panel — the direct, button-triggered equivalent of the
   * artifact_create + artifact_addAsset tools, bypassing the LLM tool-call
   * layer since this is a plain UI action, not a model decision.
   */
  private async handleArtifactSave(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let body: { name?: string; filename?: string; content?: string; artifactId?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body.filename || typeof body.content !== "string") {
      return Response.json({ error: "filename and content are required" }, { status: 400 });
    }

    try {
      await runArtifactMigrations(this.api.db);
      const store = new ArtifactStore(this.api);
      let artifactId = body.artifactId;

      if (artifactId && !(await store.load(artifactId))) {
        artifactId = undefined; // stale id (e.g. from a since-cleared session) — fall through to create
      }
      if (!artifactId) {
        const created = await store.create({
          name: body.name?.trim() || "Chat Session Files",
          type: "prototype",
          description: "Files saved from a /chat session",
        });
        artifactId = created.id;
        registerArtifactRoutes(this.api, store, artifactId);
      }

      const { writeFile } = await import("fs/promises");
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      const assetsDir = getArtifactAssetsDir(this.api, artifactId);
      const safeName = sanitizeAssetFilename(body.filename);
      let finalName = safeName;
      let n = 1;
      while (existsSync(join(assetsDir, finalName))) {
        const dot = safeName.lastIndexOf(".");
        finalName = dot > 0 ? `${safeName.slice(0, dot)}-${n}${safeName.slice(dot)}` : `${safeName}-${n}`;
        n++;
      }
      await writeFile(join(assetsDir, finalName), body.content, "utf-8");

      await store.addAsset(artifactId, {
        type: "code",
        filename: finalName,
        source: "chat-session",
        downloadedAt: new Date().toISOString(),
        storedPath: finalName,
      });
      registerArtifactAssetRoute(this.api, artifactId, finalName);

      return Response.json({
        success: true,
        artifactId,
        storedPath: finalName,
        url: `/api/artifact/${artifactId}/asset/${finalName}`,
      });
    } catch (error) {
      return Response.json(
        { success: false, error: error instanceof Error ? error.message : "Save failed" },
        { status: 500 },
      );
    }
  }

  /** Lists all real artifacts (the "library" the files panel can browse) — same data as GET /api/artifacts, but routed through this duty's own token gate. */
  private async handleArtifactLibrary(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    await runArtifactMigrations(this.api.db);
    const store = new ArtifactStore(this.api);
    const artifacts = await store.listAll();
    return Response.json({ artifacts });
  }

  /** Loads one artifact's files for the panel, inlining text-ish asset content and leaving everything else as a download link. */
  private async handleArtifactLoad(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ success: false, error: "id is required" }, { status: 400 });

    await runArtifactMigrations(this.api.db);
    const store = new ArtifactStore(this.api);
    const file = await store.load(id);
    if (!file) return Response.json({ success: false, error: "Artifact not found" }, { status: 404 });

    const { readFile } = await import("fs/promises");
    const files = await Promise.all(
      file.assetRecords
        .filter((a) => a.storedPath)
        .map(async (a) => {
          const ext = a.filename.slice(a.filename.lastIndexOf(".")).toLowerCase();
          const url = `/api/artifact/${id}/asset/${a.storedPath}`;
          if (!ChattyAgent.TEXT_ASSET_EXTENSIONS.has(ext)) {
            return { filename: a.filename, storedPath: a.storedPath, url, content: null };
          }
          try {
            const content = await readFile(resolveStoredAssetPath(this.api, id, a.storedPath!), "utf-8");
            return { filename: a.filename, storedPath: a.storedPath, url, content };
          } catch {
            return { filename: a.filename, storedPath: a.storedPath, url, content: null };
          }
        }),
    );

    return Response.json({ success: true, name: file.metadata.name, files });
  }

  /**
   * Gate for every /chat-related route once it may be reached through a
   * Cloudflare tunnel (see duties/cloudflare-connect.ts / docs/REMOTE_ACCESS.md).
   * Requests addressed to localhost (see routeToken.ts's isLocalRequest —
   * checked via the Host header, since cloudflared forwards tunnel traffic
   * over a local connection too, so socket address alone can't tell them
   * apart) always pass; remote requests need the shared token, either as
   * ?token= (the first hit, from the QR code) or an Authorization header
   * (every fetch() after that, once the chat page's own JS has stored it).
   * Returns a 401 Response if the request should be rejected, or null to proceed.
   */
  private requireRemoteToken(req: Request): Response | null {
    if (isLocalRequest(req)) return null;
    if (hasValidRouteToken(req, getOrCreateRouteToken())) return null;
    return new Response("Unauthorized — missing or invalid token", { status: 401 });
  }

  /** Transcribes a recorded audio blob (from the mic button) to text via the stt plugin. */
  private async handleTranscribe(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!this.api.plugins.has("stt")) {
      return Response.json({ error: "STT plugin not loaded" }, { status: 503 });
    }

    const { writeFile, unlink } = await import("fs/promises");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const audioBuffer = Buffer.from(await req.arrayBuffer());
    if (audioBuffer.length === 0) {
      return Response.json({ error: "Empty audio" }, { status: 400 });
    }

    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const rawPath = join(tmpdir(), `ronin-chat-audio-${id}.webm`);
    const wavPath = join(tmpdir(), `ronin-chat-audio-${id}.wav`);
    try {
      await writeFile(rawPath, audioBuffer);
      // Browsers only produce webm/ogg (Opus). Convert to 16kHz mono WAV first —
      // whisper.cpp's CLI expects WAV and won't decode webm itself, and WAV is
      // accepted by all three STT backends (apple, whisper, deepgram).
      await this.convertToWav(rawPath, wavPath);
      const result = (await this.api.plugins.call("stt", "transcribe", wavPath)) as { text: string };
      return Response.json({ text: result.text });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Transcription failed" },
        { status: 500 },
      );
    } finally {
      await unlink(rawPath).catch(() => {});
      await unlink(wavPath).catch(() => {});
    }
  }

  /** Converts an audio file to 16kHz mono WAV via ffmpeg (required for whisper.cpp). */
  private async convertToWav(inputPath: string, outputPath: string): Promise<void> {
    const { spawn } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", outputPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg conversion failed: ${stderr.trim() || `exit code ${code}`}`));
      });
      proc.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("ffmpeg is required to convert recorded audio for transcription. Install it with: brew install ffmpeg"));
        } else {
          reject(new Error(`Failed to run ffmpeg: ${err.message}`));
        }
      });
    });
  }

  /** Speaks text aloud through the host machine's speakers via the local.speech.say tool. */
  private async handleSpeak(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let text = "";
    try {
      const body = await req.json();
      text = typeof body?.text === "string" ? body.text : "";
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!text.trim()) {
      return Response.json({ error: "No text to speak" }, { status: 400 });
    }

    try {
      const result = await this.api.tools.execute("local.speech.say", { text });
      return Response.json({ success: result.success, error: result.error ?? null });
    } catch (error) {
      return Response.json(
        { success: false, error: error instanceof Error ? error.message : "Speech failed" },
        { status: 500 },
      );
    }
  }

  /** Web app manifest — lets /chat be installed as a standalone app (Android "Add to Home Screen", desktop Chrome install). */
  private async handleManifest(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const manifest = {
      name: "Ronin Chat",
      short_name: "Ronin",
      description: "Chat with Ronin's AI agent system",
      start_url: "/chat",
      scope: "/chat",
      display: "standalone",
      background_color: hankoTheme.colors.background,
      theme_color: hankoTheme.colors.background,
      icons: [
        { src: "/chat/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
        { src: "/chat/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
        { src: "/chat/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      ],
    };
    return Response.json(manifest, { headers: { "Content-Type": "application/manifest+json" } });
  }

  /** Minimal service worker — a fetch listener is the one thing Chrome/Android
   *  actually requires for the install prompt to fire; a light cache-the-shell
   *  strategy is included since it's nearly free once the listener exists. */
  private async handleServiceWorker(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const sw = `const CACHE = "ronin-chat-shell-v1";
const SHELL_URLS = ["/chat", "/chat/manifest.json", "/chat/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Network-first for everything (chat is live data) — cache is only a shell
  // fallback for the install prompt requirement, not an offline chat mode.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
`;
    return new Response(sw, { headers: { "Content-Type": "application/javascript" } });
  }

  /** Simple placeholder app icon — a wordmark glyph on the dashboard's own background, as SVG so no image-processing dependency is needed. */
  private async handleIcon(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${hankoTheme.colors.background}"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-size="280">🥷</text>
</svg>`;
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
  }

  /**
   * Handle chat management API (GET /api/chats, POST /api/chats)
   */
  private async handleChatsAPI(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    if (req.method === "GET") {
      const chats = await this.getChats();
      return Response.json(chats);
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { title?: string };
      const chat = await this.createChat(body.title || "New Chat");
      return Response.json(chat);
    }
    return new Response("Method not allowed", { status: 405 });
  }

  /**
   * Handle chat by ID API (GET /api/chats/:id, DELETE /api/chats/:id, PATCH /api/chats/:id)
   */
  private async handleChatByIdAPI(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    const url = new URL(req.url);
    const path = url.pathname;
    
    // Extract chat ID from path (e.g., /api/chats/123-456-789)
    const pathParts = path.split("/");
    const chatId = pathParts[pathParts.length - 1];
    
    if (!chatId || chatId === "chats") {
      return Response.json({ error: "Chat ID required" }, { status: 400 });
    }

    if (req.method === "GET") {
      const chat = await this.getChat(chatId);
      if (!chat) {
        return Response.json({ error: "Chat not found" }, { status: 404 });
      }
      const messages = await this.getChatMessages(chatId);
      return Response.json({ ...chat, messages });
    } else if (req.method === "DELETE") {
      await this.deleteChat(chatId);
      return Response.json({ success: true });
    } else if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({})) as { title?: string };
      if (!body.title) {
        return Response.json({ error: "Title required" }, { status: 400 });
      }
      await this.updateChatTitle(chatId, body.title);
      return Response.json({ success: true });
    }
    return new Response("Method not allowed", { status: 405 });
  }

  /**
   * Serve chat UI
   */
  private async handleChatUI(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;

    const aiConfig = this.api.config.getAI();
    const activeProvider = aiConfig.provider;
    const activeProviderLabel = getProviderVisual(activeProvider).label;
    const activeModelName = this.localModel;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Chat</title>
  <link rel="manifest" href="/chat/manifest.json">
  <link rel="icon" href="/chat/icon.svg" type="image/svg+xml">
  <meta name="theme-color" content="${hankoTheme.colors.background}">
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(hankoTheme)}
    ${getSharedUIPrimitivesCSS(hankoTheme, { variant: "hanko" })}
    ${getHeaderBarCSS(hankoTheme)}

    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      font-size: 0.8125rem;
      overflow: hidden;
    }

    .header { flex-shrink: 0; }

    .main-container {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    
    .sidebar {
      width: 280px;
      background: ${hankoTheme.colors.backgroundSecondary};
      border-right: 1px solid ${hankoTheme.colors.border};
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    
    .sidebar-header {
      padding: ${hankoTheme.spacing.md};
      border-bottom: 1px solid ${hankoTheme.colors.border};
    }
    
    .new-chat-button {
      width: 100%;
      padding: ${hankoTheme.spacing.sm} ${hankoTheme.spacing.md};
      background: ${hankoTheme.colors.backgroundTertiary};
      color: ${hankoTheme.colors.textPrimary};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.md};
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.3s;
    }
    
    .new-chat-button:hover {
      background: ${hankoTheme.colors.accent};
      border-color: ${hankoTheme.colors.borderHover};
    }
    
    .chat-list {
      flex: 1;
      overflow-y: auto;
      padding: ${hankoTheme.spacing.sm};
    }
    
    .chat-item {
      padding: ${hankoTheme.spacing.sm} ${hankoTheme.spacing.md};
      margin-bottom: ${hankoTheme.spacing.xs};
      border-radius: ${hankoTheme.borderRadius.md};
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
    }
    
    .chat-item:hover {
      background: ${hankoTheme.colors.backgroundTertiary};
    }
    
    .chat-item.active {
      background: ${hankoTheme.colors.accent};
      border: 1px solid ${hankoTheme.colors.borderHover};
    }
    
    .chat-item-content {
      flex: 1;
      min-width: 0;
    }
    
    .chat-item-title {
      font-size: 0.8125rem;
      color: ${hankoTheme.colors.textPrimary};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.125rem;
    }
    
    .chat-item-time {
      font-size: 0.75rem;
      color: ${hankoTheme.colors.textTertiary};
    }
    
    .chat-item-delete {
      opacity: 0;
      padding: 0.25rem;
      background: transparent;
      border: none;
      color: ${hankoTheme.colors.textTertiary};
      cursor: pointer;
      font-size: 0.75rem;
      transition: all 0.2s;
    }
    
    .chat-item:hover .chat-item-delete {
      opacity: 1;
    }
    
    .chat-item-delete:hover {
      color: ${hankoTheme.colors.error};
    }
    
    .empty-state {
      padding: ${hankoTheme.spacing.lg};
      text-align: center;
      color: ${hankoTheme.colors.textTertiary};
      font-size: 0.75rem;
    }
    
    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: ${hankoTheme.colors.background};
      overflow: hidden;
    }
    
    #chat-history {
      flex: 1;
      overflow-y: auto;
      padding: ${hankoTheme.spacing.lg};
      background: ${hankoTheme.colors.background};
    }
    
    .message {
      margin-bottom: 1rem;
      display: flex;
      gap: 0.75rem;
    }
    
    .message.user { flex-direction: row-reverse; }
    
    .message-content {
      max-width: 70%;
      padding: ${hankoTheme.spacing.sm} ${hankoTheme.spacing.md};
      border-radius: ${hankoTheme.borderRadius.md};
      word-wrap: break-word;
      font-size: 0.8125rem; /* 13px - smaller */
      line-height: 1.5;
    }
    
    .message.user .message-content {
      background: ${hankoTheme.colors.backgroundTertiary};
      color: ${hankoTheme.colors.textPrimary};
      border: 1px solid ${hankoTheme.colors.border};
      border-bottom-right-radius: ${hankoTheme.borderRadius.sm};
    }
    
    .message.assistant .message-content {
      background: ${hankoTheme.colors.backgroundSecondary};
      color: ${hankoTheme.colors.textPrimary};
      border: 1px solid ${hankoTheme.colors.border};
      border-bottom-left-radius: ${hankoTheme.borderRadius.sm};
    }
    
    .proposal-card {
      margin-top: ${hankoTheme.spacing.sm};
      padding: ${hankoTheme.spacing.md};
      border-radius: ${hankoTheme.borderRadius.md};
      background: ${hankoTheme.colors.backgroundTertiary};
      border: 1px solid ${hankoTheme.colors.border};
    }

    .proposal-card-preview {
      font-size: 0.8125rem;
      line-height: 1.6;
      color: ${hankoTheme.colors.textPrimary};
      margin-bottom: ${hankoTheme.spacing.sm};
    }

    .proposal-card-code-details {
      margin-bottom: ${hankoTheme.spacing.sm};
    }

    .proposal-card-code-details summary {
      font-size: 0.75rem;
      color: ${hankoTheme.colors.textSecondary};
      cursor: pointer;
    }

    .proposal-card-code {
      margin-top: ${hankoTheme.spacing.xs};
      padding: ${hankoTheme.spacing.sm};
      background: ${hankoTheme.colors.background};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.sm};
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      max-height: 360px;
      overflow-y: auto;
    }

    .proposal-card-actions {
      display: flex;
      gap: ${hankoTheme.spacing.sm};
    }

    .proposal-card-actions button {
      flex: 1;
      padding: ${hankoTheme.spacing.xs} ${hankoTheme.spacing.md};
      border-radius: ${hankoTheme.borderRadius.sm};
      border: 1px solid ${hankoTheme.colors.border};
      background: transparent;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .proposal-card-allow {
      color: ${hankoTheme.colors.success};
      border-color: ${hankoTheme.colors.success} !important;
    }

    .proposal-card-refuse {
      color: ${hankoTheme.colors.error};
      border-color: ${hankoTheme.colors.error} !important;
    }

    .proposal-card-actions button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .proposal-card-status {
      font-size: 0.75rem;
      color: ${hankoTheme.colors.textSecondary};
    }

    .message-content h1,
    .message-content h2,
    .message-content h3 {
      margin-top: ${hankoTheme.spacing.sm};
      margin-bottom: ${hankoTheme.spacing.sm};
      font-weight: 300;
    }
    
    .message-content h1 { font-size: 1.25rem; /* Smaller */ }
    .message-content h2 { font-size: 1.125rem; /* Smaller */ }
    .message-content h3 { font-size: 1rem; /* Smaller */ }
    
    .message-content p {
      margin: ${hankoTheme.spacing.sm} 0;
      line-height: 1.6;
      font-size: 0.8125rem; /* 13px */
    }
    
    .message-content ul,
    .message-content ol {
      margin: ${hankoTheme.spacing.sm} 0;
      padding-left: ${hankoTheme.spacing.lg};
    }
    
    .message-content li {
      margin: ${hankoTheme.spacing.xs} 0;
      font-size: 0.8125rem; /* 13px */
    }
    
    .message-content code {
      background: ${hankoTheme.colors.backgroundTertiary};
      padding: 0.125rem 0.375rem;
      border-radius: ${hankoTheme.borderRadius.sm};
      font-family: ${hankoTheme.fonts.mono};
      font-size: 0.75rem; /* 12px - smaller */
    }
    
    .message.user .message-content code {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .message-content pre {
      background: #161b22 !important;
      padding: ${hankoTheme.spacing.md};
      border-radius: ${hankoTheme.borderRadius.md};
      overflow-x: auto;
      margin: ${hankoTheme.spacing.sm} 0;
      border: 1px solid ${hankoTheme.colors.border};
    }
    
    .message.user .message-content pre {
      background: rgba(255, 255, 255, 0.05) !important;
      border-color: ${hankoTheme.colors.border};
    }
    
    .message-content pre code {
      background: none !important;
      padding: 0;
      font-size: 0.75rem; /* 12px */
      color: inherit;
    }
    
    .message-content blockquote {
      border-left: 2px solid ${hankoTheme.colors.borderHover};
      padding-left: ${hankoTheme.spacing.md};
      margin: ${hankoTheme.spacing.sm} 0;
      color: ${hankoTheme.colors.textSecondary};
      font-style: italic;
    }
    
    .message-content strong {
      font-weight: 500;
    }
    
    .message-content em {
      font-style: italic;
    }
    
    .message-content a {
      color: ${hankoTheme.colors.textSecondary};
      text-decoration: none;
    }
    
    .message-content a:hover {
      color: ${hankoTheme.colors.textPrimary};
      text-decoration: underline;
    }
    
    .message.user .message-content a {
      color: ${hankoTheme.colors.textPrimary};
    }
    
    .input-area {
      padding: ${hankoTheme.spacing.md};
      background: ${hankoTheme.colors.backgroundSecondary};
      border-top: 1px solid ${hankoTheme.colors.border};
      display: flex;
      gap: ${hankoTheme.spacing.sm};
      flex-shrink: 0;
    }
    
    #message-input {
      flex: 1;
      padding: ${hankoTheme.spacing.sm} ${hankoTheme.spacing.md};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.md};
      font-size: 0.8125rem; /* 13px - smaller */
      background: ${hankoTheme.colors.background};
      color: ${hankoTheme.colors.textPrimary};
      outline: none;
      transition: all 0.3s;
    }
    
    #message-input:focus {
      border-color: ${hankoTheme.colors.borderHover};
      background: ${hankoTheme.colors.backgroundSecondary};
    }
    
    #message-input::placeholder {
      color: ${hankoTheme.colors.textTertiary};
    }
    
    #send-button {
      padding: ${hankoTheme.spacing.sm} ${hankoTheme.spacing.lg};
      background: ${hankoTheme.colors.backgroundTertiary};
      color: ${hankoTheme.colors.textPrimary};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.md};
      font-size: 0.8125rem; /* 13px - smaller */
      cursor: pointer;
      transition: all 0.3s;
    }
    
    #send-button:hover:not(:disabled) {
      background: ${hankoTheme.colors.accent};
      border-color: ${hankoTheme.colors.borderHover};
    }
    
    #send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    #drop-zone {
      padding: ${hankoTheme.spacing.md};
      border: 2px dashed ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.md};
      text-align: center;
      color: ${hankoTheme.colors.textTertiary};
      margin-bottom: ${hankoTheme.spacing.sm};
      display: none;
      font-size: 0.75rem; /* 12px */
    }
    
    #drop-zone.drag-over {
      border-color: ${hankoTheme.colors.borderHover};
      background: ${hankoTheme.colors.backgroundSecondary};
    }
    
    .loading {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid ${hankoTheme.colors.border};
      border-top-color: ${hankoTheme.colors.textPrimary};
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    /* Fresh-chat visual override */
    .main-container {
      background: radial-gradient(circle at top left, ${hankoTheme.colors.accent}2e, transparent 28%), ${hankoTheme.colors.background};
    }
    .sidebar {
      width: 260px;
      background: ${hankoTheme.colors.backgroundSecondary};
      border-right: 1px solid rgba(255,255,255,0.08);
      align-items: stretch;
      padding: ${hankoTheme.spacing.md};
    }
    .sidebar-header {
      padding: 0 0 ${hankoTheme.spacing.sm};
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: block;
    }
    .new-chat-button {
      width: 100%;
      padding: 0.5rem 0.7rem;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      border-radius: ${hankoTheme.borderRadius.sm};
      border: 1px solid ${hankoTheme.colors.border};
      background: ${hankoTheme.colors.accent}1a;
      color: ${hankoTheme.colors.textPrimary};
      transition: background 150ms ease, border-color 150ms ease;
    }
    .model-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: ${hankoTheme.spacing.sm};
      font-size: 0.68rem;
      color: ${hankoTheme.colors.textTertiary};
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .model-indicator svg { flex-shrink: 0; }
    .model-indicator .model-indicator-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-transform: none;
      letter-spacing: normal;
      color: ${hankoTheme.colors.textSecondary};
      font-size: 0.72rem;
    }
    .chat-container {
      background: ${hankoTheme.colors.background};
    }
    .chat-topbar { display: none; }
    .chat-list {
      margin-top: ${hankoTheme.spacing.sm};
      display: block;
      overflow-y: auto;
      padding: 0;
    }
    .chat-tabs-empty {
      color: ${hankoTheme.colors.textTertiary};
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .chat-item {
      margin-bottom: ${hankoTheme.spacing.xs};
      padding: 0.4rem 0.6rem;
      border-radius: ${hankoTheme.borderRadius.sm};
      background: ${hankoTheme.colors.backgroundSecondary};
      border: 1px solid ${hankoTheme.colors.border};
      max-width: none;
      gap: 0.4rem;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .chat-item.active {
      background: ${hankoTheme.colors.accent}22;
      border-color: ${hankoTheme.colors.accent};
      box-shadow: 0 0 0 1px ${hankoTheme.colors.accent}55;
    }
    .chat-item:hover {
      background: ${hankoTheme.colors.accent}18;
      border-color: ${hankoTheme.colors.accentHover};
    }
    .chat-item-title {
      font-size: 0.7rem;
      margin-bottom: 0;
    }
    .chat-item-time { display: none; }
    .chat-item-delete {
      opacity: 1;
      width: 16px;
      height: 16px;
      padding: 0;
      border-radius: 999px;
    }
    #chat-history {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .hero-state {
      margin: auto;
      text-align: center;
    }
    .hero-title {
      font-size: clamp(3rem, 8vw, 5rem);
      font-weight: 200;
      letter-spacing: 0.2em;
    }
    .hero-subtitle {
      margin-top: ${hankoTheme.spacing.sm};
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.22em;
      color: ${hankoTheme.colors.textSecondary};
    }
    .hero-console {
      margin: ${hankoTheme.spacing.md} auto 0;
      display: inline-flex;
      padding: 0.2rem 0.7rem;
      border: 1px solid rgba(255,255,255,0.12);
      color: ${hankoTheme.colors.textTertiary};
      font-family: ${hankoTheme.fonts.mono};
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .message.user .message-content,
    .message.assistant .message-content {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 0;
      max-width: 86%;
    }
    .input-area {
      justify-content: center;
      background: transparent;
      border-top: none;
      padding: ${hankoTheme.spacing.md} ${hankoTheme.spacing.lg} ${hankoTheme.spacing.lg};
    }
    #message-input {
      flex: 0 1 780px;
      background: rgba(10,10,12,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: ${hankoTheme.borderRadius.sm};
      font-size: 0.78rem;
      padding: 0.8rem 0.9rem;
      min-height: 2.6rem;
      max-height: 12rem;
      resize: none;
      overflow-y: auto;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    #send-button {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-radius: ${hankoTheme.borderRadius.sm};
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.02);
      color: ${hankoTheme.colors.textSecondary};
      padding: 0.8rem 1rem;
    }
    #send-button:hover:not(:disabled) {
      background: ${hankoTheme.colors.accent}29;
      border-color: ${hankoTheme.colors.accent}99;
      color: ${hankoTheme.colors.textPrimary};
    }
    #mic-button {
      font-size: 0.9rem;
      border-radius: ${hankoTheme.borderRadius.sm};
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.02);
      color: ${hankoTheme.colors.textSecondary};
      padding: 0.8rem 0.9rem;
      cursor: pointer;
      transition: all 0.3s;
    }
    #mic-button:hover:not(:disabled) {
      background: ${hankoTheme.colors.accent}29;
      border-color: ${hankoTheme.colors.accent}99;
      color: ${hankoTheme.colors.textPrimary};
    }
    #mic-button.recording {
      background: rgba(220,50,50,0.25);
      border-color: rgba(220,50,50,0.6);
      color: #fff;
      animation: mic-pulse 1.2s ease-in-out infinite;
    }
    @keyframes mic-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    #files-panel-toggle, #speak-toggle {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.15);
      color: ${hankoTheme.colors.textSecondary};
      border-radius: ${hankoTheme.borderRadius.sm};
      padding: 0.3rem 0.6rem;
      font-size: 0.8rem;
      cursor: pointer;
    }
    #files-panel-toggle {
      margin-left: auto;
    }
    #files-panel-toggle.active, #speak-toggle.active {
      border-color: ${hankoTheme.colors.accent}99;
      color: ${hankoTheme.colors.textPrimary};
      background: ${hankoTheme.colors.accent}22;
    }
    .artifact-panel {
      width: 420px;
      flex-shrink: 0;
      background: ${hankoTheme.colors.backgroundSecondary};
      border-left: 1px solid ${hankoTheme.colors.border};
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .artifact-panel[hidden] { display: none; }
    .artifact-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: ${hankoTheme.spacing.sm} ${hankoTheme.spacing.md};
      border-bottom: 1px solid ${hankoTheme.colors.border};
      font-size: 0.85rem;
      font-weight: 600;
      color: ${hankoTheme.colors.textPrimary};
      flex-shrink: 0;
    }
    .artifact-panel-header-actions { display: flex; gap: 6px; }
    .artifact-panel-header-actions button {
      background: transparent;
      border: 1px solid ${hankoTheme.colors.border};
      color: ${hankoTheme.colors.textSecondary};
      border-radius: ${hankoTheme.borderRadius.sm};
      padding: 4px 8px;
      font-size: 0.72rem;
      cursor: pointer;
    }
    .artifact-panel-header-actions button.active {
      border-color: ${hankoTheme.colors.accent}99;
      color: ${hankoTheme.colors.textPrimary};
      background: ${hankoTheme.colors.accent}22;
    }
    .artifact-tabs {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      padding: 6px 8px;
      border-bottom: 1px solid ${hankoTheme.colors.border};
      flex-shrink: 0;
    }
    .artifact-tabs:empty { display: none; }
    .artifact-tab {
      padding: 4px 10px;
      font-size: 0.72rem;
      border-radius: 999px;
      white-space: nowrap;
      cursor: pointer;
      background: ${hankoTheme.colors.backgroundTertiary};
      color: ${hankoTheme.colors.textSecondary};
      border: 1px solid transparent;
    }
    .artifact-tab.active {
      background: ${hankoTheme.colors.accent}22;
      color: ${hankoTheme.colors.textPrimary};
      border-color: ${hankoTheme.colors.accent}66;
    }
    .artifact-file-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid ${hankoTheme.colors.border};
      font-size: 0.75rem;
      color: ${hankoTheme.colors.textSecondary};
      flex-shrink: 0;
    }
    .artifact-file-toolbar:empty { display: none; }
    .artifact-file-toolbar .filename {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ${hankoTheme.fonts.mono};
    }
    .artifact-file-toolbar button {
      background: transparent;
      border: 1px solid ${hankoTheme.colors.border};
      color: ${hankoTheme.colors.textSecondary};
      border-radius: ${hankoTheme.borderRadius.sm};
      padding: 3px 8px;
      cursor: pointer;
      font-size: 0.72rem;
    }
    .artifact-file-toolbar button:hover { background: ${hankoTheme.colors.accent}22; }
    .artifact-content { flex: 1; overflow: auto; padding: 10px; }
    .artifact-content pre {
      margin: 0;
      font-family: ${hankoTheme.fonts.mono};
      font-size: 0.78rem;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .artifact-content img { max-width: 100%; border-radius: ${hankoTheme.borderRadius.sm}; }
    .artifact-empty {
      color: ${hankoTheme.colors.textTertiary};
      font-size: 0.8rem;
      padding: 24px 16px;
      text-align: center;
    }
    .artifact-library-list { display: flex; flex-direction: column; gap: 6px; }
    .artifact-library-item {
      padding: 8px 10px;
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.sm};
      cursor: pointer;
      font-size: 0.78rem;
    }
    .artifact-library-item:hover { background: ${hankoTheme.colors.backgroundTertiary}; }
    .artifact-library-item .name { font-weight: 600; color: ${hankoTheme.colors.textPrimary}; }
    .artifact-library-item .meta { color: ${hankoTheme.colors.textTertiary}; font-size: 0.68rem; margin-top: 2px; }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>💬 Ronin Chat</h1>
    <div class="header-meta">Chat with AI that understands your Ronin setup</div>
    <button id="files-panel-toggle" title="Files from this chat">📁 Files</button>
    <button id="speak-toggle" title="Read Ronin's replies aloud on this Mac's speakers">🔇 Speak replies</button>
  </div>
  <div class="main-container">
    <div class="sidebar">
      <div class="sidebar-header">
        <button class="new-chat-button" id="new-chat-button" title="New Chat">+ NEW CHAT</button>
        <div class="model-indicator" title="${escapeHtmlServer(`${activeProviderLabel} — ${activeModelName}`)}">
          ${renderProviderIconSvg(activeProvider, 16)}
          <span class="model-indicator-name">${escapeHtmlServer(activeModelName)}</span>
        </div>
      </div>
      <div class="chat-list" id="chat-list">
        <div class="chat-tabs-empty">Loading chats...</div>
      </div>
    </div>
    <div class="chat-container">
      <div id="chat-history"></div>
      <div id="drop-zone">Drop files here to analyze</div>
      <div class="input-area">
        <textarea id="message-input" rows="1" placeholder="Ask Ronin..."></textarea>
        <button id="mic-button" title="Voice input">🎤</button>
        <button id="send-button">Send</button>
      </div>
    </div>
    <div id="artifact-panel" class="artifact-panel" hidden>
      <div class="artifact-panel-header">
        <span class="artifact-panel-title" id="artifact-panel-title">Files</span>
        <div class="artifact-panel-header-actions">
          <button id="artifact-library-toggle" title="Browse saved artifacts">📚 Library</button>
          <button id="artifact-panel-close" title="Close">✕</button>
        </div>
      </div>
      <div class="artifact-tabs" id="artifact-tabs"></div>
      <div class="artifact-file-toolbar" id="artifact-file-toolbar"></div>
      <div class="artifact-content" id="artifact-content">
        <div class="artifact-empty">No files yet — code Ronin writes in this chat will show up here.</div>
      </div>
    </div>
  </div>
  <script>
    let currentChatId = null;
    let chats = [];
    let currentMessages = []; // Maintain message state
    if (window.self !== window.top) {
      document.body.classList.add('embedded-client');
    }

    // Remote-access token (see duties/cloudflare-connect.ts's /connect QR code):
    // the first hit from a scanned QR arrives as /chat?token=..., which the
    // server itself accepts once; store it here so every subsequent fetch on
    // this device can authenticate too, then scrub it from the visible URL.
    (function () {
      const params = new URLSearchParams(location.search);
      const tokenFromUrl = params.get('token');
      if (tokenFromUrl) {
        try { localStorage.setItem('ronin-remote-token', tokenFromUrl); } catch (e) {}
        params.delete('token');
        const clean = location.pathname + (params.toString() ? '?' + params.toString() : '');
        history.replaceState(null, '', clean);
      }
    })();

    function authFetch(url, options) {
      options = options || {};
      let token = null;
      try { token = localStorage.getItem('ronin-remote-token'); } catch (e) {}
      if (token) {
        options.headers = Object.assign({}, options.headers, { 'Authorization': 'Bearer ' + token });
      }
      return fetch(url, options);
    }

    // --- Files panel: code blocks from this chat, plus a browser for the real Artifact library ---
    let sessionFiles = [];
    let activeFileId = null;
    let panelMode = 'files'; // 'files' | 'library'
    let currentSaveArtifactId = null; // remembered across saves within this page load

    const artifactPanel = document.getElementById('artifact-panel');
    const artifactTabsEl = document.getElementById('artifact-tabs');
    const artifactToolbarEl = document.getElementById('artifact-file-toolbar');
    const artifactContentEl = document.getElementById('artifact-content');
    const artifactPanelTitleEl = document.getElementById('artifact-panel-title');
    const filesPanelToggle = document.getElementById('files-panel-toggle');

    const LANGUAGE_TO_EXT = {
      javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
      python: 'py', py: 'py', json: 'json', html: 'html', css: 'css',
      bash: 'sh', shell: 'sh', sh: 'sh', ruby: 'rb', go: 'go', rust: 'rs',
      java: 'java', c: 'c', cpp: 'cpp', sql: 'sql', yaml: 'yaml', yml: 'yaml', markdown: 'md',
    };

    function escapeHtmlPanel(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function extractSessionFilesFromMessages(messages) {
      const found = [];
      let counter = 1;
      (messages || []).forEach((msg) => {
        if (msg.role !== 'assistant' || !msg.content) return;
        const re = /\`\`\`([a-zA-Z0-9_+-]*)\\n([\\s\\S]*?)\`\`\`/g;
        let m;
        while ((m = re.exec(msg.content))) {
          const lang = (m[1] || '').trim().toLowerCase();
          const code = m[2] || '';
          if (code.trim().split('\\n').length < 2) continue; // skip one-liners — not worth a "file"
          const ext = LANGUAGE_TO_EXT[lang] || (lang || 'txt');
          found.push({ id: 'sf-' + counter, filename: 'snippet-' + counter + '.' + ext, language: lang || ext, content: code });
          counter++;
        }
      });
      return found;
    }

    function syncSessionFilesFromHistory(messages) {
      const extracted = extractSessionFilesFromMessages(messages);
      const byContent = new Map(sessionFiles.map(function (f) { return [f.content, f]; }));
      sessionFiles = extracted.map(function (f) {
        const existing = byContent.get(f.content);
        return existing || f;
      });
      if (!sessionFiles.some(function (f) { return f.id === activeFileId; })) {
        activeFileId = sessionFiles.length ? sessionFiles[sessionFiles.length - 1].id : null;
      }
    }

    function openArtifactPanel() {
      artifactPanel.hidden = false;
      filesPanelToggle.classList.add('active');
      renderArtifactPanel();
    }
    function closeArtifactPanel() {
      artifactPanel.hidden = true;
      filesPanelToggle.classList.remove('active');
    }
    filesPanelToggle.addEventListener('click', function () {
      if (artifactPanel.hidden) openArtifactPanel(); else closeArtifactPanel();
    });
    document.getElementById('artifact-panel-close').addEventListener('click', closeArtifactPanel);
    document.getElementById('artifact-library-toggle').addEventListener('click', function (e) {
      panelMode = panelMode === 'library' ? 'files' : 'library';
      e.currentTarget.classList.toggle('active', panelMode === 'library');
      renderArtifactPanel();
    });

    function renderArtifactPanel() {
      if (!artifactPanel || artifactPanel.hidden) return;

      if (panelMode === 'library') {
        artifactPanelTitleEl.textContent = 'Artifact Library';
        artifactTabsEl.innerHTML = '';
        artifactToolbarEl.innerHTML = '';
        artifactContentEl.innerHTML = '<div class="artifact-empty">Loading...</div>';
        authFetch('/api/chat/artifact/library').then(function (r) { return r.json(); }).then(function (data) {
          const items = data.artifacts || [];
          if (!items.length) {
            artifactContentEl.innerHTML = '<div class="artifact-empty">No saved artifacts yet.</div>';
            return;
          }
          artifactContentEl.innerHTML = '<div class="artifact-library-list">' + items.map(function (a) {
            return '<div class="artifact-library-item" data-id="' + escapeHtmlPanel(a.id) + '">' +
              '<div class="name">' + escapeHtmlPanel(a.name) + '</div>' +
              '<div class="meta">' + escapeHtmlPanel(a.type) + ' · ' + escapeHtmlPanel(a.state) + ' · updated ' + new Date(a.updated).toLocaleString() + '</div>' +
              '</div>';
          }).join('') + '</div>';
          artifactContentEl.querySelectorAll('.artifact-library-item').forEach(function (el) {
            el.addEventListener('click', function () { loadArtifactIntoPanel(el.getAttribute('data-id')); });
          });
        }).catch(function () {
          artifactContentEl.innerHTML = '<div class="artifact-empty">Failed to load library.</div>';
        });
        return;
      }

      artifactPanelTitleEl.textContent = 'Files';

      if (!sessionFiles.length) {
        artifactTabsEl.innerHTML = '';
        artifactToolbarEl.innerHTML = '';
        artifactContentEl.innerHTML = '<div class="artifact-empty">No files yet — code Ronin writes in this chat will show up here.</div>';
        return;
      }

      artifactTabsEl.innerHTML = sessionFiles.map(function (f) {
        return '<div class="artifact-tab' + (f.id === activeFileId ? ' active' : '') + '" data-id="' + escapeHtmlPanel(f.id) + '">' + escapeHtmlPanel(f.filename) + '</div>';
      }).join('');
      artifactTabsEl.querySelectorAll('.artifact-tab').forEach(function (el) {
        el.addEventListener('click', function () { activeFileId = el.getAttribute('data-id'); renderArtifactPanel(); });
      });

      let active = sessionFiles.filter(function (f) { return f.id === activeFileId; })[0] || sessionFiles[0];
      activeFileId = active.id;

      artifactToolbarEl.innerHTML =
        '<span class="filename">' + escapeHtmlPanel(active.filename) + '</span>' +
        '<button id="artifact-copy-btn">Copy</button>' +
        '<button id="artifact-download-btn">Download</button>' +
        '<button id="artifact-save-btn">' + (active.savedArtifactId ? 'Saved ✓' : 'Save') + '</button>';

      document.getElementById('artifact-copy-btn').addEventListener('click', function () {
        navigator.clipboard.writeText(active.content).catch(function () {});
      });
      document.getElementById('artifact-download-btn').addEventListener('click', function () {
        if (active.downloadUrl) { window.open(active.downloadUrl, '_blank'); return; }
        const blob = new Blob([active.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = active.filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
      document.getElementById('artifact-save-btn').addEventListener('click', function () {
        const btn = document.getElementById('artifact-save-btn');
        btn.disabled = true; btn.textContent = 'Saving...';
        authFetch('/api/chat/artifact/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: currentSaveArtifactId ? undefined : 'Chat Session Files',
            filename: active.filename,
            content: active.content,
            artifactId: currentSaveArtifactId || undefined,
          }),
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (data.success) {
            currentSaveArtifactId = data.artifactId;
            active.savedArtifactId = data.artifactId;
            active.savedStoredPath = data.storedPath;
          }
        }).catch(function (e) { console.error('Save failed:', e); }).then(function () { renderArtifactPanel(); });
      });

      artifactContentEl.innerHTML = '<pre><code class="language-' + escapeHtmlPanel(active.language || '') + '">' + escapeHtmlPanel(active.content) + '</code></pre>';
      if (typeof hljs !== 'undefined' && hljs) {
        artifactContentEl.querySelectorAll('pre code').forEach(function (block) {
          try { hljs.highlightElement(block); } catch (e) {}
        });
      }
    }

    function loadArtifactIntoPanel(artifactId) {
      artifactContentEl.innerHTML = '<div class="artifact-empty">Loading...</div>';
      authFetch('/api/chat/artifact/load?id=' + encodeURIComponent(artifactId)).then(function (r) { return r.json(); }).then(function (data) {
        if (!data.success) { artifactContentEl.innerHTML = '<div class="artifact-empty">Failed to load.</div>'; return; }
        const loaded = (data.files || []).map(function (f, i) {
          return {
            id: 'lib-' + artifactId + '-' + i,
            filename: f.filename,
            language: LANGUAGE_TO_EXT[f.filename.split('.').pop()] ? f.filename.split('.').pop() : '',
            content: f.content != null ? f.content : '(binary file — use Download)',
            savedArtifactId: artifactId,
            savedStoredPath: f.storedPath,
            downloadUrl: f.url,
          };
        });
        panelMode = 'files';
        document.getElementById('artifact-library-toggle').classList.remove('active');
        sessionFiles = loaded.length ? loaded : [{ id: 'lib-empty', filename: data.name || 'artifact', language: '', content: '(no files in this artifact yet)' }];
        activeFileId = sessionFiles[0].id;
        currentSaveArtifactId = artifactId;
        renderArtifactPanel();
      }).catch(function () {
        artifactContentEl.innerHTML = '<div class="artifact-empty">Failed to load.</div>';
      });
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/chat/sw.js').catch(function(err) {
        console.warn('Service worker registration failed:', err);
      });
    }
    
    // Get chat ID from URL or create new
    function getChatIdFromURL() {
      const params = new URLSearchParams(window.location.search);
      return params.get('chatId');
    }
    
    function updateURL(chatId) {
      const url = new URL(window.location);
      if (chatId) {
        url.searchParams.set('chatId', chatId);
      } else {
        url.searchParams.delete('chatId');
      }
      window.history.pushState({}, '', url);
    }
    
    function formatTime(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 1) return 'Just now';
      if (minutes < 60) return \`\${minutes}m ago\`;
      if (hours < 24) return \`\${hours}h ago\`;
      if (days < 7) return \`\${days}d ago\`;
      return date.toLocaleDateString();
    }
    
    async function loadChats() {
      try {
        const response = await authFetch('/api/chats');
        if (!response.ok) throw new Error('Failed to load chats');
        chats = await response.json();
        renderChatList();
      } catch (error) {
        console.error('Failed to load chats:', error);
        document.getElementById('chat-list').innerHTML = '<div class="chat-tabs-empty">Failed to load chats</div>';
      }
    }
    
    function renderChatList() {
      const container = document.getElementById('chat-list');
      if (chats.length === 0) {
        container.innerHTML = '<div class="chat-tabs-empty">No chats yet</div>';
        return;
      }
      
      container.innerHTML = chats.map(chat => \`
        <div class="chat-item \${chat.id === currentChatId ? 'active' : ''}" data-chat-id="\${chat.id}">
          <div class="chat-item-content">
            <div class="chat-item-title">\${escapeHtml(chat.title)}</div>
            <div class="chat-item-time">\${formatTime(chat.updated_at)}</div>
          </div>
          <button class="chat-item-delete" onclick="deleteChat('\${chat.id}', event)">×</button>
        </div>
      \`).join('');
      
      // Add click handlers
      container.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('chat-item-delete')) return;
          const chatId = item.dataset.chatId;
          switchToChat(chatId);
        });
      });
    }
    
    async function switchToChat(chatId) {
      if (currentChatId === chatId) return;
      
      currentChatId = chatId;
      updateURL(chatId);
      renderChatList();
      
      // Show loading state
      const chatHistory = document.getElementById('chat-history');
      chatHistory.innerHTML = '<div class="empty-state">Loading...</div>';
      
      try {
        const response = await authFetch(\`/api/chats/\${chatId}\`);
        if (!response.ok) throw new Error('Failed to load chat');
        const chat = await response.json();
        currentMessages = chat.messages || [];
        renderHistory(currentMessages);
      } catch (error) {
        console.error('Failed to load chat:', error);
        chatHistory.innerHTML = '<div class="empty-state">Failed to load chat</div>';
        currentMessages = [];
      }
    }
    
    async function createNewChat() {
      try {
        const response = await authFetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Chat' })
        });
        if (!response.ok) throw new Error('Failed to create chat');
        const chat = await response.json();
        await loadChats(); // Reload to get updated list
        switchToChat(chat.id);
      } catch (error) {
        console.error('Failed to create chat:', error);
        alert('Failed to create new chat');
      }
    }
    
    async function deleteChat(chatId, event) {
      event.stopPropagation();
      if (!confirm('Delete this chat?')) return;
      
      try {
        const response = await authFetch(\`/api/chats/\${chatId}\`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete chat');
        
        await loadChats(); // Reload to get updated list
        if (currentChatId === chatId) {
          currentChatId = null;
          currentMessages = [];
          updateURL(null);
          renderHistory([]);
        }
        renderChatList();
      } catch (error) {
        console.error('Failed to delete chat:', error);
        alert('Failed to delete chat');
      }
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Proposal cards: a \`\`\`contract-proposal { id, preview } \`\`\`,
    // \`\`\`workflow-proposal { id, preview } \`\`\`, or
    // \`\`\`duty-proposal { id, preview, code } \`\`\` fence (deterministically
    // appended server-side whenever contracts.proposeReflex / workflows.propose /
    // duties.proposeDuty runs — see injectContractProposalCardIntoResponse /
    // injectWorkflowProposalCardIntoResponse / injectDutyProposalCardIntoResponse)
    // is pulled out of the markdown text and rendered as an Allow/Refuse card
    // instead of a code block.
    const PROPOSAL_KINDS = {
      'contract-proposal': { kind: 'contract', approveUrl: '/api/contracts/proposals/approve', refuseUrl: '/api/contracts/proposals/refuse', nameField: 'contractName' },
      'workflow-proposal': { kind: 'workflow', approveUrl: '/api/workflows/proposals/approve', refuseUrl: '/api/workflows/proposals/refuse', nameField: 'workflowName' },
      'duty-proposal': { kind: 'duty', approveUrl: '/api/duties/proposals/approve', refuseUrl: '/api/duties/proposals/refuse', nameField: 'dutyName' },
    };

    function extractProposalCards(text) {
      const cards = [];
      let cleaned = text;
      for (const fenceName of Object.keys(PROPOSAL_KINDS)) {
        const fence = new RegExp('\`\`\`' + fenceName + '\\\\n([\\\\s\\\\S]*?)\\\\n\`\`\`', 'g');
        cleaned = cleaned.replace(fence, (match, jsonText) => {
          try {
            const parsed = JSON.parse(jsonText);
            if (parsed && typeof parsed.id === 'string' && typeof parsed.preview === 'string') {
              cards.push({ ...parsed, kind: PROPOSAL_KINDS[fenceName].kind });
              return '';
            }
          } catch (e) { /* leave malformed fences in the text as-is */ }
          return match;
        });
      }
      return { text: cleaned, cards };
    }

    function renderProposalCard(card) {
      const el = document.createElement('div');
      el.className = 'proposal-card';
      el.dataset.proposalId = card.id;
      const codeBlock = (card.kind === 'duty' && typeof card.code === 'string')
        ? \`<details class="proposal-card-code-details">
             <summary>View generated code</summary>
             <pre class="proposal-card-code">\${escapeHtml(card.code)}</pre>
           </details>\`
        : '';
      el.innerHTML = \`
        <div class="proposal-card-preview">\${escapeHtml(card.preview)}</div>
        \${codeBlock}
        <div class="proposal-card-actions"></div>
      \`;
      const actions = el.querySelector('.proposal-card-actions');
      const allowBtn = document.createElement('button');
      allowBtn.className = 'proposal-card-allow';
      allowBtn.textContent = 'Allow';
      const refuseBtn = document.createElement('button');
      refuseBtn.className = 'proposal-card-refuse';
      refuseBtn.textContent = 'Refuse';
      allowBtn.onclick = () => decideProposal(card.id, card.kind || 'contract', 'approve', actions);
      refuseBtn.onclick = () => decideProposal(card.id, card.kind || 'contract', 'refuse', actions);
      actions.appendChild(allowBtn);
      actions.appendChild(refuseBtn);
      return el;
    }

    async function decideProposal(id, kind, action, actionsEl) {
      const cfg = PROPOSAL_KINDS[kind + '-proposal'] || PROPOSAL_KINDS['contract-proposal'];
      const buttons = actionsEl.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);
      try {
        const res = await authFetch(action === 'approve' ? cfg.approveUrl : cfg.refuseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          const name = body[cfg.nameField];
          actionsEl.innerHTML = action === 'approve'
            ? \`<span class="proposal-card-status">✅ Approved\${name ? ' — ' + escapeHtml(name) + ' is now active' : ''}</span>\`
            : '<span class="proposal-card-status">Refused</span>';
        } else {
          actionsEl.innerHTML = \`<span class="proposal-card-status">Failed: \${escapeHtml(body.message || res.statusText)}</span>\`;
        }
      } catch (e) {
        actionsEl.innerHTML = '<span class="proposal-card-status">Failed: network error</span>';
      }
    }

    function renderHistory(messages) {
      const container = document.getElementById('chat-history');
      container.innerHTML = '';

      if (!messages || messages.length === 0) {
        container.innerHTML = \`
          <div class="hero-state">
            <div class="hero-title">RONIN</div>
            <div class="hero-subtitle">Digital Resource Allocation Module</div>
            <div class="hero-console">Secure Link Active</div>
          </div>
        \`;
        syncSessionFilesFromHistory(messages);
        renderArtifactPanel();
        return;
      }
      
      messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = \`message \${msg.role}\`;
        const content = document.createElement('div');
        content.className = 'message-content';
        
        // Render markdown for assistant messages, plain text for user messages
        let proposalCards = [];
        if (msg.role === 'assistant') {
          const extracted = extractProposalCards(msg.content);
          const msgText = extracted.text;
          proposalCards = extracted.cards;
          if (typeof marked !== 'undefined' && marked && marked.parse) {
            try {
              if (marked.setOptions) {
                marked.setOptions({
                  breaks: true,
                  gfm: true,
                  headerIds: false,
                  mangle: false
                });
              }
              content.innerHTML = marked.parse(msgText);

              // Apply syntax highlighting to code blocks
              if (typeof hljs !== 'undefined' && hljs) {
                content.querySelectorAll('pre code').forEach(block => {
                  hljs.highlightElement(block);
                });
              }
            } catch (e) {
              console.warn('Markdown parsing failed:', e);
              const text = msgText.replace(/&/g, '&amp;')
                                      .replace(/</g, '&lt;')
                                      .replace(/>/g, '&gt;')
                                      .replace(/\\n/g, '<br>');
              content.innerHTML = text;
            }
          } else {
            const text = msgText.replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;')
                                    .replace(/\\n/g, '<br>');
            content.innerHTML = text;
          }
        } else {
          const text = msg.content.replace(/&/g, '&amp;')
                                  .replace(/</g, '&lt;')
                                  .replace(/>/g, '&gt;')
                                  .replace(/\\n/g, '<br>');
          content.innerHTML = text;
        }

        div.appendChild(content);
        proposalCards.forEach(card => div.appendChild(renderProposalCard(card)));
        container.appendChild(div);
      });
      
      container.scrollTop = container.scrollHeight;
      syncSessionFilesFromHistory(messages);
      renderArtifactPanel();
    }

    async function sendMessage() {
      const input = document.getElementById('message-input');
      const button = document.getElementById('send-button');
      const message = input.value.trim();
      if (!message) return;
      
      // Create chat if none exists
      if (!currentChatId) {
        await createNewChat();
        // Wait for chat to be created
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      input.value = '';
      autoResizeInput();
      button.disabled = true;
      button.innerHTML = '<span class="loading"></span>';
      
      // Add user message to state and UI immediately
      const userMessage = { role: 'user', content: message };
      currentMessages.push(userMessage);
      renderHistory(currentMessages);
      
      // Create AbortController with timeout that resets on each chunk
      const controller = new AbortController();
      const STREAM_TIMEOUT_MS = 300000; // 5 minutes
      let timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
      
      // Helper to reset timeout on activity
      const resetTimeout = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
      };
      
      // Create assistant message placeholder
      const assistantMessage = { role: 'assistant', content: '' };
      currentMessages.push(assistantMessage);
      
      try {
        const response = await authFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, chatId: currentChatId }),
          signal: controller.signal
        });
        
        if (!response.ok) {
          let errorMessage = 'Request failed';
          try {
            const errorData = await response.json();
            if (errorData?.error) errorMessage = errorData.error;
          } catch {}
          throw new Error(errorMessage);
        }
        if (!response.body) {
          throw new Error('No response body from chat API');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiResponse = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          // Reset timeout on each chunk received - stream is still active
          resetTimeout();
          
          aiResponse += decoder.decode(value, { stream: true });
          
          // Update last message with streaming content
          assistantMessage.content = aiResponse;
          renderHistory(currentMessages);
        }
        
        clearTimeout(timeoutId);
        maybeSpeak(aiResponse);

        // Reload chat from database to ensure consistency and refresh chat list (for title updates)
        await loadChats();
        const chatResponse = await authFetch(\`/api/chats/\${currentChatId}\`);
        if (chatResponse.ok) {
          const chat = await chatResponse.json();
          currentMessages = chat.messages || [];
          renderHistory(currentMessages);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        // Remove the placeholder assistant message
        currentMessages.pop();
        
        if (error.name === 'AbortError') {
          const errorMsg = { role: 'assistant', content: 'Sorry, the request timed out after 5 minutes of inactivity. Please try again.' };
          currentMessages.push(errorMsg);
        } else {
          const errorMsg = { role: 'assistant', content: 'Sorry, I encountered an error: ' + error.message };
          currentMessages.push(errorMsg);
        }
        renderHistory(currentMessages);
      } finally {
        button.disabled = false;
        button.textContent = 'Send';
      }
    }
    
    // Event listeners
    document.getElementById('new-chat-button').addEventListener('click', createNewChat);
    document.getElementById('send-button').addEventListener('click', sendMessage);
    const messageInput = document.getElementById('message-input');
    function autoResizeInput() {
      messageInput.style.height = 'auto';
      const nextHeight = Math.min(messageInput.scrollHeight, 192);
      messageInput.style.height = nextHeight + 'px';
    }
    messageInput.addEventListener('input', autoResizeInput);
    autoResizeInput();
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // --- Voice input (push-to-talk mic button) ---
    const micButton = document.getElementById('mic-button');
    let mediaRecorder = null;
    let recordedChunks = [];

    function stripMarkdownForSpeech(text) {
      return text
        .replace(/\`\`\`[\\s\\S]*?\`\`\`/g, '')
        .replace(/[*_#\`>~]/g, '')
        .replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, '$1')
        .trim();
    }

    async function startRecording() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          micButton.classList.remove('recording');
          micButton.textContent = '⏳';
          micButton.disabled = true;
          try {
            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const res = await authFetch('/api/chat/transcribe', { method: 'POST', body: blob });
            const data = await res.json();
            if (data.text) {
              messageInput.value = (messageInput.value ? messageInput.value + ' ' : '') + data.text;
              autoResizeInput();
              messageInput.focus();
            } else if (data.error) {
              console.error('Transcription failed:', data.error);
            }
          } catch (err) {
            console.error('Transcription request failed:', err);
          } finally {
            micButton.textContent = '🎤';
            micButton.disabled = false;
          }
        };
        mediaRecorder.start();
        micButton.classList.add('recording');
        micButton.textContent = '⏹';
      } catch (err) {
        console.error('Microphone access failed:', err);
        alert('Could not access the microphone: ' + err.message);
      }
    }

    micButton.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      } else {
        startRecording();
      }
    });

    // --- Voice output (speak replies aloud) ---
    const SPEAK_TOGGLE_KEY = 'ronin-chat-speak-replies';
    const speakToggle = document.getElementById('speak-toggle');

    function speakEnabled() {
      try { return localStorage.getItem(SPEAK_TOGGLE_KEY) === 'true'; } catch { return false; }
    }
    function renderSpeakToggle() {
      const on = speakEnabled();
      speakToggle.classList.toggle('active', on);
      speakToggle.textContent = on ? '🔊 Speak replies' : '🔇 Speak replies';
    }
    speakToggle.addEventListener('click', () => {
      try { localStorage.setItem(SPEAK_TOGGLE_KEY, speakEnabled() ? 'false' : 'true'); } catch {}
      renderSpeakToggle();
    });
    renderSpeakToggle();

    function maybeSpeak(text) {
      if (!speakEnabled() || !text) return;
      // Fire-and-forget — plays through this Mac's speakers (via local.speech.say),
      // not the browser/device viewing this page.
      authFetch('/api/chat/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: stripMarkdownForSpeech(text) }),
      }).catch(err => console.error('Speak request failed:', err));
    }
    
    // Keyboard shortcut for new chat
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        createNewChat();
      }
    });
    
    // File drop zone
    const dropZone = document.getElementById('drop-zone');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (eventName === 'dragenter' || eventName === 'dragover') {
          dropZone.classList.add('drag-over');
        } else {
          dropZone.classList.remove('drag-over');
        }
        if (eventName === 'drop') {
          const file = e.dataTransfer.files[0];
          if (file) {
            console.log('File dropped:', file.name);
          }
        }
      });
    });
    
    // Initialize
    (async () => {
      await loadChats();
      const chatIdFromURL = getChatIdFromURL();
      if (chatIdFromURL) {
        await switchToChat(chatIdFromURL);
      } else {
        renderHistory([]);
      }
    })();
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  /**
   * Handle chat API requests
   */
  private async handleChatAPI(req: Request): Promise<Response> {
    const denied = this.requireRemoteToken(req);
    if (denied) return denied;
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const taskId = crypto.randomUUID();
    const taskStartTime = Date.now();

    try {
      const body = await req.json() as { message?: string; chatId?: string; model?: string };
      let { message, chatId } = body;

      if (!message) {
        return Response.json({ error: "Message required" }, { status: 400 });
      }

      if (!chatId) {
        return Response.json({ error: "Chat ID required" }, { status: 400 });
      }

      // Detect @ninja tag — if present, use the smart/cloud model for this turn
      const { cleaned, ninja } = ChattyAgent.extractNinjaTag(message);
      if (ninja) {
        message = cleaned;
        console.log(`[Chatty] @ninja detected — using smart model for this turn`);
      }

      // Load chat history from database
      const messages = await this.getChatMessages(chatId);
      const history = messages.map(m => ({ role: m.role, content: m.content }));

      // Window messages to fit budget (cached summary for older messages)
      const BUDGET = 4000;
      const windowed = await windowMessages(history, BUDGET, {
        chatId,
        api: this.api,
        recentCount: 8,
      });

      // Build Ronin context (memoized with decay)
      const context = await getRoninContext(this.api);

      // Pull in a matching workflows/*.md guidance doc for this message, if
      // any (see docs/WORKFLOWS_PLAN.md §4) — read-only, never a tool call,
      // same "no match, no-op" contract as createWorkflowContextMiddleware.
      const workflowMatch = discoverWorkflow(message);
      const workflowSections = workflowMatch
        ? [
            `Workflow guidance (matched by ${workflowMatch.how}): "${workflowMatch.workflow.frontmatter.name}"\n` +
              `This is operator-authored guidance for how this kind of work should go — follow it as a standard, not a rigid script. It is not a tool and cannot be called.\n\n` +
              workflowMatch.workflow.body,
          ]
        : [];

      // Include architecture only on first message
      const isFirstMessage = history.length === 0;
      const systemPrompt = buildSystemPrompt(context, {
        includeArchitecture: isFirstMessage,
        includeRouteList: true,
        artifactsHint: context.hasArtifacts,
        sections: workflowSections,
      });

      // Log context for debugging
      console.log(`[Chatty] Context: ${context.duties.length} duties, ${context.plugins.length} plugins, ${context.routes.length} routes`);

      const userMessage = isFirstMessage
        ? `${systemPrompt}\n\nUser question: ${message}`
        : message;

      const recentWithUser: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        ...windowed.recentMessages.map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        { role: "user" as const, content: userMessage },
      ];
      if (windowed.summary) {
        recentWithUser.unshift({
          role: "system" as const,
          content: `Summary of earlier conversation:\n${windowed.summary}`,
        });
      }

      const aiMessages = [
        { role: "system" as const, content: systemPrompt },
        ...recentWithUser,
      ];

      // Check for special commands
      if (message.startsWith("/ronin ")) {
        return await this.handleRoninCommand(message, aiMessages);
      }

      // Save user message to database (invalidate summary so it can be refreshed)
      invalidateChatSummary(chatId);
      await this.addMessage(chatId, "user", message);
      
      // Generate title from first user message
      const chat = await this.getChat(chatId);
      if (chat && chat.title === "New Chat" && history.length === 0) {
        const title = this.generateTitle(message);
        await this.updateChatTitle(chatId, title);
      }

      // Analytics: track chat completion task
      this.api.events.emit("agent.task.started", {
        agent: "chatty", taskId, taskName: "chat-completion", timestamp: taskStartTime,
      }, "chatty");

      // Model resolution: @ninja or explicit "smart"/"cloud" → smart; default → local
      const api = this.api;
      const requestedModel = ninja ? "smart" : this.normalizeRequestedModel(body.model);
      if (requestedModel === "smart") {
        const aiConfig = this.api.config.getAI();
        const smartUrl = (aiConfig.ollamaSmartUrl || "").trim();
        if (aiConfig.provider !== "ollama" || !smartUrl) {
          return Response.json(
            {
              error:
                "Smart/cloud model requested but ai.ollamaSmartUrl is not configured on the running instance.",
            },
            { status: 400 }
          );
        }
      }
      const model = requestedModel || this.localModel;
      const chattyAgent = this; // Capture this for use in transform stream
      let assistantResponse = "";
      
      // Create a transform stream that collects chunks and saves the message when done
      const transformStream = new TransformStream({
        transform(chunk, controller) {
          assistantResponse += new TextDecoder().decode(chunk);
          controller.enqueue(chunk);
        },
        async flush() {
          // Save assistant message after stream completes
          if (assistantResponse) {
            try {
              await chattyAgent.addMessage(chatId, "assistant", assistantResponse);
            } catch (error) {
              console.error("Failed to save assistant message:", error);
            }
          }
          // Analytics: task completed
          chattyAgent.chatCount++;
          api.events.emit("agent.task.completed", {
            agent: "chatty", taskId, duration: Date.now() - taskStartTime, timestamp: Date.now(),
          }, "chatty");
          api.events.emit("agent.metric", {
            agent: "chatty", metric: "messages_processed", value: chattyAgent.chatCount, timestamp: Date.now(),
          }, "chatty");
          // Ontology: record conversation turn for knowledge graph
          api.events.emit("chat.conversation", {
            source: "chatty",
            sourceChannel: chatId,
            userMessage: message.slice(0, 200),
            assistantReply: assistantResponse.slice(0, 200),
            timestamp: Date.now(),
          }, "chatty");
          chattyAgent.emitHomeFeed("Active", `Messages processed: ${chattyAgent.chatCount}`);
        },
      });
      
      const sourceStream = new ReadableStream({
        async start(controller) {
          try {
            const responseText = await chattyAgent.generateToolEnabledReply({
              systemPrompt,
              aiMessages,
              userMessage: message,
              model,
            });
            controller.enqueue(new TextEncoder().encode(responseText));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      
      const stream = sourceStream.pipeThrough(transformStream);

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      // Analytics: task failed (failureNotes/request for SkillMaker)
      this.api.events.emit("agent.task.failed", {
        agent: "chatty", taskId, duration: Date.now() - taskStartTime,
        error: (error as Error).message, timestamp: Date.now(),
        failureNotes: (error as Error).message,
        request: "chat",
        description: "Chat completion",
      }, "chatty");
      this.emitHomeFeed("Error", (error as Error).message.slice(0, 120), 92);
      console.error("Chat API error:", error);
      return Response.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  private async generateToolEnabledReply(params: {
    systemPrompt: string;
    aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    userMessage: string;
    model: string;
  }): Promise<string> {
    // When the requested model is the local/default model, use the smart model
    // for tool-calling rounds (needs accuracy) but the local model for plain chat.
    const chatModel = params.model;
    const toolCallingModel = params.model === this.localModel ? this.toolModel : params.model;

    // Auto-wrapped plugin tools (~186 of them, one per plugin method) are NOT
    // included up front — that's 8-20k tokens of schema overhead on every
    // turn, and this path bypasses the tokenGuard middleware entirely.
    // Everything else (local.*, mcp:*, and duty-self-registered tools like
    // contracts.proposeReflex) stays always visible; the model sees a compact
    // category index instead and calls local.tools.load_category to pull in a
    // specific plugin category's real schemas when it decides it needs one.
    // See src/tools/toolDocs.ts (buildToolContext/expandToolContextForCategory
    // — also unit-tested directly there, independent of chat's own machinery).
    const toolContext = await loadToolContext(this.api);
    const systemPromptWithToolIndex = toolContext.categoryIndexText
      ? `${params.systemPrompt}\n\n${toolContext.categoryIndexText}`
      : params.systemPrompt;

    const toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }> = [];
    const calledToolSignatures = new Set<string>();
    let consecutiveEmptyResults = 0;
    let finalResponse = "";

    if (toolContext.schemas.length === 0) {
      const fallback = await this.api.ai.chat(params.aiMessages, {
        model: chatModel,
        maxTokens: 2000,
        temperature: 0.7,
      });
      return fallback.content || "I couldn't generate a response.";
    }

    // If the selected chat backend cannot natively call tools (e.g. Opencode CLI),
    // use a ReAct-style planning loop: ask the model which tools it needs, run
    // them locally through ToolRouter, then ask it to synthesize an answer.
    const backendSupportsTools = this.api.ai.supportsToolCalling?.(chatModel) ?? true;
    if (!backendSupportsTools) {
      return this.generateHybridReActReply({
        systemPrompt: systemPromptWithToolIndex,
        aiMessages: params.aiMessages,
        userMessage: params.userMessage,
        chatModel,
        toolCallingModel,
      });
    }

    for (let iteration = 0; iteration < this.maxToolIterations; iteration++) {
      const prompt = buildToolPrompt({
        systemPrompt: systemPromptWithToolIndex,
        aiMessages: params.aiMessages,
        toolResults,
      });

      // Tool-calling round: use smart model for reliable function calling
      // OpenAIFunctionSchema and DutyAPI's Tool are the same
      // {type:"function", function:{name,description,parameters}} wire shape — Tool's
      // `parameters` is just declared narrower (no nested items/enum) than the real
      // JSONSchema type these schemas actually carry. callTools forwards the array
      // straight through to the provider as JSON, so this is a type-only mismatch.
      const result = await this.api.ai.callTools(prompt, toolContext.schemas as unknown as Tool[], {
        model: toolCallingModel,
        maxTokens: 2000,
        temperature: 0.7,
      });

      if (result.message.content?.trim()) {
        finalResponse = result.message.content.trim();
      }

      if (!result.toolCalls.length) {
        break;
      }

      // Loop detection: check if the model is calling the same tools again
      const currentSignatures = result.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.arguments ?? {}).slice(0, 100)}`);
      let duplicateCount = 0;
      for (const sig of currentSignatures) {
        if (calledToolSignatures.has(sig)) duplicateCount++;
        calledToolSignatures.add(sig);
      }
      // If more than half the calls are duplicates, break the loop
      if (duplicateCount > currentSignatures.length / 2) {
        console.log(`[Chatty] Breaking tool loop: ${duplicateCount}/${currentSignatures.length} duplicate calls`);
        if (!finalResponse) {
          finalResponse = "I searched for information but wasn't able to find what I was looking for through tools. Let me answer from my knowledge instead.";
        }
        break;
      }

      const sayToolNames = new Set<string>(["say", "speech.say", "local.speech.say"]);
      let ranSayTool = false;
      let ranNonSayTool = false;
      for (const call of result.toolCalls.slice(0, this.maxToolsPerIteration)) {
        try {
          const execution = await this.api.tools.execute(call.name, call.arguments || {}, {
            conversationId: `chatty-${Date.now()}`,
            originalQuery: params.userMessage,
            metadata: { dutyName: "chatty" },
          });
          if (sayToolNames.has(call.name)) ranSayTool = true;
          else ranNonSayTool = true;
          toolResults.push({
            name: call.name,
            success: execution.success,
            result: execution.data,
            error: execution.error,
          });

          // Category loaded — bring its real tool schemas into scope so the
          // model can actually invoke them on the next iteration. It already
          // got the docs back as this call's result; this just makes the
          // matching tools callable, not just readable.
          if (call.name === "local.tools.load_category" && execution.success) {
            const category = String((call.arguments as { category?: unknown } | undefined)?.category ?? "").trim();
            if (category) expandToolContextForCategory(toolContext, category);
          }
        } catch (error) {
          if (sayToolNames.has(call.name)) ranSayTool = true;
          else ranNonSayTool = true;
          toolResults.push({
            name: call.name,
            success: false,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // If we ran a non-say tool, do another round so the model can reply using results.
      // Clear any placeholder reply so we don't return "Let me check..." instead of the real answer.
      if (ranNonSayTool) {
        // Track empty/unhelpful results — if tools return nothing useful twice, stop
        const usefulResults = toolResults.filter((tr) => tr.success && tr.result != null && tr.result !== "" && !(typeof tr.result === "object" && Object.keys(tr.result as object).length === 0));
        if (usefulResults.length === 0) {
          consecutiveEmptyResults++;
          if (consecutiveEmptyResults >= 2) {
            console.log(`[Chatty] Breaking tool loop: ${consecutiveEmptyResults} consecutive empty result rounds`);
            if (!finalResponse) {
              finalResponse = "I tried looking that up but couldn't find the information through available tools. I'll answer based on what I know.";
            }
            break;
          }
        } else {
          consecutiveEmptyResults = 0;
        }
        finalResponse = "";
        continue;
      }
      if (finalResponse || ranSayTool) break;
    }

    if (finalResponse) {
      return injectDutyProposalCardIntoResponse(
        injectWorkflowProposalCardIntoResponse(
          injectContractProposalCardIntoResponse(
            injectMermaidLinkIntoResponse(finalResponse, toolResults),
            toolResults
          ),
          toolResults
        ),
        toolResults
      );
    }

    // If tools ran but failed and the model didn't return a reply, give a clear failure resolution
    const failed = toolResults.find((tr) => !tr.success || tr.error);
    if (failed) {
      const reason = failed.error || (typeof failed.result === "string" ? failed.result : "Unknown error");
      return `That didn't work. **${failed.name}** failed: ${reason}`;
    }

    // Some models/providers return empty content even after successful tool reads.
    // For simple read/list tools, fall back to returning the raw tool result so
    // the user gets the data instead of a generic "I couldn't generate a response."
    const successfulRead = toolResults.find((tr) =>
      tr.success &&
      (tr.result != null && tr.result !== "") &&
      /\.(read|list|get|search|status|log|diff|branch|show|info)|^mcp_filesystem_(read|list|search)|^local\.(file|db|memory|discord|obsidian)|^git_/.test(tr.name)
    );
    if (successfulRead) {
      const raw = typeof successfulRead.result === "string"
        ? successfulRead.result
        : JSON.stringify(successfulRead.result, null, 2);
      // Cap length so we don't flood the chat; the model can ask for more if needed.
      const MAX_DIRECT_RESULT = 2000;
      const display = raw.length > MAX_DIRECT_RESULT
        ? raw.slice(0, MAX_DIRECT_RESULT) + "\n\n[truncated]"
        : raw;
      console.log(`[Chatty] Model returned empty response after successful ${successfulRead.name}; returning raw result`);
      return injectMermaidLinkIntoResponse(display, toolResults);
    }

    const fallback = await this.api.ai.chat(params.aiMessages, {
      model: chatModel,
      maxTokens: 2000,
      temperature: 0.7,
    });
    return fallback.content || "I couldn't generate a response.";
  }

  /**
   * ReAct-style loop for backends that do not support native function calling
   * (e.g. Opencode CLI). The backend plans which tools to use; Ronin executes
   * them through ToolRouter; then the backend synthesizes the final answer.
   */
  private async generateHybridReActReply(params: {
    systemPrompt: string;
    aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    userMessage: string;
    chatModel: string;
    toolCallingModel: string;
  }): Promise<string> {
    const toolContext = await loadToolContext(this.api);
    const toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }> = [];

    // Planning prompt: ask the model to pick tools using a strict textual format.
    const planPrompt = this.buildReActPlanPrompt({
      systemPrompt: params.systemPrompt,
      aiMessages: params.aiMessages,
      userMessage: params.userMessage,
      tools: toolContext.schemas as unknown as Tool[],
    });

    const planResponse = await this.api.ai.chat(
      [{ role: "user", content: planPrompt }],
      { model: params.chatModel, maxTokens: 2000, temperature: 0.5 }
    );

    const plannedCalls = parseReActToolCalls(planResponse.content || "");
    console.log(`[Chatty] ReAct planned ${plannedCalls.length} tool call(s)`);

    // Execute planned tools locally.
    let ranAny = false;
    for (const call of plannedCalls.slice(0, this.maxToolsPerIteration)) {
      ranAny = true;
      try {
        const execution = await this.api.tools.execute(call.name, call.arguments || {}, {
          conversationId: `chatty-${Date.now()}`,
          originalQuery: params.userMessage,
          metadata: { dutyName: "chatty" },
        });
        toolResults.push({
          name: call.name,
          success: execution.success,
          result: execution.data,
          error: execution.error,
        });
        if (call.name === "local.tools.load_category" && execution.success) {
          const category = String((call.arguments as { category?: unknown } | undefined)?.category ?? "").trim();
          if (category) expandToolContextForCategory(toolContext, category);
        }
      } catch (error) {
        toolResults.push({
          name: call.name,
          success: false,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // If no tools were planned, just return the model's direct response.
    if (!ranAny) {
      return planResponse.content || "I couldn't generate a response.";
    }

    // Synthesis prompt: ask the model to answer the user based on tool results.
    const synthesisPrompt = this.buildReActSynthesisPrompt({
      systemPrompt: params.systemPrompt,
      aiMessages: params.aiMessages,
      userMessage: params.userMessage,
      toolResults,
    });

    const final = await this.api.ai.chat(
      [{ role: "user", content: synthesisPrompt }],
      { model: params.chatModel, maxTokens: 2000, temperature: 0.7 }
    );

    return final.content?.trim() || this.formatRawToolResult(toolResults);
  }

  private buildReActPlanPrompt(params: {
    systemPrompt: string;
    aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    userMessage: string;
    tools: Tool[];
  }): string {
    const toolList = params.tools
      .map((t) => `- ${t.function.name}: ${t.function.description}`)
      .join("\n");
    return `${params.systemPrompt}

You are acting as a planner for a tool-using assistant. The user asked:
"""
${params.userMessage}
"""

Available tools:
${toolList}

To use a tool, output exactly one line per tool call in this format:
TOOL: tool_name {"param":"value"}

If no tool is needed, output NONE and then a brief direct answer.

Plan:`;
  }

  private buildReActSynthesisPrompt(params: {
    systemPrompt: string;
    aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    userMessage: string;
    toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }>;
  }): string {
    const results = params.toolResults
      .map((tr) => {
        const resultText = tr.success
          ? (typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result, null, 2))
          : `Error: ${tr.error || "failed"}`;
        return `[${tr.name}]\n${resultText}`;
      })
      .join("\n\n");
    return `${params.systemPrompt}

The user asked:
"""
${params.userMessage}
"""

Here are the results from the tools you requested:
${results}

Provide a concise final answer to the user. If a tool failed, explain what happened.`;
  }

  private formatRawToolResult(toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }>): string {
    const successfulRead = toolResults.find((tr) =>
      tr.success &&
      (tr.result != null && tr.result !== "") &&
      /\.(read|list|get|search|status|log|diff|branch|show|info)|^mcp_filesystem_(read|list|search)|^local\.(file|db|memory|discord|obsidian)|^git_/.test(tr.name)
    );
    if (successfulRead) {
      const raw = typeof successfulRead.result === "string"
        ? successfulRead.result
        : JSON.stringify(successfulRead.result, null, 2);
      const MAX_DIRECT_RESULT = 2000;
      return raw.length > MAX_DIRECT_RESULT
        ? raw.slice(0, MAX_DIRECT_RESULT) + "\n\n[truncated]"
        : raw;
    }
    const failed = toolResults.find((tr) => !tr.success || tr.error);
    if (failed) {
      return `That didn't work. **${failed.name}** failed: ${failed.error || "Unknown error"}`;
    }
    return "I couldn't generate a response.";
  }

  /**
   * Handle /ronin commands
   */
  private async handleRoninCommand(
    command: string,
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
  ): Promise<Response> {
    const parts = command.split(" ");
    const cmd = parts[1];

    if (cmd === "list" && parts[2] === "agents") {
      const context = await getRoninContext(this.api);
      const agentList = context.duties.map((a) => `- ${a.name}${a.description ? `: ${a.description.substring(0, 100)}` : ""}`).join("\n");
      return new Response(
        `Available agents:\n${agentList}`,
        { headers: { "Content-Type": "text/plain" } }
      );
    }

    if (cmd === "analyze" && parts[2]) {
      const topic = parts.slice(2).join(" ");
      try {
        const analysisPrompt = `Analyze the following topic and provide structured insights:

Topic: ${topic}

Please provide:
1. Key concepts
2. Important relationships
3. Practical applications
4. Recommended next steps

Format as clear, actionable summary.`;

        const stack = standardSAR({ maxTokens: 4096 });
        const chain = this.createChain("chatty-analysis");
        chain.useMiddlewareStack(stack);
        
        const ctx: any = {
          messages: [
            { role: "system", content: "You are an expert analyst providing clear, structured insights." },
            { role: "user", content: analysisPrompt },
          ],
          ontology: { domain: "analysis", relevantSkills: [] },
          budget: { max: 4096, current: 0, reservedForResponse: 512 },
          conversationId: `analyze-${topic}-${Date.now()}`,
          metadata: { maxToolIterations: 2 },
        };

        chain.withContext(ctx);
        await chain.run();

        const result = ctx.messages
          .filter((m: any) => m.role === "assistant")
          .map((m: any) => m.content)
          .join("\n\n");

        return new Response(result || "Analysis completed.", { headers: { "Content-Type": "text/plain" } });
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 500 });
      }
    }

    return new Response(`Unknown command: ${cmd}`, { status: 400 });
  }
}
