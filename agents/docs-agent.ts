import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative, extname, basename } from "path";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS } from "../src/utils/theme.js";

interface DocumentItem {
  type: "markdown" | "book-chapter";
  path: string;
  name: string;
  displayName: string;
  category: string;
}

interface DocumentList {
  markdown: DocumentItem[];
  bookChapters: DocumentItem[];
  skillsDuties: DocumentItem[];
}

/**
 * Docs Agent - Documentation viewer for Ronin
 * Provides /docs UI and /api/docs endpoints for viewing documentation
 */
export default class DocsAgent extends BaseAgent {
  private documents: DocumentList = {
    markdown: [],
    bookChapters: [],
    skillsDuties: [],
  };
  private docsPath: string;
  private bookPath: string;
  private skillsDutiesPath: string;

  constructor(api: AgentAPI) {
    super(api);
    this.docsPath = join(process.cwd(), "docs");
    this.bookPath = join(this.docsPath, "book", "chapters");
    this.skillsDutiesPath = join(this.docsPath, "skills-and-duties", "chapters");
    this.discoverDocuments();
    this.registerRoutes();
    console.log("📚 Docs agent ready. Documentation viewer available at /docs");
  }

  /**
   * Discover all documentation files
   */
  private async discoverDocuments(): Promise<void> {
    try {
      // Discover markdown files in docs/
      const markdownFiles: DocumentItem[] = [];
      const docsDir = await readdir(this.docsPath, { withFileTypes: true });
      
      for (const dirent of docsDir) {
        if (dirent.isFile() && extname(dirent.name) === ".md") {
          const fullPath = join(this.docsPath, dirent.name);
          const name = basename(dirent.name, ".md");
          markdownFiles.push({
            type: "markdown",
            path: `docs/${dirent.name}`,
            name: dirent.name,
            displayName: this.formatDisplayName(name),
            category: "Documentation",
          });
        }
      }

      // Discover book chapters
      const bookChapters: DocumentItem[] = [];
      try {
        // Read main chapters directory
        const mainChapters = await readdir(this.bookPath, { withFileTypes: true });
        
        for (const dirent of mainChapters) {
          if (dirent.isDirectory() && dirent.name === "appendices") {
            // Read appendices directory
            const appendicesPath = join(this.bookPath, "appendices");
            const appendices = await readdir(appendicesPath, { withFileTypes: true });
            
            for (const appDirent of appendices) {
              if (appDirent.isFile() && extname(appDirent.name) === ".html") {
                const name = basename(appDirent.name, ".html");
                bookChapters.push({
                  type: "book-chapter",
                  path: `docs/book/chapters/appendices/${appDirent.name}`,
                  name: appDirent.name,
                  displayName: this.formatDisplayName(name),
                  category: "Appendices",
                });
              }
            }
          } else if (dirent.isFile() && extname(dirent.name) === ".html") {
            const name = basename(dirent.name, ".html");
            bookChapters.push({
              type: "book-chapter",
              path: `docs/book/chapters/${dirent.name}`,
              name: dirent.name,
              displayName: this.formatDisplayName(name),
              category: "Book Chapters",
            });
          }
        }
        
        // Sort book chapters by name (which includes chapter numbers)
        bookChapters.sort((a, b) => {
          // Sort appendices after main chapters
          if (a.category !== b.category) {
            return a.category === "Appendices" ? 1 : -1;
          }
          return a.name.localeCompare(b.name);
        });
      } catch (error) {
        console.warn("[Docs] Could not read book chapters directory:", error);
      }

      // Discover skills-and-duties chapters
      const skillsDuties: DocumentItem[] = [];
      try {
        const sdDirs = await readdir(this.skillsDutiesPath, { withFileTypes: true });
        
        for (const dirent of sdDirs) {
          if (dirent.isDirectory()) {
            // Read subdirectories (plugins/, agents/)
            const subDir = join(this.skillsDutiesPath, dirent.name);
            const subFiles = await readdir(subDir, { withFileTypes: true });
            const categoryName = dirent.name === "plugins" ? "Plugin Skills" : dirent.name === "agents" ? "Agent Duties" : this.formatDisplayName(dirent.name);
            
            for (const subDirent of subFiles) {
              if (subDirent.isFile() && extname(subDirent.name) === ".html") {
                const name = basename(subDirent.name, ".html");
                skillsDuties.push({
                  type: "book-chapter",
                  path: `docs/skills-and-duties/chapters/${dirent.name}/${subDirent.name}`,
                  name: subDirent.name,
                  displayName: this.formatDisplayName(name),
                  category: categoryName,
                });
              }
            }
          } else if (dirent.isFile() && extname(dirent.name) === ".html") {
            const name = basename(dirent.name, ".html");
            skillsDuties.push({
              type: "book-chapter",
              path: `docs/skills-and-duties/chapters/${dirent.name}`,
              name: dirent.name,
              displayName: this.formatDisplayName(name),
              category: "Skills & Duties",
            });
          }
        }
        
        // Sort: Agent Duties first, then Plugin Skills, then by name within each category
        skillsDuties.sort((a, b) => {
          if (a.category !== b.category) {
            if (a.category === "Agent Duties") return -1;
            if (b.category === "Agent Duties") return 1;
            return a.category.localeCompare(b.category);
          }
          return a.name.localeCompare(b.name);
        });
      } catch (error) {
        console.warn("[Docs] Could not read skills-and-duties directory:", error);
      }

      this.documents = {
        markdown: markdownFiles.sort((a, b) => a.displayName.localeCompare(b.displayName)),
        bookChapters,
        skillsDuties,
      };

      console.log(`[Docs] Discovered ${markdownFiles.length} markdown files, ${bookChapters.length} book chapters, and ${skillsDuties.length} skills & duties`);
    } catch (error) {
      console.error("[Docs] Failed to discover documents:", error);
    }
  }

