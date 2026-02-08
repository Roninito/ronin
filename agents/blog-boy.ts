import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { ensureDefaultExternalAgentDir, ensureDefaultAgentDir } from "../src/cli/commands/config.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS } from "../src/utils/theme.js";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  author: string;
  published: number; // 0 = draft, 1 = published
  created_at: number;
  updated_at: number;
  published_at?: number;
  metadata?: string; // JSON string
}

interface BlogSession {
  id: string;
  token: string;
  created_at: number;
  expires_at: number;
}

/**
 * Blogs Agent - SQLite-backed blog system with markdown support
 * Provides /blog UI, /blog/admin dashboard, /blog/editor with Monaco editor,
 * and AI-powered article generation about Ronin features
 */
export default class BlogsAgent extends BaseAgent {
  private adminPasswordHash: string | null = null;
  private readonly DEFAULT_PASSWORD = "admin";
  private readonly SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
  private AI_TIMEOUT_MS: number;
  private readonly AI_MAX_TOKENS = 1800;

  constructor(api: AgentAPI) {
    super(api);
    // Use centralized config with env fallback
    const configBlogBoy = this.api.config.getBlogBoy();
    const raw = configBlogBoy.aiTimeoutMs || 
      process.env.BLOG_BOY_AI_TIMEOUT_MS || 
      process.env.RONIN_AI_TIMEOUT_MS;
    const parsed = raw ? parseInt(String(raw), 10) : NaN;
    this.AI_TIMEOUT_MS = Number.isFinite(parsed) ? parsed : 300_000; // 5 minutes
    
    this.initializeDatabase();
    this.registerRoutes();
    console.log("📝 Blogs agent ready. Blog available at /blog");
  }

