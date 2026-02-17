import { existsSync, readdir } from "fs";
import { join } from "path";
import { readFile } from "fs/promises";
import { marked } from "marked";

/**
 * Documentation command: View documentation in browser or terminal
 */
export interface DocsOptions {
  document?: string;
  browser?: boolean;
  terminal?: boolean;
  port?: number;
  list?: boolean;
}

const DOCS_DIR = join(process.cwd(), "docs");
const DOCS_MAP: Record<string, string> = {
  "CLI": "CLI.md",
  "ARCHITECTURE": "ARCHITECTURE.md",
  "PLUGINS": "PLUGINS.md",
  "TOOL_CALLING": "TOOL_CALLING.md",
  "REMOTE_AI": "REMOTE_AI.md",
  "OLLAMA_GPU": "OLLAMA_GPU.md",
  "MCP": "MCP.md",
  "RAG": "RAG.md",
  "CRON_SCHEDULING": "CRON_SCHEDULING.md",
  "CONFIG_EDITOR": "CONFIG_EDITOR.md",
  "HYBRID_INTELLIGENCE": "HYBRID_INTELLIGENCE.md",
};

/** Shared clean-docs theme: small, organized typography */
const DOCS_THEME_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #374151;
    background: #f8fafc;
  }
  .doc-page a { color: #2563eb; text-decoration: none; }
  .doc-page a:hover { text-decoration: underline; }
  .doc-page h1 { font-size: 1.35rem; font-weight: 600; color: #111827; margin: 0 0 0.75rem; padding-bottom: 0.35rem; border-bottom: 1px solid #e5e7eb; }
  .doc-page h2 { font-size: 1.1rem; font-weight: 600; color: #1f2937; margin: 1.25rem 0 0.5rem; }
  .doc-page h3 { font-size: 1rem; font-weight: 600; color: #374151; margin: 1rem 0 0.4rem; }
  .doc-page h4 { font-size: 0.9rem; font-weight: 600; color: #4b5563; margin: 0.75rem 0 0.35rem; }
  .doc-page p { margin: 0 0 0.6rem; }
  .doc-page ul, .doc-page ol { margin: 0 0 0.6rem 1.25rem; }
  .doc-page li { margin: 0.2rem 0; }
  .doc-page code {
    font-size: 12px;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    background: #f1f5f9;
    color: #0f172a;
    padding: 0.15rem 0.35rem;
    border-radius: 4px;
    border: 1px solid #e2e8f0;
  }
  .doc-page pre {
    font-size: 12px;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    background: #1e293b;
    color: #e2e8f0;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.5rem 0 0.75rem;
    border: 1px solid #334155;
  }
  .doc-page pre code { background: none; color: inherit; padding: 0; border: none; }
  .doc-page blockquote {
    border-left: 3px solid #cbd5e1;
    margin: 0.5rem 0 0.75rem;
    padding: 0 0 0 0.75rem;
    color: #475569;
  }
  .doc-page table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin: 0.5rem 0 0.75rem;
  }
  .doc-page th, .doc-page td {
    border: 1px solid #e2e8f0;
    padding: 0.35rem 0.6rem;
    text-align: left;
  }
  .doc-page th { background: #f1f5f9; font-weight: 600; color: #334155; }
  .doc-page hr { border: none; border-top: 1px solid #e5e7eb; margin: 1rem 0; }
`;

/**
 * Start documentation server
 */
function startDocsServer(port: number = 3002): void {
  Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS headers
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // Serve main index
      if (path === "/" || path === "/docs") {
        return new Response(getDocsIndexHTML(), {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      // Serve specific document
      if (path.startsWith("/docs/")) {
        const docName = path.replace("/docs/", "").replace(".md", "");
        const docFile = DOCS_MAP[docName.toUpperCase()] || `${docName}.md`;
        const docPath = join(DOCS_DIR, docFile);

        if (existsSync(docPath)) {
          try {
            const content = await readFile(docPath, "utf-8");
            const html = await getDocHTML(docName, content);
            return new Response(html, {
              headers: { "Content-Type": "text/html", ...corsHeaders },
            });
          } catch (error) {
            return new Response(`Error reading document: ${error}`, {
              status: 500,
              headers: corsHeaders,
            });
          }
        } else {
          return new Response("Document not found", {
            status: 404,
            headers: corsHeaders,
          });
        }
      }

      // API: List documents
      if (path === "/api/docs") {
        const docs = await listAvailableDocs();
        return Response.json(docs, { headers: corsHeaders });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`📚 Documentation server started on http://localhost:${port}/docs`);
  console.log(`   Open in browser: http://localhost:${port}/docs`);
}

/**
 * List available documentation files
 */
async function listAvailableDocs(): Promise<string[]> {
  const docs: string[] = [];
  
  // Check mapped documents
  for (const [name, file] of Object.entries(DOCS_MAP)) {
    const path = join(DOCS_DIR, file);
    if (existsSync(path)) {
      docs.push(name);
    }
  }
  
  // Check for other markdown files
  try {
    const files = await readdir(DOCS_DIR);
    for (const file of files) {
      if (file.endsWith(".md") && !docs.includes(file.replace(".md", ""))) {
        docs.push(file.replace(".md", ""));
      }
    }
  } catch {
    // Docs directory doesn't exist
  }
  
  return docs.sort();
}

/**
 * Get HTML for docs index
 */
function getDocsIndexHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Documentation</title>
  <style>${DOCS_THEME_CSS}
    .index-wrap { max-width: 960px; margin: 0 auto; padding: 1.25rem 1.5rem; }
    .index-wrap h1 { font-size: 1.25rem; font-weight: 600; color: #111827; margin-bottom: 0.5rem; border: none; padding: 0; }
    .index-wrap .sub { font-size: 12px; color: #6b7280; margin-bottom: 1rem; }
    .docs-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem; }
    .doc-card {
      display: block;
      font-size: 12px;
      padding: 0.6rem 0.75rem;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
      background: #fff;
      color: #374151;
      text-decoration: none;
      transition: border-color 0.15s, background 0.15s;
    }
    .doc-card:hover { border-color: #93c5fd; background: #eff6ff; }
    .doc-card strong { color: #1e40af; font-weight: 600; }
  </style>
</head>
<body>
  <div class="index-wrap">
    <h1>Ronin Documentation</h1>
    <p class="sub">Select a document to view.</p>
    <div class="docs-list" id="docs-list">
      <span style="color:#6b7280">Loading…</span>
    </div>
  </div>
  <script>
    fetch('/api/docs')
      .then(res => res.json())
      .then(docs => {
        const list = document.getElementById('docs-list');
        list.innerHTML = docs.map(doc => '<a href="/docs/' + encodeURIComponent(doc) + '" class="doc-card"><strong>' + doc + '</strong></a>').join('');
      });
  </script>
</body>
</html>`;
}

/**
 * Get HTML for a specific document (full markdown support via marked)
 */
async function getDocHTML(title: string, content: string): Promise<string> {
  marked.setOptions({ gfm: true, breaks: true });
  const html = await marked.parse(content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Ronin</title>
  <style>${DOCS_THEME_CSS}
    .doc-wrap { max-width: 720px; margin: 0 auto; padding: 1.25rem 1.5rem; }
    .doc-nav { font-size: 12px; margin-bottom: 1rem; }
    .doc-nav a { color: #2563eb; }
    .doc-page { padding: 0; }
  </style>
</head>
<body>
  <div class="doc-wrap">
    <nav class="doc-nav"><a href="/docs">← Documentation</a></nav>
    <article class="doc-page">${html}</article>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Show document in terminal
 */
async function showDocInTerminal(docName: string): Promise<void> {
  const docFile = DOCS_MAP[docName.toUpperCase()] || `${docName}.md`;
  const docPath = join(DOCS_DIR, docFile);

  if (!existsSync(docPath)) {
    console.error(`❌ Document not found: ${docName}`);
    console.log("\nAvailable documents:");
    const docs = await listAvailableDocs();
    docs.forEach(doc => console.log(`  - ${doc}`));
    process.exit(1);
  }

  try {
    const content = await readFile(docPath, "utf-8");
    console.log(`\n📚 ${docName}\n`);
    console.log("=".repeat(60));
    console.log(content);
    console.log("=".repeat(60));
  } catch (error) {
    console.error(`❌ Error reading document: ${error}`);
    process.exit(1);
  }
}

/**
 * Docs command: View documentation
 */
export async function docsCommand(options: DocsOptions = {}): Promise<void> {
  if (options.list) {
    const docs = await listAvailableDocs();
    console.log("\n📚 Available Documentation:\n");
    docs.forEach(doc => console.log(`  - ${doc}`));
    return;
  }

  if (options.terminal && options.document) {
    await showDocInTerminal(options.document);
    return;
  }

  // Default: Start server and open in browser
  const port = options.port || 3002;
  startDocsServer(port);

  // Open in browser
  const docPath = options.document 
    ? `/docs/${options.document}` 
    : "/docs";
  const url = `http://localhost:${port}${docPath}`;

  // Try to open browser
  if (options.browser !== false) {
    try {
      const { spawn } = await import("child_process");
      const platform = process.platform;
      let command: string;
      let args: string[];

      if (platform === "darwin") {
        command = "open";
        args = [url];
      } else if (platform === "win32") {
        command = "cmd";
        args = ["/c", "start", url];
      } else {
        command = "xdg-open";
        args = [url];
      }

      spawn(command, args, { detached: true, stdio: "ignore" });
    } catch {
      console.log(`\n💡 Open in browser: ${url}`);
    }
  } else {
    console.log(`\n💡 Open in browser: ${url}`);
  }

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\n🛑 Documentation server stopped");
    process.exit(0);
  });
}