  /**
   * Format display name from filename
   */
  private formatDisplayName(name: string): string {
    // Convert kebab-case or snake_case to Title Case
    return name
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  async execute(): Promise<void> {
    // Docs agent is route-driven, execute can be empty
    // Optionally refresh document list periodically
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/docs", this.handleDocsUI.bind(this));
    this.api.http.registerRoute("/api/docs/list", this.handleDocsListAPI.bind(this));
    this.api.http.registerRoute("/api/docs/content", this.handleDocsContentAPI.bind(this));
    // Serve book CSS files
    this.api.http.registerRoute("/docs/book/styles/", this.handleBookCSS.bind(this));
    this.api.http.registerRoute("/docs/skills-and-duties/styles/", this.handleSkillsDutiesCSS.bind(this));
  }

  /**
   * Handle book CSS file requests
   */
  private async handleBookCSS(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const pathname = url.pathname;
      // Extract filename from path like /docs/book/styles/book.css
      const filename = pathname.split("/").pop() || "book.css";
      const cssPath = join(this.docsPath, "book", "styles", filename);
      
      // Security check
      const bookStylesDir = join(this.docsPath, "book", "styles");
      if (!cssPath.startsWith(bookStylesDir)) {
        return new Response("Invalid path", { status: 400 });
      }

      const content = await readFile(cssPath, "utf-8");
      return new Response(content, {
        headers: { "Content-Type": "text/css" },
      });
    } catch (error) {
      return new Response("CSS file not found", { status: 404 });
    }
  }