  /**
   * Initialize database tables
   */
  private async initializeDatabase(): Promise<void> {
    try {
      // Create blog_posts table
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS blog_posts (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          slug TEXT UNIQUE NOT NULL,
          content TEXT NOT NULL,
          excerpt TEXT,
          author TEXT DEFAULT 'blogs',
          published INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          published_at INTEGER,
          metadata TEXT
        )
      `);

      // Create blog_sessions table
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS blog_sessions (
          id TEXT PRIMARY KEY,
          token TEXT UNIQUE NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `);

      // Create blog_admin table for password storage
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS blog_admin (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          password_hash TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // Create indexes
      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug)
      `);
      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published)
      `);
      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at)
      `);
      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_blog_sessions_token ON blog_sessions(token)
      `);

      // Initialize admin password if not exists
      const adminRows = await this.api.db.query<{ password_hash: string }>(
        `SELECT password_hash FROM blog_admin LIMIT 1`
      );
      if (adminRows.length === 0) {
        const hash = await Bun.password.hash(this.DEFAULT_PASSWORD, {
          algorithm: "bcrypt",
          cost: 10,
        });
        await this.api.db.execute(
          `INSERT INTO blog_admin (password_hash, updated_at) VALUES (?, ?)`,
          [hash, Date.now()]
        );
        this.adminPasswordHash = hash;
        console.log(`[Blog] Default admin password set to: ${this.DEFAULT_PASSWORD}`);
      } else {
        this.adminPasswordHash = adminRows[0].password_hash;
      }

      // Clean up expired sessions
      await this.cleanupExpiredSessions();
    } catch (error) {
      console.error("[Blog] Failed to initialize database:", error);
    }
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    await this.api.db.execute(
      `DELETE FROM blog_sessions WHERE expires_at < ?`,
      [now]
    );
  }

  /**
   * Generate slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Ensure unique slug
   */
  private async ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const existing = await this.api.db.query<{ id: string }>(
        `SELECT id FROM blog_posts WHERE slug = ? ${excludeId ? "AND id != ?" : ""}`,
        excludeId ? [slug, excludeId] : [slug]
      );
      if (existing.length === 0) {
        return slug;
      }
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  /**
   * Verify session token
   */
  private async verifySession(token: string): Promise<boolean> {
    if (!token) return false;
    await this.cleanupExpiredSessions();
    const sessions = await this.api.db.query<BlogSession>(
      `SELECT * FROM blog_sessions WHERE token = ? AND expires_at > ?`,
      [token, Date.now()]
    );
    return sessions.length > 0;
  }

  /**
   * Get session token from request
   */
  private getSessionToken(req: Request): string | null {
    // Check cookie first
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const cookies = cookieHeader.split(";").map((c) => c.trim());
      const sessionCookie = cookies.find((c) => c.startsWith("blog_session="));
      if (sessionCookie) {
        return sessionCookie.split("=")[1];
      }
    }
    // Check Authorization header
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    return null;
  }

  /**
   * Create session
   */
  private async createSession(): Promise<string> {
    const token = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + this.SESSION_DURATION;
    await this.api.db.execute(
      `INSERT INTO blog_sessions (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), token, now, expiresAt]
    );
    return token;
  }

  /**
   * Register all routes
   */
  private registerRoutes(): void {
    // Public routes
    this.api.http.registerRoute("/blog", this.handleBlogList.bind(this));
    this.api.http.registerRoute("/blog/", this.handleBlogList.bind(this));
    this.api.http.registerRoute("/blog/api/posts", this.handlePostsAPI.bind(this));
    this.api.http.registerRoute("/blog/api/posts/", this.handlePostBySlugAPI.bind(this));

    // Admin routes
    this.api.http.registerRoute("/blog/admin", this.handleAdminDashboard.bind(this));
    this.api.http.registerRoute("/blog/admin/", this.handleAdminDashboard.bind(this));
    this.api.http.registerRoute("/blog/api/auth/login", this.handleLogin.bind(this));
    this.api.http.registerRoute("/blog/api/auth/logout", this.handleLogout.bind(this));
    this.api.http.registerRoute("/blog/api/admin/posts", this.handleAdminPostsAPI.bind(this));
    this.api.http.registerRoute("/blog/api/admin/posts/", this.handleAdminPostByIdAPI.bind(this));
    this.api.http.registerRoute("/blog/api/admin/generate", this.handleGenerateArticle.bind(this));

    // Editor routes
    this.api.http.registerRoute("/blog/editor", this.handleEditor.bind(this));
    this.api.http.registerRoute("/blog/editor/", this.handleEditor.bind(this));
    
    // Log registered routes
    console.log("[Blog] Routes registered. All routes:");
    for (const [path] of this.api.http.getAllRoutes()) {
      console.log(`  - ${path}`);
    }
  }

  /**
   * Handle blog list page
   */
  private async handleBlogList(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      // Check if this is a specific post (slug)
      if (path !== "/blog" && path !== "/blog/") {
        const slug = path.replace("/blog/", "").replace(/\/$/, "");
        if (slug && slug !== "admin" && slug !== "editor" && !slug.startsWith("api/")) {
          return this.handleBlogPost(slug);
        }
      }

      const posts = await this.api.db.query<BlogPost>(
        `SELECT * FROM blog_posts WHERE published = 1 ORDER BY published_at DESC LIMIT 20`
      );

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog - Ronin</title>
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      min-height: 100vh;
      padding: ${roninTheme.spacing.xl};
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      text-align: center;
      margin-bottom: ${roninTheme.spacing.xl};
      padding-bottom: ${roninTheme.spacing.lg};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .header h1 {
      font-size: 2.5rem;
      margin-bottom: ${roninTheme.spacing.sm};
    }
    
    .header p {
      color: ${roninTheme.colors.textSecondary};
    }
    
    .posts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: ${roninTheme.spacing.lg};
      margin-top: ${roninTheme.spacing.xl};
    }
    
    .post-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.lg};
      transition: all 0.3s;
      cursor: pointer;
      text-decoration: none;
      display: block;
      color: ${roninTheme.colors.textPrimary};
    }
    
    .post-card:hover {
      border-color: ${roninTheme.colors.borderHover};
      background: ${roninTheme.colors.backgroundTertiary};
      transform: translateY(-2px);
    }
    
    .post-card h2 {
      font-size: 1.5rem;
      margin-bottom: ${roninTheme.spacing.sm};
    }
    
    .post-card .excerpt {
      color: ${roninTheme.colors.textSecondary};
      margin-top: ${roninTheme.spacing.sm};
      line-height: 1.6;
    }
    
    .post-card .meta {
      margin-top: ${roninTheme.spacing.md};
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
    }
    
    .empty-state {
      text-align: center;
      padding: ${roninTheme.spacing.xl};
      color: ${roninTheme.colors.textSecondary};
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Ronin Blog</h1>
    <p>Exploring agents, plugins, and features</p>
  </div>
  
  <div class="posts-grid" id="posts-grid">
    ${posts.length === 0 
      ? '<div class="empty-state">No posts yet. Check back soon!</div>'
      : posts.map(post => `
        <a href="/blog/${post.slug}" class="post-card">
          <h2>${this.escapeHtml(post.title)}</h2>
          ${post.excerpt ? `<div class="excerpt">${this.escapeHtml(post.excerpt)}</div>` : ''}
          <div class="meta">
            ${new Date(post.published_at || post.created_at).toLocaleDateString()}
            ${post.author ? ` • ${this.escapeHtml(post.author)}` : ''}
          </div>
        </a>
      `).join('')
    }
  </div>
  
  <script>
    // Auto-highlight code blocks when page loads
    if (typeof hljs !== 'undefined') {
      hljs.highlightAll();
    }
  </script>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      console.error("[Blog] Error handling blog list:", error);
      return new Response("Error loading blog posts", { status: 500 });
    }
  }

  /**
   * Handle individual blog post page
   */
  private async handleBlogPost(slug: string): Promise<Response> {
    try {
      const posts = await this.api.db.query<BlogPost>(
        `SELECT * FROM blog_posts WHERE slug = ? AND published = 1`,
        [slug]
      );

      if (posts.length === 0) {
        return new Response("Post not found", { status: 404 });
      }

    const post = posts[0];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(post.title)} - Ronin Blog</title>
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      min-height: 100vh;
      padding: ${roninTheme.spacing.xl};
      max-width: 800px;
      margin: 0 auto;
    }
    
    .back-link {
      display: inline-block;
      margin-bottom: ${roninTheme.spacing.lg};
      color: ${roninTheme.colors.textSecondary};
      text-decoration: none;
    }
    
    .back-link:hover {
      color: ${roninTheme.colors.textPrimary};
    }
    
    .post-header {
      margin-bottom: ${roninTheme.spacing.xl};
      padding-bottom: ${roninTheme.spacing.lg};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .post-header h1 {
      font-size: 2.5rem;
      margin-bottom: ${roninTheme.spacing.md};
    }
    
    .post-meta {
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.875rem;
    }
    
    .post-content {
      line-height: 1.8;
      margin-top: ${roninTheme.spacing.xl};
    }
    
    .post-content h1,
    .post-content h2,
    .post-content h3 {
      margin-top: ${roninTheme.spacing.xl};
      margin-bottom: ${roninTheme.spacing.md};
    }
    
    .post-content p {
      margin-bottom: ${roninTheme.spacing.md};
    }
    
    .post-content code {
      background: ${roninTheme.colors.backgroundSecondary};
      padding: 0.2em 0.4em;
      border-radius: ${roninTheme.borderRadius.sm};
      font-size: 0.9em;
    }
    
    .post-content pre {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
      overflow-x: auto;
      margin: ${roninTheme.spacing.lg} 0;
    }
    
    .post-content pre code {
      background: none;
      padding: 0;
    }
    
    .post-content blockquote {
      border-left: 3px solid ${roninTheme.colors.border};
      padding-left: ${roninTheme.spacing.md};
      margin: ${roninTheme.spacing.lg} 0;
      color: ${roninTheme.colors.textSecondary};
    }
    
    .post-content a {
      color: ${roninTheme.colors.textSecondary};
      text-decoration: underline;
    }
    
    .post-content a:hover {
      color: ${roninTheme.colors.textPrimary};
    }
  </style>
</head>
<body>
  <a href="/blog" class="back-link">← Back to Blog</a>
  
  <article>
    <header class="post-header">
      <h1>${this.escapeHtml(post.title)}</h1>
      <div class="post-meta">
        ${new Date(post.published_at || post.created_at).toLocaleDateString()}
        ${post.author ? ` • ${this.escapeHtml(post.author)}` : ''}
      </div>
    </header>
    
    <div class="post-content" id="post-content"></div>
  </article>
  
  <script>
    const content = ${JSON.stringify(post.content)};
    const contentDiv = document.getElementById('post-content');
    
    if (typeof marked !== 'undefined' && marked && marked.parse) {
      if (marked.setOptions) {
        marked.setOptions({
          breaks: true,
          gfm: true,
        });
      }
      try {
        const html = marked.parse(content);
        contentDiv.innerHTML = html;
        
        // Highlight code blocks
        if (typeof hljs !== 'undefined') {
          contentDiv.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
          });
        }
      } catch (e) {
        console.warn('Markdown parsing failed:', e);
        contentDiv.textContent = content;
      }
    } else {
      contentDiv.textContent = content;
    }
  </script>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      console.error("[Blog] Error handling blog post:", error);
      return new Response("Error loading blog post", { status: 500 });
    }
  }

  /**
   * Handle posts API (GET /blog/api/posts)
   */
  private async handlePostsAPI(req: Request): Promise<Response> {
    try {
      if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }

      const posts = await this.api.db.query<BlogPost>(
        `SELECT id, title, slug, excerpt, author, published_at, created_at FROM blog_posts WHERE published = 1 ORDER BY published_at DESC LIMIT 50`
      );

      return Response.json(posts);
    } catch (error) {
      console.error("[Blog] Error handling posts API:", error);
      return Response.json({ error: "Failed to fetch posts" }, { status: 500 });
    }
  }

  /**
   * Handle post by slug API (GET /blog/api/posts/:slug)
   */
  private async handlePostBySlugAPI(req: Request): Promise<Response> {
    try {
      if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }

      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 1];

      if (!slug) {
        return Response.json({ error: "Slug required" }, { status: 400 });
      }

      const posts = await this.api.db.query<BlogPost>(
        `SELECT * FROM blog_posts WHERE slug = ? AND published = 1`,
        [slug]
      );

      if (posts.length === 0) {
        return Response.json({ error: "Post not found" }, { status: 404 });
      }

      return Response.json(posts[0]);
    } catch (error) {
      console.error("[Blog] Error handling post by slug API:", error);
      return Response.json({ error: "Failed to fetch post" }, { status: 500 });
    }
  }

  /**
   * Handle login (POST /blog/api/auth/login)
   */
  private async handleLogin(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json().catch(() => ({})) as { password?: string };
      const password = body.password;

      if (!password) {
        return Response.json({ error: "Password required" }, { status: 400 });
      }

      if (!this.adminPasswordHash) {
        return Response.json({ error: "Admin not configured" }, { status: 500 });
      }

      const isValid = await Bun.password.verify(password, this.adminPasswordHash);
      if (!isValid) {
        return Response.json({ error: "Invalid password" }, { status: 401 });
      }

      const token = await this.createSession();

      return Response.json(
        { success: true, token },
        {
          headers: {
            "Set-Cookie": `blog_session=${token}; Path=/; Max-Age=${this.SESSION_DURATION / 1000}; HttpOnly; SameSite=Lax`,
          },
        }
      );
    } catch (error) {
      console.error("[Blog] Login error:", error);
      return Response.json({ error: "Login failed" }, { status: 500 });
    }
  }

  /**
   * Handle logout (POST /blog/api/auth/logout)
   */
  private async handleLogout(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const token = this.getSessionToken(req);
    if (token) {
      await this.api.db.execute(`DELETE FROM blog_sessions WHERE token = ?`, [token]);
    }

    return Response.json(
      { success: true },
      {
        headers: {
          "Set-Cookie": "blog_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        },
      }
    );
  }

  /**
   * Handle admin dashboard (GET /blog/admin)
   */
  private async handleAdminDashboard(req: Request): Promise<Response> {
    try {
      const token = this.getSessionToken(req);
      const isAuthenticated = token ? await this.verifySession(token) : false;

      if (!isAuthenticated) {
        return this.renderLoginPage();
      }

      const posts = await this.api.db.query<BlogPost>(
        `SELECT id, title, slug, published, created_at, updated_at, published_at FROM blog_posts ORDER BY updated_at DESC LIMIT 50`
      );

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog Admin - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      min-height: 100vh;
      padding: ${roninTheme.spacing.xl};
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: ${roninTheme.spacing.xl};
      padding-bottom: ${roninTheme.spacing.lg};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .header h1 {
      font-size: 2rem;
    }
    
    .header-actions {
      display: flex;
      gap: ${roninTheme.spacing.md};
    }
    
    .posts-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: ${roninTheme.spacing.lg};
    }
    
    .posts-table th,
    .posts-table td {
      padding: ${roninTheme.spacing.md};
      text-align: left;
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .posts-table th {
      color: ${roninTheme.colors.textSecondary};
      font-weight: 300;
      font-size: 0.875rem;
    }
    
    .posts-table td {
      color: ${roninTheme.colors.textPrimary};
    }
    
    .status-badge {
      display: inline-block;
      padding: 0.25em 0.5em;
      border-radius: ${roninTheme.borderRadius.sm};
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .status-published {
      background: ${roninTheme.colors.success}20;
      color: ${roninTheme.colors.success};
    }
    
    .status-draft {
      background: ${roninTheme.colors.warning}20;
      color: ${roninTheme.colors.warning};
    }
    
    .action-buttons {
      display: flex;
      gap: ${roninTheme.spacing.sm};
    }
    
    .btn-small {
      padding: 0.25em 0.5em;
      font-size: 0.75rem;
    }
    
    .generate-section {
      margin-top: ${roninTheme.spacing.xl};
      padding: ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
    }
    
    .generate-section h2 {
      margin-bottom: ${roninTheme.spacing.md};
    }
    
    .generate-form {
      display: flex;
      gap: ${roninTheme.spacing.md};
      margin-top: ${roninTheme.spacing.md};
    }
    
    .generate-form input {
      flex: 1;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Blog Admin</h1>
    <div class="header-actions">
      <a href="/blog/editor"><button>New Post</button></a>
      <a href="/blog"><button>View Blog</button></a>
      <button onclick="handleLogout()">Logout</button>
    </div>
  </div>
  
  <table class="posts-table">
    <thead>
      <tr>
        <th>Title</th>
        <th>Status</th>
        <th>Updated</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${posts.map(post => `
        <tr>
          <td>${this.escapeHtml(post.title)}</td>
          <td>
            <span class="status-badge ${post.published ? 'status-published' : 'status-draft'}">
              ${post.published ? 'Published' : 'Draft'}
            </span>
          </td>
          <td>${new Date(post.updated_at).toLocaleDateString()}</td>
          <td>
            <div class="action-buttons">
              <a href="/blog/editor/${post.id}"><button class="btn-small">Edit</button></a>
              ${post.published 
                ? `<a href="/blog/${post.slug}" target="_blank"><button class="btn-small">View</button></a>`
                : ''
              }
              <button type="button" class="btn-small" onclick="deletePost('${post.id}', this)">Delete</button>
            </div>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  
  <div class="generate-section">
    <h2>Generate AI Article</h2>
    <p style="color: ${roninTheme.colors.textSecondary}; margin-bottom: ${roninTheme.spacing.md};">
      Let Blogs write an article about Ronin features, agents, or plugins.
    </p>
    <div class="generate-form">
      <input type="text" id="article-topic" placeholder="e.g., 'New Agent: chatty' or 'Plugin Spotlight: shell'" />
      <button onclick="generateArticle(this)">Generate</button>
    </div>
  </div>
  
  <script>
    // Global error handler to catch any uncaught errors
    window.onerror = function(msg, url, lineNo, columnNo, error) {
      console.error('[Blog] Global error:', msg, url, lineNo, error);
      return false;
    };
    console.log('[Blog] Admin page JavaScript loaded');
    
    async function handleLogout() {
      await fetch('/blog/api/auth/logout', { method: 'POST' });
      window.location.href = '/blog/admin';
    }
    
    async function deletePost(id, buttonEl) {
      // Debug: Show alert immediately to confirm function is called
      console.log('[Blog] deletePost called with id:', id, 'button:', buttonEl);
      
      if (!id) {
        alert('Error: No post ID provided');
        console.error('[Blog] No ID provided');
        return;
      }
      
      if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
        console.log('[Blog] Delete cancelled by user');
        return;
      }
      
      console.log('[Blog] User confirmed, starting delete for post ID:', id);
      
      // Disable button to prevent double-clicks
      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = 'Deleting...';
      }
      
      try {
        const url = '/blog/api/admin/posts/' + encodeURIComponent(id);
        console.log('[Blog] DELETE request to:', url);
        
        const res = await fetch(url, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        console.log('[Blog] Response received, status:', res.status);
        console.log('[Blog] Response headers:', Object.fromEntries(res.headers.entries()));
        
        // Clone response to read text first for debugging
        const resClone = res.clone();
        const rawText = await resClone.text();
        console.log('[Blog] Raw response text:', rawText);
        
        let data;
        try {
          data = JSON.parse(rawText);
        } catch (parseError) {
          console.error('[Blog] Failed to parse response as JSON:', parseError);
          console.error('[Blog] Raw response was:', rawText);
          data = { error: 'Failed to parse server response: ' + rawText.substring(0, 100) };
        }
        console.log('[Blog] Parsed response data:', data);
        
        if (res.ok && data.success) {
          console.log('[Blog] Delete successful, reloading page');
          // Remove the row from the table immediately for better UX
          const row = buttonEl ? buttonEl.closest('tr') : null;
          if (row) {
            row.style.opacity = '0.5';
            row.style.transition = 'opacity 0.3s';
            setTimeout(() => {
              window.location.reload();
            }, 300);
          } else {
            window.location.reload();
          }
        } else {
          const errorMsg = data.error || \`Failed to delete post (status: \${res.status})\`;
          console.error('[Blog] Delete failed:', errorMsg);
          alert('Delete failed: ' + errorMsg);
          if (res.status === 401) {
            window.location.href = '/blog/admin';
          }
          // Re-enable button on failure
          if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = 'Delete';
          }
        }
      } catch (error) {
        console.error('[Blog] Network error during delete:', error);
        alert('Network error: ' + (error.message || 'Failed to delete post'));
        // Re-enable button on error
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.textContent = 'Delete';
        }
      }
    }
    
    async function generateArticle(buttonEl) {
      const topicInput = document.getElementById('article-topic');
      const topic = topicInput.value.trim();
      if (!topic) {
        alert('Please enter a topic');
        return;
      }
      
      try {
        // Disable button and show loading state
        const button = buttonEl || event.target;
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Generating...';
        
        const res = await fetch('/blog/api/admin/generate', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ topic }),
        });
        
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        
        if (res.ok && data.id) {
          window.location.href = \`/blog/editor/\${data.id}\`;
        } else {
          const errorMsg = data.error || \`Failed to generate article (status: \${res.status})\`;
          alert(\`Error: \${errorMsg}\`);
          console.error('Generate error:', data);
          if (res.status === 401) {
            window.location.href = '/blog/admin';
          }
          button.disabled = false;
          button.textContent = originalText;
        }
      } catch (error) {
        console.error('Generate error:', error);
        alert('Network error: Failed to generate article. Please try again.');
        const button = buttonEl || event.target;
        button.disabled = false;
        button.textContent = 'Generate';
      }
    }
  </script>
</body>
</html>`;

      return new Response(html, {
        headers: { 
          "Content-Type": "text/html",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    } catch (error) {
      console.error("[Blog] Error handling admin dashboard:", error);
      return new Response("Error loading admin dashboard", { status: 500 });
    }
  }

  /**
   * Render login page
   */
  private renderLoginPage(): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog Admin Login - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: ${roninTheme.spacing.xl};
    }
    
    .login-container {
      width: 100%;
      max-width: 400px;
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.xl};
    }
    
    .login-container h1 {
      text-align: center;
      margin-bottom: ${roninTheme.spacing.lg};
    }
    
    .login-form {
      display: flex;
      flex-direction: column;
      gap: ${roninTheme.spacing.md};
    }
    
    .error-message {
      color: ${roninTheme.colors.error};
      font-size: 0.875rem;
      margin-top: ${roninTheme.spacing.sm};
      display: none;
    }
    
    .error-message.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>Blog Admin Login</h1>
    <form class="login-form" onsubmit="handleLogin(event)">
      <input type="password" id="password" placeholder="Password" required />
      <div class="error-message" id="error-message"></div>
      <button type="submit">Login</button>
    </form>
  </div>
  
  <script>
    async function handleLogin(event) {
      event.preventDefault();
      const password = document.getElementById('password').value;
      const errorDiv = document.getElementById('error-message');
      
      errorDiv.classList.remove('show');
      
      const res = await fetch('/blog/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/blog/admin';
      } else {
        errorDiv.textContent = data.error || 'Login failed';
        errorDiv.classList.add('show');
      }
    }
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  /**
   * Handle admin posts API
   */
  private async handleAdminPostsAPI(req: Request): Promise<Response> {
    try {
      const token = this.getSessionToken(req);
      if (!token || !(await this.verifySession(token))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (req.method === "GET") {
        const posts = await this.api.db.query<BlogPost>(
          `SELECT * FROM blog_posts ORDER BY updated_at DESC`
        );
        return Response.json(posts);
      }

      if (req.method === "POST") {
        try {
          const body = await req.json().catch(() => ({})) as {
            title?: string;
            content?: string;
            excerpt?: string;
            published?: boolean;
          };

          if (!body.title || !body.content) {
            return Response.json({ error: "Title and content required" }, { status: 400 });
          }

          const slug = await this.ensureUniqueSlug(this.generateSlug(body.title));
          const now = Date.now();
          const id = crypto.randomUUID();

          await this.api.db.execute(
            `INSERT INTO blog_posts (id, title, slug, content, excerpt, author, published, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              body.title,
              slug,
              body.content,
              body.excerpt || null,
              "blogs",
              body.published ? 1 : 0,
              now,
              now,
              body.published ? now : null,
            ]
          );

          return Response.json({ id, slug });
        } catch (error) {
          console.error("[Blog] Create post error:", error);
          return Response.json(
            { error: (error as Error).message || "Failed to create post" },
            { status: 500 }
          );
        }
      }

      return new Response("Method not allowed", { status: 405 });
    } catch (error) {
      console.error("[Blog] Error in admin posts API:", error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  /**
   * Handle admin post by ID API
   */
  private async handleAdminPostByIdAPI(req: Request): Promise<Response> {
    console.log("[Blog] handleAdminPostByIdAPI called, method:", req.method, "url:", req.url);
    try {
      const token = this.getSessionToken(req);
      console.log("[Blog] Session token present:", !!token);
      if (!token || !(await this.verifySession(token))) {
        console.log("[Blog] Unauthorized - token invalid or missing");
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      console.log("[Blog] Session verified successfully");

      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = decodeURIComponent(pathParts[pathParts.length - 1]);
      console.log("[Blog] Extracted ID:", id, "from path:", url.pathname);

      if (!id) {
        return Response.json({ error: "Post ID required" }, { status: 400 });
      }

      if (req.method === "GET") {
        try {
          const posts = await this.api.db.query<BlogPost>(
            `SELECT * FROM blog_posts WHERE id = ?`,
            [id]
          );

          if (posts.length === 0) {
            return Response.json({ error: "Post not found" }, { status: 404 });
          }

          return Response.json(posts[0]);
        } catch (error) {
          console.error("[Blog] Get post error:", error);
          return Response.json({ error: "Failed to fetch post" }, { status: 500 });
        }
      }

      if (req.method === "PUT") {
        try {
          const body = await req.json().catch(() => ({})) as {
            title?: string;
            content?: string;
            excerpt?: string;
            published?: boolean;
          };

          const existingPosts = await this.api.db.query<BlogPost>(
            `SELECT * FROM blog_posts WHERE id = ?`,
            [id]
          );

          if (existingPosts.length === 0) {
            return Response.json({ error: "Post not found" }, { status: 404 });
          }

          const existing = existingPosts[0];
          const title = body.title || existing.title;
          const slug = body.title
            ? await this.ensureUniqueSlug(this.generateSlug(title), id)
            : existing.slug;
          const content = body.content || existing.content;
          const excerpt = body.excerpt !== undefined ? body.excerpt : existing.excerpt;
          const published = body.published !== undefined ? (body.published ? 1 : 0) : existing.published;
          const now = Date.now();
          const publishedAt = published && !existing.published ? now : existing.published_at;

          await this.api.db.execute(
            `UPDATE blog_posts SET title = ?, slug = ?, content = ?, excerpt = ?, published = ?, updated_at = ?, published_at = ? WHERE id = ?`,
            [title, slug, content, excerpt, published, now, publishedAt, id]
          );

          return Response.json({ success: true });
        } catch (error) {
          console.error("[Blog] Update post error:", error);
          return Response.json(
            { error: (error as Error).message || "Failed to update post" },
            { status: 500 }
          );
        }
      }

      if (req.method === "DELETE") {
        console.log("[Blog] DELETE request received for post ID:", id);
        try {
          // Verify post exists
          const existingPosts = await this.api.db.query<BlogPost>(
            `SELECT id FROM blog_posts WHERE id = ?`,
            [id]
          );
          console.log("[Blog] Found posts for ID:", existingPosts.length);

          if (existingPosts.length === 0) {
            console.log("[Blog] Post not found, returning 404");
            return Response.json({ error: "Post not found" }, { status: 404 });
          }

          console.log("[Blog] Executing DELETE query for post:", id);
          await this.api.db.execute(`DELETE FROM blog_posts WHERE id = ?`, [id]);
          console.log("[Blog] DELETE successful for post:", id);
          return Response.json({ success: true });
        } catch (error) {
          console.error("[Blog] Delete post error:", error);
          return Response.json(
            { error: (error as Error).message || "Failed to delete post" },
            { status: 500 }
          );
        }
      }

      console.log("[Blog] Method not allowed:", req.method);
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    } catch (error) {
      console.error("[Blog] Error in admin post by ID API:", error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  /**
   * Handle generate article (POST /blog/api/admin/generate)
   */
  private async handleGenerateArticle(req: Request): Promise<Response> {
    try {
      const token = this.getSessionToken(req);
      if (!token || !(await this.verifySession(token))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      try {
        const body = await req.json().catch(() => ({})) as { topic?: string };
        const topic = body.topic;

        if (!topic) {
          return Response.json({ error: "Topic required" }, { status: 400 });
        }

        if (topic.length > 200) {
          return Response.json({ error: "Topic too long (max 200 characters)" }, { status: 400 });
        }

        const article = await this.generateArticle(topic);
        return Response.json(article);
      } catch (error) {
        console.error("[Blog] Generate article error:", error);
        return Response.json(
          { error: (error as Error).message || "Failed to generate article" },
          { status: 500 }
        );
      }
    } catch (error) {
      console.error("[Blog] Error in generate article handler:", error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  /**
   * Generate AI article about Ronin features
   */
  private async generateArticle(topic: string): Promise<{ id: string; slug: string }> {
    const startTime = Date.now();
    console.log(`[Blog] 📝 Starting article generation for topic: "${topic}"`);
    
    // Discover Ronin context
    const agents: Array<{ name: string; description?: string }> = [];
    const plugins: string[] = [];
    const routes: Array<{ path: string; type: string }> = [];

    console.log("[Blog] 🔍 Discovering Ronin context...");
    try {
      // Discover agents
      const externalAgentDir = ensureDefaultExternalAgentDir();
      const localAgentDir = ensureDefaultAgentDir();

      try {
        const externalFiles = await readdir(externalAgentDir);
        for (const file of externalFiles) {
          if (file.endsWith(".ts") || file.endsWith(".js")) {
            const name = file.replace(/\.(ts|js)$/, "");
            agents.push({ name });
          }
        }
        console.log(`[Blog]   Found ${externalFiles.filter(f => f.endsWith('.ts') || f.endsWith('.js')).length} external agents`);
      } catch (error) {
        console.warn("[Blog]   External agents directory not accessible");
        // External directory might not exist
      }

      try {
        const localFiles = await readdir(localAgentDir);
        for (const file of localFiles) {
          if (file.endsWith(".ts") || file.endsWith(".js")) {
            const name = file.replace(/\.(ts|js)$/, "");
            if (!agents.find((a) => a.name === name)) {
              agents.push({ name });
            }
          }
        }
        console.log(`[Blog]   Found ${localFiles.filter(f => f.endsWith('.ts') || f.endsWith('.js')).length} local agents`);
      } catch (error) {
        console.warn("[Blog]   Local agents directory not accessible");
        // Local directory might not exist
      }

      // Get plugins
      try {
        plugins.push(...this.api.plugins.list());
        console.log(`[Blog]   Found ${plugins.length} plugins`);
      } catch (error) {
        console.warn("[Blog]   Could not list plugins");
      }

      // Get routes
      try {
        const allRoutes = this.api.http.getAllRoutes();
        for (const path of allRoutes.keys()) {
          routes.push({ path, type: "http" });
        }
        console.log(`[Blog]   Found ${routes.length} routes`);
      } catch (error) {
        console.warn("[Blog]   Could not get routes");
      }
    } catch (error) {
      console.warn("[Blog] ⚠️ Error discovering Ronin context:", error);
    }

    console.log(`[Blog] 📊 Context summary: ${agents.length} agents, ${plugins.length} plugins, ${routes.length} routes`);

    // Build context for AI
    const agentList = agents.length > 0 ? agents.map((a) => `- ${a.name}`).join("\n") : "None";
    const pluginList = plugins.length > 0 ? plugins.map((p) => `- ${p}`).join("\n") : "None";
    const routeList = routes.length > 0 ? routes.map((r) => `- ${r.path}`).join("\n") : "None";

    const contextPrompt = `You are a helpful AI assistant that writes articles about the Ronin AI agent framework.

Ronin is a Bun-based TypeScript/JavaScript framework for building AI agents. Key components:
- Agents: Extend BaseAgent, implement execute(), auto-loaded from agents/
- Plugins: Tools accessed via api.plugins.call()
- Routes: Agents register HTTP routes via api.http.registerRoute()
- Events: Inter-agent communication via api.events
- Memory: Persistent storage via api.memory
- AI: Ollama integration via api.ai

Current Ronin Setup:
Available Agents:
${agentList}

Available Plugins:
${pluginList}

Registered Routes:
${routeList}

Write a well-structured, informative blog article about: "${topic}"

The article should:
- Be written in markdown format
- Be engaging and informative
- Include code examples where relevant
- Explain concepts clearly
- Be suitable for a technical blog audience
- Be 500-1000 words
- Include a title at the top as an H1

Focus on explaining the topic in the context of Ronin and how it relates to the current setup.`;

    // Generate article using AI
    const configAI = this.api.config.getAI();
    const model = configAI.ollamaModel || process.env.OLLAMA_MODEL || "qwen3:4b";
    console.log(`[Blog] 🤖 Starting AI generation with model: ${model}`);
    console.log(`[Blog]   Timeout: ${this.AI_TIMEOUT_MS / 1000}s, Max tokens: ${this.AI_MAX_TOKENS}`);
    
    const aiStartTime = Date.now();
    let articleContent: string;
    try {
      articleContent = await this.api.ai.complete(contextPrompt, {
        model,
        timeoutMs: this.AI_TIMEOUT_MS,
        maxTokens: this.AI_MAX_TOKENS,
      });
      
      const aiDuration = ((Date.now() - aiStartTime) / 1000).toFixed(1);
      console.log(`[Blog] ✅ AI generation completed in ${aiDuration}s`);
      console.log(`[Blog]   Generated ${articleContent.length} characters`);

      if (!articleContent || articleContent.trim().length === 0) {
        throw new Error("AI returned empty content");
      }
    } catch (error) {
      const aiDuration = ((Date.now() - aiStartTime) / 1000).toFixed(1);
      console.error(`[Blog] ❌ AI generation failed after ${aiDuration}s:`, error);
      throw new Error(
        `Failed to generate article content: ${(error as Error).message || "Unknown error"}`
      );
    }

    // Extract title from first line (H1)
    console.log("[Blog] 📄 Processing generated content...");
    const lines = articleContent.split("\n");
    let title = topic;
    let content = articleContent;

    // Try to extract title from markdown H1
    const h1Match = lines[0].match(/^#\s+(.+)$/);
    if (h1Match) {
      title = h1Match[1].trim();
      content = lines.slice(1).join("\n").trim();
      console.log(`[Blog]   Extracted title: "${title}"`);
    } else {
      console.log(`[Blog]   Using topic as title: "${title}"`);
    }

    // Generate excerpt (first 200 chars)
    const excerpt = content
      .replace(/[#*`]/g, "")
      .substring(0, 200)
      .trim()
      .replace(/\n/g, " ");

    // Create slug
    let slug: string;
    try {
      slug = await this.ensureUniqueSlug(this.generateSlug(title));
      console.log(`[Blog]   Generated slug: "${slug}"`);
    } catch (error) {
      console.error("[Blog] ❌ Error generating slug:", error);
      throw new Error("Failed to generate unique slug");
    }

    // Save as draft
    const id = crypto.randomUUID();
    const now = Date.now();

    console.log("[Blog] 💾 Saving article to database...");
    try {
      await this.api.db.execute(
        `INSERT INTO blog_posts (id, title, slug, content, excerpt, author, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, slug, articleContent, excerpt, "blogs", 0, now, now]
      );
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Blog] ✅ Article saved successfully (total time: ${totalDuration}s)`);
      console.log(`[Blog]   ID: ${id}`);
      console.log(`[Blog]   Title: "${title}"`);
    } catch (error) {
      console.error("[Blog] ❌ Error saving generated article:", error);
      throw new Error("Failed to save article to database");
    }

    return { id, slug };
  }

  /**
   * Handle editor page (GET /blog/editor or /blog/editor/:id)
   */
  private async handleEditor(req: Request): Promise<Response> {
    try {
      const token = this.getSessionToken(req);
      if (!token || !(await this.verifySession(token))) {
        return this.renderLoginPage();
      }

      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const postId = pathParts.length > 3 ? pathParts[3] : null;

      let post: BlogPost | null = null;
      if (postId) {
        try {
          const posts = await this.api.db.query<BlogPost>(
            `SELECT * FROM blog_posts WHERE id = ?`,
            [postId]
          );
          if (posts.length > 0) {
            post = posts[0];
          }
        } catch (error) {
          console.error("[Blog] Error loading post for editor:", error);
          // Continue with null post (new post mode)
        }
      }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${post ? `Edit: ${this.escapeHtml(post.title)}` : "New Post"} - Blog Editor</title>
  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .editor-header {
      padding: ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border-bottom: 1px solid ${roninTheme.colors.border};
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    
    .editor-header h1 {
      font-size: 1.25rem;
    }
    
    .editor-header-actions {
      display: flex;
      gap: ${roninTheme.spacing.md};
    }
    
    .editor-container {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    
    .editor-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-right: 1px solid ${roninTheme.colors.border};
    }
    
    .editor-toolbar {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border-bottom: 1px solid ${roninTheme.colors.border};
      display: flex;
      gap: ${roninTheme.spacing.md};
    }
    
    .editor-toolbar input {
      flex: 1;
      font-size: 0.875rem;
    }
    
    #monaco-editor {
      flex: 1;
      min-height: 0;
    }
    
    .preview-panel {
      flex: 1;
      overflow-y: auto;
      padding: ${roninTheme.spacing.lg};
      background: ${roninTheme.colors.background};
    }
    
    .preview-content {
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.8;
    }
    
    .preview-content h1,
    .preview-content h2,
    .preview-content h3 {
      margin-top: ${roninTheme.spacing.xl};
      margin-bottom: ${roninTheme.spacing.md};
    }
    
    .preview-content p {
      margin-bottom: ${roninTheme.spacing.md};
    }
    
    .preview-content code {
      background: ${roninTheme.colors.backgroundSecondary};
      padding: 0.2em 0.4em;
      border-radius: ${roninTheme.borderRadius.sm};
    }
    
    .preview-content pre {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
      overflow-x: auto;
      margin: ${roninTheme.spacing.lg} 0;
    }
    
    .preview-content pre code {
      background: none;
      padding: 0;
    }
    
    .preview-content blockquote {
      border-left: 3px solid ${roninTheme.colors.border};
      padding-left: ${roninTheme.spacing.md};
      margin: ${roninTheme.spacing.lg} 0;
      color: ${roninTheme.colors.textSecondary};
    }
  </style>
</head>
<body>
  <div class="editor-header">
    <h1>${post ? `Edit: ${this.escapeHtml(post.title)}` : "New Post"}</h1>
    <div class="editor-header-actions">
      <button onclick="saveDraft()">Save Draft</button>
      <button onclick="publish()">Publish</button>
      <a href="/blog/admin"><button>Back to Admin</button></a>
    </div>
  </div>
  
  <div class="editor-container">
    <div class="editor-panel">
      <div class="editor-toolbar">
        <input type="text" id="post-title" placeholder="Post Title" value="${post ? this.escapeHtml(post.title) : ""}" />
        <input type="text" id="post-excerpt" placeholder="Excerpt (optional)" value="${post && post.excerpt ? this.escapeHtml(post.excerpt) : ""}" />
      </div>
      <div id="monaco-editor"></div>
    </div>
    <div class="preview-panel">
      <div class="preview-content" id="preview-content"></div>
    </div>
  </div>
  
  <script>
    let editor;
    let currentPostId = ${post ? JSON.stringify(post.id) : "null"};
    
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
      editor = monaco.editor.create(document.getElementById('monaco-editor'), {
        value: ${post ? JSON.stringify(post.content) : '""'},
        language: 'markdown',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        wordWrap: 'on',
      });
      
      // Update preview on content change
      editor.onDidChangeModelContent(() => {
        updatePreview();
      });
      
      // Initial preview
      updatePreview();
    });
    
    function updatePreview() {
      const content = editor.getValue();
      const previewDiv = document.getElementById('preview-content');
      
      if (typeof marked !== 'undefined' && marked && marked.parse) {
        if (marked.setOptions) {
          marked.setOptions({
            breaks: true,
            gfm: true,
          });
        }
        try {
          const html = marked.parse(content);
          previewDiv.innerHTML = html;
          
          // Highlight code blocks
          if (typeof hljs !== 'undefined') {
            previewDiv.querySelectorAll('pre code').forEach(block => {
              hljs.highlightElement(block);
            });
          }
        } catch (e) {
          console.warn('Markdown parsing failed:', e);
          previewDiv.textContent = content;
        }
      } else {
        previewDiv.textContent = content;
      }
    }
    
    async function saveDraft() {
      await savePost(false);
    }
    
    async function publish() {
      await savePost(true);
    }
    
    async function savePost(published) {
      const title = document.getElementById('post-title').value.trim();
      const excerpt = document.getElementById('post-excerpt').value.trim();
      const content = editor.getValue();
      
      if (!title || !content) {
        alert('Title and content are required');
        return;
      }
      
      try {
        const url = currentPostId 
          ? \`/blog/api/admin/posts/\${currentPostId}\`
          : '/blog/api/admin/posts';
        
        const method = currentPostId ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title,
            content,
            excerpt: excerpt || null,
            published,
          }),
        });
        
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        
        if (res.ok) {
          if (!currentPostId) {
            currentPostId = data.id;
          }
          alert(published ? 'Post published!' : 'Draft saved!');
          if (published) {
            window.location.href = '/blog/admin';
          }
        } else {
          const errorMsg = data.error || \`Failed to save (status: \${res.status})\`;
          alert(\`Error: \${errorMsg}\`);
          console.error('Save error:', data);
          if (res.status === 401) {
            window.location.href = '/blog/admin';
          }
        }
      } catch (error) {
        console.error('Save error:', error);
        alert('Network error: Failed to save post. Please try again.');
      }
    }
  </script>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      console.error("[Blog] Error handling editor:", error);
      return new Response("Error loading editor", { status: 500 });
    }
  }

  /**
   * Escape HTML
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Execute method (required by BaseAgent)
   */
  async execute(): Promise<void> {
    // Blogs agent is route-driven, so execute() can be empty
    // Periodically clean up expired sessions
    await this.cleanupExpiredSessions();
  }
}
