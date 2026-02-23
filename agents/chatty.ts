import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { standardSAR } from "../src/chains/templates.js";
import { ensureRoninDataDir } from "../src/utils/paths.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";
import {
  getRoninContext,
  buildSystemPrompt,
  buildToolPrompt,
  windowMessages,
  invalidateChatSummary,
  filterToolSchemas,
  injectMermaidLinkIntoResponse,
} from "../src/utils/prompt.js";

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
export default class ChattyAgent extends BaseAgent {
  private localModel: string;
  private toolModel: string;
  private chatCount = 0;
  private readonly maxToolIterations = 4;
  private readonly maxToolsPerIteration = 6;

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

  constructor(api: AgentAPI) {
    super(api);
    this.localModel = this.resolveLocalModel();
    this.toolModel = this.resolveToolModel();
    this.initializeDatabase();
    this.registerRoutes();

    // Analytics: report lifecycle
    this.api.events.emit("agent.lifecycle", {
      agent: "chatty", status: "started", timestamp: Date.now(),
    }, "chatty");

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

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/chat", this.handleChatUI.bind(this));
    this.api.http.registerRoute("/api/chat", this.handleChatAPI.bind(this));
    this.api.http.registerRoute("/api/chats", this.handleChatsAPI.bind(this));
    // Register route with trailing slash for prefix matching (handles /api/chats/xxx)
    this.api.http.registerRoute("/api/chats/", this.handleChatByIdAPI.bind(this));
  }

