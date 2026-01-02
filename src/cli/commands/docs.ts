import { existsSync, readdir } from "fs";
import { join } from "path";
import { readFile } from "fs/promises";

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
};

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
            return new Response(getDocHTML(docName, content), {
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
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 2rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 2rem;
    }
    h1 { color: #333; margin-bottom: 1rem; }
    .docs-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
      margin-top: 2rem;
    }
    .doc-card {
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      padding: 1.5rem;
      text-decoration: none;
      color: #333;
      transition: all 0.2s;
    }
    .doc-card:hover {
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }
    .doc-card h3 {
      color: #667eea;
      margin-bottom: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📚 Ronin Documentation</h1>
    <p>Select a document to view:</p>
    <div class="docs-list" id="docs-list">
      <div>Loading...</div>
    </div>
  </div>
  <script>
    fetch('/api/docs')
      .then(res => res.json())
      .then(docs => {
        const list = document.getElementById('docs-list');
        list.innerHTML = docs.map(doc => 
          \`<a href="/docs/\${doc}" class="doc-card">
            <h3>\${doc}</h3>
            <p>View documentation</p>
          </a>\`
        ).join('');
      });
  </script>
</body>
</html>`;
}

/**
 * Get HTML for a specific document
 */
function getDocHTML(title: string, content: string): string {
  // Simple markdown to HTML conversion (basic)
  let html = content
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/```([\\s\\S]*?)```/gim, '<pre><code>$1</code></pre>')
    .replace(/\\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Ronin Documentation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 2rem;
      line-height: 1.6;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 2rem;
    }
    h1 { color: #333; margin-bottom: 1rem; }
    h2 { color: #555; margin-top: 2rem; margin-bottom: 1rem; }
    h3 { color: #777; margin-top: 1.5rem; margin-bottom: 0.75rem; }
    code {
      background: #f4f4f4;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    pre {
      background: #f4f4f4;
      padding: 1rem;
      border-radius: 5px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code {
      background: none;
      padding: 0;
    }
    a {
      color: #667eea;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .back-link {
      display: inline-block;
      margin-bottom: 1rem;
      color: #667eea;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/docs" class="back-link">← Back to Documentation</a>
    <div>${html}</div>
  </div>
</body>
</html>`;
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

