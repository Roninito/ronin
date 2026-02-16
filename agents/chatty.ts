import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { ensureDefaultExternalAgentDir, ensureDefaultAgentDir } from "../src/cli/commands/config.js";
import { ensureRoninDataDir } from "../src/utils/paths.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

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
  private model: string;
  private roninContext: {
    agents: Array<{ name: string; description?: string }>;
    plugins: string[];
    routes: Array<{ path: string; type: string }>;
    architecture: string;
  } | null = null;

  private chatCount = 0;

  constructor(api: AgentAPI) {
    super(api);
    // Use centralized config with env fallback
    const configAI = this.api.config.getAI();
    this.model = configAI.ollamaModel || process.env.OLLAMA_MODEL || "qwen3:1.7b";
    this.initializeDatabase();
    this.registerRoutes();

    // Analytics: report lifecycle
    this.api.events.emit("agent.lifecycle", {
      agent: "chatty", status: "started", timestamp: Date.now(),
    }, "chatty");

    console.log("💬 Chatty agent ready. Chat interface available at /chat");
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
      const modelExists = await this.api.ai.complete("test", { model: this.model, maxTokens: 1 }).catch(() => null);
      if (!modelExists) {
        console.log(`⚠️  Model ${this.model} may not be available. Ensure Ollama is running and model is pulled.`);
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
        <input type="text" id="message-input" placeholder="Type a message..." />
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
      const body = await req.json() as { message?: string; chatId?: string };
      const { message, chatId } = body;

      if (!message) {
        return Response.json({ error: "Message required" }, { status: 400 });
      }

      if (!chatId) {
        return Response.json({ error: "Chat ID required" }, { status: 400 });
      }

      // Load chat history from database
      const messages = await this.getChatMessages(chatId);
      const history = messages.map(m => ({ role: m.role, content: m.content }));

      // Build Ronin context (refresh on each request to get latest state)
      const context = await this.buildRoninContext();

      // Build system prompt with context
      const systemPrompt = this.buildSystemPrompt(context);

      // Log context for debugging
      console.log(`[Chatty] Context: ${context.agents.length} agents, ${context.plugins.length} plugins, ${context.routes.length} routes`);

      // Prepare messages - system message MUST be first
      const isFirstMessage = history.length === 0;
      const userMessage = isFirstMessage 
        ? `${systemPrompt}\n\nUser question: ${message}`
        : message;

      const aiMessages = [
        { role: "system" as const, content: systemPrompt },
        ...history.map((h: any) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        { role: "user" as const, content: userMessage },
      ];

      // Check for special commands
      if (message.startsWith("/ronin ")) {
        return await this.handleRoninCommand(message, aiMessages);
      }

      // Save user message to database
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

      // Stream response - include system message!
      const api = this.api;
      const model = this.model;
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
        },
      });
      
      const sourceStream = new ReadableStream({
        async start(controller) {
          try {
            // Include system message - don't slice it off!
            // Set timeout to 5 minutes for chat responses
            for await (const chunk of api.ai.streamChat(aiMessages, {
              model: model,
              timeoutMs: 300000, // 5 minutes timeout
              thinking: false, // Disable thinking mode for direct responses
            })) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
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
      // Analytics: task failed
      this.api.events.emit("agent.task.failed", {
        agent: "chatty", taskId, duration: Date.now() - taskStartTime,
        error: (error as Error).message, timestamp: Date.now(),
      }, "chatty");
      console.error("Chat API error:", error);
      return Response.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  /**
   * Build Ronin context
   */
  private async buildRoninContext(): Promise<{
    agents: Array<{ name: string; description?: string }>;
    plugins: string[];
    routes: Array<{ path: string; type: string }>;
    architecture: string;
  }> {
    const agents: Array<{ name: string; description?: string }> = [];
    const plugins: string[] = [];
    const routes: Array<{ path: string; type: string }> = [];

    try {
      // Discover agents from both directories
      const externalAgentDir = ensureDefaultExternalAgentDir();
      const localAgentDir = ensureDefaultAgentDir();
      
      // Try external directory first (~/.ronin/agents)
      try {
        const externalFiles = await readdir(externalAgentDir);
        for (const file of externalFiles) {
          if (file.endsWith(".ts") || file.endsWith(".js")) {
            const name = file.replace(/\.(ts|js)$/, "");
            let description: string | undefined;
            try {
              const content = await readFile(join(externalAgentDir, file), "utf-8");
              // Try to extract description from JSDoc or comments
              const descMatch = content.match(/\/\*\*[\s\S]*?\*\//) || 
                               content.match(/\/\/.*description.*/i) ||
                               content.match(/export default class \w+ extends BaseAgent[\s\S]{0,500}/);
              if (descMatch) {
                description = descMatch[0].substring(0, 200).replace(/\n/g, " ");
              }
            } catch {
              // Ignore read errors
            }
            agents.push({ name, description });
          }
        }
      } catch {
        // External directory might not exist
      }

      // Also check local agents directory
      try {
        const localFiles = await readdir(localAgentDir);
        for (const file of localFiles) {
          if (file.endsWith(".ts") || file.endsWith(".js")) {
            const name = file.replace(/\.(ts|js)$/, "");
            // Avoid duplicates
            if (!agents.find(a => a.name === name)) {
              agents.push({ name });
            }
          }
        }
      } catch {
        // Local directory might not exist
      }
    } catch (error) {
      console.warn("[Chatty] Error discovering agents:", error);
    }

    // Get plugins
    plugins.push(...this.api.plugins.list());

    // Get routes
    const allRoutes = this.api.http.getAllRoutes();
    for (const path of allRoutes.keys()) {
      routes.push({ path, type: "http" });
    }

    this.roninContext = {
      agents,
      plugins,
      routes,
      architecture: this.getArchitectureDescription(),
    };

    return this.roninContext;
  }

  /**
   * Get Ronin architecture description
   */
  private getArchitectureDescription(): string {
    return `Ronin is a Bun-based AI agent framework for TypeScript/JavaScript.

Key Components:
- Agents: Extend BaseAgent, implement execute(), auto-loaded from ~/.ronin/agents/
- Plugins: Tools in ~/.ronin/plugins/, accessed via api.plugins.call()
- Routes: Agents register HTTP routes via api.http.registerRoute()
- Events: Inter-agent communication via api.events.emit/on()
- Memory: Persistent storage via api.memory
- AI: Ollama integration via api.ai (complete, chat, callTools)
- LangChain: Advanced chains/graphs via api.langchain (if plugin loaded)

Agent Structure:
- Static schedule (cron) for scheduled execution
- Static watch (file patterns) for file watching
- Static webhook (path) for HTTP webhooks
- execute() method contains main logic
- Optional onFileChange() and onWebhook() handlers`;
  }

  /**
   * Build system prompt with Ronin context
   */
  private buildSystemPrompt(context: {
    agents: Array<{ name: string; description?: string }>;
    plugins: string[];
    routes: Array<{ path: string; type: string }>;
    architecture: string;
  }): string {
    const agentList = context.agents.length > 0 
      ? context.agents.map((a) => `  - ${a.name}${a.description ? `: ${a.description.substring(0, 100)}` : ""}`).join("\n")
      : "  (No agents found)";
    
    const pluginList = context.plugins.length > 0 
      ? context.plugins.map(p => `  - ${p}`).join("\n")
      : "  (No plugins found)";
    
    const routeList = context.routes.length > 0
      ? context.routes.map(r => `  - ${r.path}`).join("\n")
      : "  (No routes found)";

    return `You are Ronin AI, a helpful assistant for the Ronin AI agent framework.

CRITICAL: "Ronin" refers to the Ronin AI agent framework - a Bun-based TypeScript/JavaScript framework for building AI agents. This is NOT the Ronin blockchain, Ronin DeFi platform, or any cryptocurrency. When users mention "Ronin", they mean the AI agent framework.

${context.architecture}

CURRENT RONIN SETUP:

Available Agents:
${agentList}

Available Plugins:
${pluginList}

Registered Routes:
${routeList}

Your role:
- Answer questions about the Ronin AI agent framework architecture
- Explain how agents, plugins, and routes work
- Help users understand their current Ronin setup
- Discuss agent creation, plugin usage, and route registration
- Analyze agent outputs (e.g., RSS feeds) when requested

IMPORTANT: Never confuse Ronin AI agent framework with blockchain platforms. Always clarify you're discussing the AI agent framework built on Bun/TypeScript.`;
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
      const context = await this.buildRoninContext();
      const agentList = context.agents.map((a) => `- ${a.name}${a.description ? `: ${a.description.substring(0, 100)}` : ""}`).join("\n");
      return new Response(
        `Available agents:\n${agentList}`,
        { headers: { "Content-Type": "text/plain" } }
      );
    }

    if (cmd === "analyze" && parts[2]) {
      const topic = parts.slice(2).join(" ");
      if (this.api.langchain) {
        try {
          const analysis = await this.api.langchain.runAnalysisChain(topic, undefined, this.api);
          return new Response(analysis, { headers: { "Content-Type": "text/plain" } });
        } catch (error) {
          return Response.json({ error: (error as Error).message }, { status: 500 });
        }
      } else {
        return new Response("LangChain plugin not available", { status: 503 });
      }
    }

    return new Response(`Unknown command: ${cmd}`, { status: 400 });
  }
}