  /**
   * Handle skills-and-duties CSS file requests
   */
  private async handleSkillsDutiesCSS(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const pathname = url.pathname;
      const filename = pathname.split("/").pop() || "book.css";
      const cssPath = join(this.docsPath, "skills-and-duties", "styles", filename);
      
      // Security check
      const stylesDir = join(this.docsPath, "skills-and-duties", "styles");
      if (!cssPath.startsWith(stylesDir)) {
        return new Response("Invalid path", { status: 400 });
      }

      const content = await readFile(cssPath, "utf-8");
      return new Response(content, {
        headers: { "Content-Type": "text/css" },
      });
    } catch (error) {
      return new Response("CSS file not found", { status: 404 });
    }
  }

  /**
   * Handle document list API
   */
  private async handleDocsListAPI(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Refresh document list
    await this.discoverDocuments();

    return Response.json(this.documents);
  }

  /**
   * Handle document content API
   */
  private async handleDocsContentAPI(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const url = new URL(req.url);
      const path = url.searchParams.get("path");

      if (!path) {
        return Response.json({ error: "Path parameter required" }, { status: 400 });
      }

      // Security: prevent directory traversal
      if (path.includes("..") || path.startsWith("/")) {
        return Response.json({ error: "Invalid path" }, { status: 400 });
      }

      // Ensure path is within docs directory
      const fullPath = join(process.cwd(), path);
      const docsDir = join(process.cwd(), "docs");
      
      if (!fullPath.startsWith(docsDir)) {
        return Response.json({ error: "Path outside docs directory" }, { status: 400 });
      }

      const content = await readFile(fullPath, "utf-8");
      const ext = extname(path);

      return Response.json({
        content,
        type: ext === ".md" ? "markdown" : ext === ".html" ? "html" : "text",
        path,
      });
    } catch (error) {
      console.error("[Docs] Failed to read document:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to read document" },
        { status: 500 }
      );
    }
  }

  /**
   * Serve docs UI
   */
  private async handleDocsUI(req: Request): Promise<Response> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Documentation</title>
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/atom-one-dark.min.css">
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      font-size: 0.8125rem;
      overflow: hidden;
    }
    
    .header {
      background: ${roninTheme.colors.backgroundSecondary};
      backdrop-filter: blur(10px);
      padding: ${roninTheme.spacing.md};
      color: ${roninTheme.colors.textPrimary};
      text-align: center;
      border-bottom: 1px solid ${roninTheme.colors.border};
      flex-shrink: 0;
    }
    
    .header h1 {
      font-size: 1.25rem;
      margin-bottom: 0.25rem;
      font-weight: 300;
    }
    
    .header p {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
    }
    
    .main-container {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    
    .sidebar {
      width: 300px;
      background: ${roninTheme.colors.backgroundSecondary};
      border-right: 1px solid ${roninTheme.colors.border};
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow-y: auto;
    }
    
    .sidebar-section {
      padding: ${roninTheme.spacing.md};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .sidebar-section-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${roninTheme.colors.textTertiary};
      margin-bottom: ${roninTheme.spacing.sm};
    }
    
    .doc-item {
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      margin-bottom: ${roninTheme.spacing.xs};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      transition: all 0.2s;
      color: ${roninTheme.colors.textSecondary};
      font-size: 0.8125rem;
    }
    
    .doc-item:hover {
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textPrimary};
    }
    
    .doc-item.active {
      background: ${roninTheme.colors.accent};
      color: ${roninTheme.colors.textPrimary};
      border-left: 2px solid ${roninTheme.colors.textPrimary};
    }
    
    .content-area {
      flex: 1;
      overflow-y: auto;
      background: ${roninTheme.colors.background};
    }
    
    .content-wrapper {
      max-width: 900px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.xl};
      min-height: 100%;
    }
    
    #content {
      width: 100%;
      min-height: 100%;
    }
    
    .loading {
      text-align: center;
      padding: ${roninTheme.spacing.xl};
      color: ${roninTheme.colors.textSecondary};
    }
    
    .error {
      padding: ${roninTheme.spacing.md};
      background: ${roninTheme.colors.error}20;
      border: 1px solid ${roninTheme.colors.error};
      border-radius: ${roninTheme.borderRadius.md};
      color: ${roninTheme.colors.error};
    }
    
    /* Markdown styling */
    .markdown-content {
      line-height: 1.7;
    }
    
    .markdown-content h1 {
      font-size: 2rem;
      margin-top: ${roninTheme.spacing.xl};
      margin-bottom: ${roninTheme.spacing.md};
      padding-bottom: ${roninTheme.spacing.sm};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .markdown-content h2 {
      font-size: 1.5rem;
      margin-top: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.md};
      padding-bottom: ${roninTheme.spacing.xs};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .markdown-content h3 {
      font-size: 1.25rem;
      margin-top: ${roninTheme.spacing.md};
      margin-bottom: ${roninTheme.spacing.sm};
    }
    
    .markdown-content code {
      background: ${roninTheme.colors.backgroundSecondary};
      padding: 0.2em 0.4em;
      border-radius: ${roninTheme.borderRadius.sm};
      font-size: 0.85em;
      font-family: ${roninTheme.fonts.mono};
    }
    
    .markdown-content pre {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
      overflow-x: auto;
      margin: ${roninTheme.spacing.md} 0;
    }
    
    .markdown-content pre code {
      background: transparent;
      padding: 0;
      font-size: 0.85em;
      line-height: 1.6;
    }
    
    /* highlight.js theme fully controls token colors inside code blocks - no overrides here */
    
    /* hljs overrides to match our theme - only override background, let hljs handle all colors */
    pre code.hljs {
      background: transparent !important;
      padding: 0 !important;
    }
    
    .hljs {
      background: ${roninTheme.colors.backgroundSecondary} !important;
    }
    
    .markdown-content blockquote {
      border-left: 3px solid ${roninTheme.colors.accent};
      padding-left: ${roninTheme.spacing.md};
      margin: ${roninTheme.spacing.md} 0;
      color: ${roninTheme.colors.textSecondary};
    }
    
    .markdown-content ul, .markdown-content ol {
      margin: ${roninTheme.spacing.md} 0;
      padding-left: ${roninTheme.spacing.lg};
    }
    
    .markdown-content li {
      margin: ${roninTheme.spacing.xs} 0;
    }
    
    .markdown-content a {
      color: ${roninTheme.colors.textSecondary};
      text-decoration: underline;
    }
    
    .markdown-content a:hover {
      color: ${roninTheme.colors.textPrimary};
    }
    
    .markdown-content table {
      width: 100%;
      border-collapse: collapse;
      margin: ${roninTheme.spacing.md} 0;
    }
    
    .markdown-content th,
    .markdown-content td {
      padding: ${roninTheme.spacing.sm};
      border: 1px solid ${roninTheme.colors.border};
      text-align: left;
    }
    
    .markdown-content th {
      background: ${roninTheme.colors.backgroundSecondary};
      font-weight: 600;
    }
    
    /* Book chapter content - use same styling as markdown */
    .book-chapter-content {
      width: 100%;
      min-height: 100%;
    }
    
    /* Override any book chapter specific elements to match our theme */
    .book-chapter-content .chapter-header {
      margin-bottom: ${roninTheme.spacing.lg};
      padding-bottom: ${roninTheme.spacing.md};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .book-chapter-content .chapter-number {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textTertiary};
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: ${roninTheme.spacing.xs};
    }
    
    .book-chapter-content .chapter-title {
      color: ${roninTheme.colors.textPrimary};
      font-size: 2rem;
      font-weight: 300;
      margin: 0;
    }
    
    /* Ensure all text uses our theme colors - but NOT hljs syntax tokens */
    .book-chapter-content {
      color: ${roninTheme.colors.textPrimary};
    }
    
    .book-chapter-content p,
    .book-chapter-content li,
    .book-chapter-content td,
    .book-chapter-content h1,
    .book-chapter-content h2,
    .book-chapter-content h3,
    .book-chapter-content h4,
    .book-chapter-content span:not([class*="hljs"]),
    .book-chapter-content div:not([class*="hljs"]) {
      color: ${roninTheme.colors.textPrimary} !important;
    }
    
    .book-chapter-content :not(pre) > code {
      background: ${roninTheme.colors.backgroundSecondary} !important;
      color: ${roninTheme.colors.textPrimary} !important;
    }
    
    .book-chapter-content pre {
      background: ${roninTheme.colors.backgroundSecondary} !important;
      border: 1px solid ${roninTheme.colors.border} !important;
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
      overflow-x: auto;
      margin: ${roninTheme.spacing.md} 0;
    }
    
    .book-chapter-content pre code {
      background: transparent !important;
      padding: 0;
      font-size: 0.85em;
      line-height: 1.6;
    }
    
    /* Let hljs tokens use their own colors */
    .book-chapter-content pre code [class*="hljs"] {
      color: inherit;
    }
    
    .book-chapter-content a {
      color: ${roninTheme.colors.textSecondary} !important;
    }
    
    .book-chapter-content a:hover {
      color: ${roninTheme.colors.textPrimary} !important;
    }
    
    .book-chapter-content table {
      border-color: ${roninTheme.colors.border} !important;
    }
    
    .book-chapter-content th {
      background: ${roninTheme.colors.backgroundSecondary} !important;
      color: ${roninTheme.colors.textPrimary} !important;
    }
    
    .book-chapter-content td {
      border-color: ${roninTheme.colors.border} !important;
    }
    
    /* Code example titles */
    .book-chapter-content .code-example-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${roninTheme.colors.textTertiary} !important;
      margin-bottom: ${roninTheme.spacing.xs};
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📚 Ronin Documentation</h1>
    <p>Complete guide to building AI agents with Ronin</p>
  </div>
  
  <div class="main-container">
    <div class="sidebar" id="sidebar">
      <div class="sidebar-section">
        <div class="sidebar-section-title">📚 Book Chapters</div>
        <div id="book-chapters-list"></div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">⚔️ Skills & Duties</div>
        <div id="skills-duties-list"></div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">📄 Documentation</div>
        <div id="markdown-list"></div>
      </div>
    </div>
    
    <div class="content-area" id="content-area">
      <div class="content-wrapper">
        <div class="loading" id="loading">Select a document to view</div>
        <div id="content" style="display: none;"></div>
      </div>
    </div>
  </div>
  
  <script>
    let currentPath = null;
    let documents = { markdown: [], bookChapters: [], skillsDuties: [] };
    let hljsReady = false;
    let markedReady = false;
    
    // Initialize highlight.js
    try {
      if (typeof hljs !== 'undefined' && hljs) {
        hljs.configure({ ignoreUnescapedHTML: true });
        hljsReady = true;
        console.log('[docs] highlight.js loaded —', hljs.listLanguages().length, 'languages');
      } else {
        console.warn('[docs] highlight.js not available');
      }
    } catch(e) {
      console.warn('[docs] hljs init error:', e);
    }
    
    // Initialize marked
    try {
      if (typeof marked !== 'undefined' && marked) {
        if (marked.use) {
          marked.use({ breaks: true, gfm: true });
        } else if (marked.setOptions) {
          marked.setOptions({ breaks: true, gfm: true });
        }
        markedReady = true;
        console.log('[docs] marked loaded');
      } else {
        console.warn('[docs] marked not available');
      }
    } catch(e) {
      console.warn('[docs] marked init error:', e);
    }
    
    async function loadDocumentList() {
      try {
        const response = await fetch('/api/docs/list');
        if (!response.ok) throw new Error('Failed to load document list');
        documents = await response.json();
        renderSidebar();
      } catch (error) {
        console.error('Failed to load document list:', error);
      }
    }
    
    function renderSidebar() {
      const bookChaptersList = document.getElementById('book-chapters-list');
      const skillsDutiesList = document.getElementById('skills-duties-list');
      const markdownList = document.getElementById('markdown-list');
      
      bookChaptersList.innerHTML = '';
      skillsDutiesList.innerHTML = '';
      markdownList.innerHTML = '';
      
      // Render book chapters
      documents.bookChapters.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'doc-item';
        item.textContent = doc.displayName;
        item.onclick = () => loadDocument(doc.path, doc.type);
        if (currentPath === doc.path) {
          item.classList.add('active');
        }
        bookChaptersList.appendChild(item);
      });
      
      // Render skills & duties (grouped by category)
      let lastCategory = '';
      (documents.skillsDuties || []).forEach(doc => {
        if (doc.category !== lastCategory) {
          const catHeader = document.createElement('div');
          catHeader.style.cssText = 'font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${roninTheme.colors.textTertiary}; margin-top: 0.5rem; margin-bottom: 0.25rem; padding-left: 0.75rem;';
          catHeader.textContent = doc.category;
          skillsDutiesList.appendChild(catHeader);
          lastCategory = doc.category;
        }
        const item = document.createElement('div');
        item.className = 'doc-item';
        item.textContent = doc.displayName;
        item.onclick = () => loadDocument(doc.path, doc.type);
        if (currentPath === doc.path) {
          item.classList.add('active');
        }
        skillsDutiesList.appendChild(item);
      });
      
      // Render markdown files
      documents.markdown.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'doc-item';
        item.textContent = doc.displayName;
        item.onclick = () => loadDocument(doc.path, doc.type);
        if (currentPath === doc.path) {
          item.classList.add('active');
        }
        markdownList.appendChild(item);
      });
    }
    
    async function loadDocument(path, type) {
      currentPath = path;
      renderSidebar();
      
      const loading = document.getElementById('loading');
      const content = document.getElementById('content');
      
      loading.style.display = 'block';
      content.style.display = 'none';
      loading.textContent = 'Loading...';
      
      try {
        const response = await fetch(\`/api/docs/content?path=\${encodeURIComponent(path)}\`);
        if (!response.ok) throw new Error('Failed to load document');
        
        const data = await response.json();
        
        loading.style.display = 'none';
        content.style.display = 'block';
        
        if (type === 'markdown') {
          renderMarkdown(data.content);
        } else if (type === 'book-chapter') {
          renderBookChapter(data.content);
        } else {
          content.innerHTML = \`<pre><code>\${escapeHtml(data.content)}</code></pre>\`;
          highlightAllCode(content);
        }
        
        // Scroll to top
        document.getElementById('content-area').scrollTop = 0;
      } catch (error) {
        loading.style.display = 'none';
        content.innerHTML = \`<div class="error">Failed to load document: \${error.message}</div>\`;
        content.style.display = 'block';
      }
    }
    
    function renderMarkdown(markdown) {
      const content = document.getElementById('content');
      content.innerHTML = '';
      
      if (markedReady && marked.parse) {
        try {
          const html = marked.parse(markdown);
          const wrapper = document.createElement('div');
          wrapper.className = 'markdown-content';
          wrapper.innerHTML = html;
          content.appendChild(wrapper);
          highlightAllCode(wrapper);
        } catch (e) {
          console.warn('[docs] Markdown parsing failed:', e);
          const pre = document.createElement('pre');
          pre.textContent = markdown;
          content.appendChild(pre);
        }
      } else {
        const pre = document.createElement('pre');
        pre.textContent = markdown;
        content.appendChild(pre);
      }
    }
    
    function detectLanguage(code) {
      const trimmed = code.trim();
      if (/^import\\s|^export\\s|^class\\s|^interface\\s|^type\\s|async\\s+execute|: Promise<|: string|: number|: boolean|AgentAPI|BaseAgent/.test(trimmed)) return 'typescript';
      if (/^const\\s|^let\\s|^var\\s|^function\\s|=>|require\\(/.test(trimmed)) return 'javascript';
      if (/^\\$|^npm\\s|^bun\\s|^ronin\\s|^cd\\s|^mkdir\\s|^curl\\s|^git\\s|^sudo\\s/.test(trimmed)) return 'bash';
      if (/^\\{[\\s\\S]*\\}$/.test(trimmed) && /"|:/.test(trimmed)) return 'json';
      if (/^SELECT\\s|^INSERT\\s|^CREATE\\s|^UPDATE\\s|^DELETE\\s|^ALTER\\s/i.test(trimmed)) return 'sql';
      if (/^<\\?xml|^<!DOCTYPE|^<html|^<div/i.test(trimmed)) return 'xml';
      if (/^---\\n|^\\w+:\\s/.test(trimmed)) return 'yaml';
      if (/\\.\\w+\\s*\\{|^@media|^@import|^\\*\\s*\\{/.test(trimmed)) return 'css';
      if (/^#!.*\\/bin\\/|^#\\s/.test(trimmed)) return 'bash';
      return null;
    }
    
    function highlightAllCode(container) {
      if (!hljsReady) {
        console.warn('[docs] hljs not ready, skipping highlight');
        return;
      }
      
      const blocks = container.querySelectorAll('pre code');
      console.log('[docs] highlighting', blocks.length, 'code blocks');
      
      blocks.forEach(block => {
        if (block.classList.contains('hljs')) return;
        
        // Try to detect language if none is specified
        const hasLang = block.className && (block.className.includes('language-') || block.className.includes('hljs'));
        if (!hasLang) {
          const lang = detectLanguage(block.textContent || '');
          if (lang) {
            block.classList.add('language-' + lang);
          }
        }
        
        try {
          hljs.highlightElement(block);
        } catch(e) {
          console.warn('[docs] hljs failed on block:', e);
        }
      });
    }
    
    function renderBookChapter(html) {
      const content = document.getElementById('content');
      // Book chapters are full HTML documents with their own CSS
      // Extract the content and render with our theme instead of book.css
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract the main content div (book chapters use .content class)
      const contentDiv = doc.querySelector('.content') || doc.body;
      
      // Clear any previous content first
      content.innerHTML = '';
      
      // Create a wrapper with our markdown-content class to use our theme
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-content book-chapter-content';
      
      // Copy the inner HTML but we'll need to override styles
      wrapper.innerHTML = contentDiv.innerHTML;
      
      // Override any inline styles that might conflict
      wrapper.querySelectorAll('*').forEach(el => {
        // Remove any inline styles that set light colors
        if (el.style.color && el.style.color.includes('rgb(31, 41, 55)')) {
          el.style.color = '';
        }
        if (el.style.backgroundColor && el.style.backgroundColor.includes('rgb(255')) {
          el.style.backgroundColor = '';
        }
      });
      
      content.appendChild(wrapper);
      
      // Apply syntax highlighting to all code blocks
      highlightAllCode(wrapper);
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Load document list on page load
    loadDocumentList();
    
    // Load document from URL hash if present
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        // Find document by path or name
        const allDocs = [...documents.markdown, ...documents.bookChapters, ...(documents.skillsDuties || [])];
        const doc = allDocs.find(d => d.path === hash || d.name === hash);
        if (doc) {
          loadDocument(doc.path, doc.type);
        }
      }
    });
    
    // Check for initial hash
    if (window.location.hash) {
      window.dispatchEvent(new Event('hashchange'));
    }
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  }
}