  /**
   * Handle chat management API (GET /api/chats, POST /api/chats)
   */
  private async handleChatsAPI(req: Request): Promise<Response> {
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
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Chat</title>
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

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
      background: ${roninTheme.colors.backgroundSecondary};
      border-right: 1px solid ${roninTheme.colors.border};
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    
    .sidebar-header {
      padding: ${roninTheme.spacing.md};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .new-chat-button {
      width: 100%;
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textPrimary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.3s;
    }
    
    .new-chat-button:hover {
      background: ${roninTheme.colors.accent};
      border-color: ${roninTheme.colors.borderHover};
    }
    
    .chat-list {
      flex: 1;
      overflow-y: auto;
      padding: ${roninTheme.spacing.sm};
    }
    
    .chat-item {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      margin-bottom: ${roninTheme.spacing.xs};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
    }
    
    .chat-item:hover {
      background: ${roninTheme.colors.backgroundTertiary};
    }
    
    .chat-item.active {
      background: ${roninTheme.colors.accent};
      border: 1px solid ${roninTheme.colors.borderHover};
    }
    
    .chat-item-content {
      flex: 1;
      min-width: 0;
    }
    
    .chat-item-title {
      font-size: 0.8125rem;
      color: ${roninTheme.colors.textPrimary};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.125rem;
    }
    
    .chat-item-time {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
    }
    
    .chat-item-delete {
      opacity: 0;
      padding: 0.25rem;
      background: transparent;
      border: none;
      color: ${roninTheme.colors.textTertiary};
      cursor: pointer;
      font-size: 0.75rem;
      transition: all 0.2s;
    }
    
    .chat-item:hover .chat-item-delete {
      opacity: 1;
    }
    
    .chat-item-delete:hover {
      color: ${roninTheme.colors.error};
    }
    
    .empty-state {
      padding: ${roninTheme.spacing.lg};
      text-align: center;
      color: ${roninTheme.colors.textTertiary};
      font-size: 0.75rem;
    }
    
    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: ${roninTheme.colors.background};
      overflow: hidden;
    }
    
    #chat-history {
      flex: 1;
      overflow-y: auto;
      padding: ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.background};
    }
    
    .message {
      margin-bottom: 1rem;
      display: flex;
      gap: 0.75rem;
    }
    
    .message.user { flex-direction: row-reverse; }
    
    .message-content {
      max-width: 70%;
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      border-radius: ${roninTheme.borderRadius.md};
      word-wrap: break-word;
      font-size: 0.8125rem; /* 13px - smaller */
      line-height: 1.5;
    }
    
    .message.user .message-content {
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textPrimary};
      border: 1px solid ${roninTheme.colors.border};
      border-bottom-right-radius: ${roninTheme.borderRadius.sm};
    }
    
    .message.assistant .message-content {
      background: ${roninTheme.colors.backgroundSecondary};
      color: ${roninTheme.colors.textPrimary};
      border: 1px solid ${roninTheme.colors.border};
      border-bottom-left-radius: ${roninTheme.borderRadius.sm};
    }
    
    .message-content h1,
    .message-content h2,
    .message-content h3 {
      margin-top: ${roninTheme.spacing.sm};
      margin-bottom: ${roninTheme.spacing.sm};
      font-weight: 300;
    }
    
    .message-content h1 { font-size: 1.25rem; /* Smaller */ }
    .message-content h2 { font-size: 1.125rem; /* Smaller */ }
    .message-content h3 { font-size: 1rem; /* Smaller */ }
    
    .message-content p {
      margin: ${roninTheme.spacing.sm} 0;
      line-height: 1.6;
      font-size: 0.8125rem; /* 13px */
    }
    
    .message-content ul,
    .message-content ol {
      margin: ${roninTheme.spacing.sm} 0;
      padding-left: ${roninTheme.spacing.lg};
    }
    
    .message-content li {
      margin: ${roninTheme.spacing.xs} 0;
      font-size: 0.8125rem; /* 13px */
    }
    
    .message-content code {
      background: ${roninTheme.colors.backgroundTertiary};
      padding: 0.125rem 0.375rem;
      border-radius: ${roninTheme.borderRadius.sm};
      font-family: ${roninTheme.fonts.mono};
      font-size: 0.75rem; /* 12px - smaller */
    }
    
    .message.user .message-content code {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .message-content pre {
      background: #161b22 !important;
      padding: ${roninTheme.spacing.md};
      border-radius: ${roninTheme.borderRadius.md};
      overflow-x: auto;
      margin: ${roninTheme.spacing.sm} 0;
      border: 1px solid ${roninTheme.colors.border};
    }
    
    .message.user .message-content pre {
      background: rgba(255, 255, 255, 0.05) !important;
      border-color: ${roninTheme.colors.border};
    }
    
    .message-content pre code {
      background: none !important;
      padding: 0;
      font-size: 0.75rem; /* 12px */
      color: inherit;
    }
    
    .message-content blockquote {
      border-left: 2px solid ${roninTheme.colors.borderHover};
      padding-left: ${roninTheme.spacing.md};
      margin: ${roninTheme.spacing.sm} 0;
      color: ${roninTheme.colors.textSecondary};
      font-style: italic;
    }
    
    .message-content strong {
      font-weight: 500;
    }
    
    .message-content em {
      font-style: italic;
    }
    
    .message-content a {
      color: ${roninTheme.colors.textSecondary};
      text-decoration: none;
    }
    
    .message-content a:hover {
      color: ${roninTheme.colors.textPrimary};
      text-decoration: underline;
    }
    
    .message.user .message-content a {
      color: ${roninTheme.colors.textPrimary};
    }
    
    .input-area {
      padding: ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border-top: 1px solid ${roninTheme.colors.border};
      display: flex;
      gap: ${roninTheme.spacing.sm};
      flex-shrink: 0;
    }
    
    #message-input {
      flex: 1;
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      font-size: 0.8125rem; /* 13px - smaller */
      background: ${roninTheme.colors.background};
      color: ${roninTheme.colors.textPrimary};
      outline: none;
      transition: all 0.3s;
    }
    
    #message-input:focus {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.backgroundSecondary};
    }
    
    #message-input::placeholder {
      color: ${roninTheme.colors.textTertiary};
    }
    
    #send-button {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textPrimary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      font-size: 0.8125rem; /* 13px - smaller */
      cursor: pointer;
      transition: all 0.3s;
    }
    
    #send-button:hover:not(:disabled) {
      background: ${roninTheme.colors.accent};
      border-color: ${roninTheme.colors.borderHover};
    }
    
    #send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    #drop-zone {
      padding: ${roninTheme.spacing.md};
      border: 2px dashed ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      text-align: center;
      color: ${roninTheme.colors.textTertiary};
      margin-bottom: ${roninTheme.spacing.sm};
      display: none;
      font-size: 0.75rem; /* 12px */
    }
    
    #drop-zone.drag-over {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.backgroundSecondary};
    }
    
    .loading {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid ${roninTheme.colors.border};
      border-top-color: ${roninTheme.colors.textPrimary};
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
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>💬 Ronin Chat</h1>
    <div class="header-meta">Chat with AI that understands your Ronin setup</div>
  </div>
  <div class="main-container">
    <div class="sidebar">
      <div class="sidebar-header">
        <button class="new-chat-button" id="new-chat-button">+ New Chat</button>
      </div>
      <div class="chat-list" id="chat-list">
        <div class="empty-state">Loading chats...</div>
      </div>
    </div>
    <div class="chat-container">
      <div id="chat-history"></div>
      <div id="drop-zone">Drop files here to analyze</div>
      <div class="input-area">
        <input type="text" id="message-input" placeholder="Type a message... (add @ninja for smart model)" />
        <button id="send-button">Send</button>
      </div>
    </div>
  </div>
  <script>
    let currentChatId = null;
    let chats = [];
    let currentMessages = []; // Maintain message state
    
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
        const response = await fetch('/api/chats');
        if (!response.ok) throw new Error('Failed to load chats');
        chats = await response.json();
        renderChatList();
      } catch (error) {
        console.error('Failed to load chats:', error);
        document.getElementById('chat-list').innerHTML = '<div class="empty-state">Failed to load chats</div>';
      }
    }
    
    function renderChatList() {
      const container = document.getElementById('chat-list');
      if (chats.length === 0) {
        container.innerHTML = '<div class="empty-state">No chats yet. Create a new one!</div>';
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
        const response = await fetch(\`/api/chats/\${chatId}\`);
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
        const response = await fetch('/api/chats', {
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
        const response = await fetch(\`/api/chats/\${chatId}\`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete chat');
        
        await loadChats(); // Reload to get updated list
        if (currentChatId === chatId) {
          currentChatId = null;
          currentMessages = [];
          updateURL(null);
          document.getElementById('chat-history').innerHTML = '';
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
    
    function renderHistory(messages) {
      const container = document.getElementById('chat-history');
      container.innerHTML = '';
      
      messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = \`message \${msg.role}\`;
        const content = document.createElement('div');
        content.className = 'message-content';
        
        // Render markdown for assistant messages, plain text for user messages
        if (msg.role === 'assistant') {
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
              content.innerHTML = marked.parse(msg.content);
              
              // Apply syntax highlighting to code blocks
              if (typeof hljs !== 'undefined' && hljs) {
                content.querySelectorAll('pre code').forEach(block => {
                  hljs.highlightElement(block);
                });
              }
            } catch (e) {
              console.warn('Markdown parsing failed:', e);
              const text = msg.content.replace(/&/g, '&amp;')
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
        } else {
          const text = msg.content.replace(/&/g, '&amp;')
                                  .replace(/</g, '&lt;')
                                  .replace(/>/g, '&gt;')
                                  .replace(/\\n/g, '<br>');
          content.innerHTML = text;
        }
        
        div.appendChild(content);
        container.appendChild(div);
      });
      
      container.scrollTop = container.scrollHeight;
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
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, chatId: currentChatId }),
          signal: controller.signal
        });
        
        if (!response.ok) {
          throw new Error('Request failed');
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
        
        // Reload chat from database to ensure consistency and refresh chat list (for title updates)
        await loadChats();
        const chatResponse = await fetch(\`/api/chats/\${currentChatId}\`);
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
    document.getElementById('message-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    
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

      // Include architecture only on first message
      const isFirstMessage = history.length === 0;
      const systemPrompt = buildSystemPrompt(context, {
        includeArchitecture: isFirstMessage,
        includeRouteList: true,
        ontologyHint: context.hasOntology,
      });

      // Log context for debugging
      console.log(`[Chatty] Context: ${context.agents.length} agents, ${context.plugins.length} plugins, ${context.routes.length} routes`);

      const userMessage = isFirstMessage
        ? `${systemPrompt}\n\nUser question: ${message}`
        : message;

      const recentWithUser = [
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

    const allSchemas = this.api.tools.getSchemas();
    const toolSchemas = filterToolSchemas(allSchemas, {
      message: params.userMessage,
      hasOntology: this.api.plugins.has("ontology"),
      hasSkills: !!this.api.skills,
      maxSchemas: 12,
    });
    const toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }> = [];
    let finalResponse = "";

    if (toolSchemas.length === 0) {
      const fallback = await this.api.ai.chat(params.aiMessages, {
        model: chatModel,
        maxTokens: 2000,
        temperature: 0.7,
      });
      return fallback.content || "I couldn't generate a response.";
    }

    for (let iteration = 0; iteration < this.maxToolIterations; iteration++) {
      const prompt = buildToolPrompt({
        systemPrompt: params.systemPrompt,
        aiMessages: params.aiMessages,
        toolResults,
      });

      // Tool-calling round: use smart model for reliable function calling
      const result = await this.api.ai.callTools(prompt, toolSchemas, {
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

      const sayToolNames = new Set<string>(["say", "speech.say", "local.speech.say"]);
      let ranSayTool = false;
      let ranNonSayTool = false;
      for (const call of result.toolCalls.slice(0, this.maxToolsPerIteration)) {
        try {
          const execution = await this.api.tools.execute(call.name, call.arguments || {}, {
            conversationId: `chatty-${Date.now()}`,
            originalQuery: params.userMessage,
            metadata: { agentName: "chatty" },
          });
          if (sayToolNames.has(call.name)) ranSayTool = true;
          else ranNonSayTool = true;
          toolResults.push({
            name: call.name,
            success: execution.success,
            result: execution.data,
            error: execution.error,
          });
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
        finalResponse = "";
        continue;
      }
      if (finalResponse || ranSayTool) break;
    }

    if (finalResponse) {
      return injectMermaidLinkIntoResponse(finalResponse, toolResults);
    }

    // If tools ran but failed and the model didn't return a reply, give a clear failure resolution
    const failed = toolResults.find((tr) => !tr.success || tr.error);
    if (failed) {
      const reason = failed.error || (typeof failed.result === "string" ? failed.result : "Unknown error");
      return `That didn't work. **${failed.name}** failed: ${reason}`;
    }

    const fallback = await this.api.ai.chat(params.aiMessages, {
      model: chatModel,
      maxTokens: 2000,
      temperature: 0.7,
    });
    return fallback.content || "I couldn't generate a response.";
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
      const agentList = context.agents.map((a) => `- ${a.name}${a.description ? `: ${a.description.substring(0, 100)}` : ""}`).join("\n");
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
