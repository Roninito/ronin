import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillDir = join(__dirname, "..");

function getInput(): string {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a.startsWith("--input=")) return a.slice(8).trim();
  }
  if (process.env.INPUT) return process.env.INPUT.trim();
  if (existsSync(join(skillDir, "input.txt"))) return readFileSync(join(skillDir, "input.txt"), "utf-8").trim();
  return "";
}

function getAbility(): string {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a.startsWith("--ability=")) return a.slice(10).trim();
  }
  return process.env.ABILITY || "list";
}

function getApiKey(): string | null {
  return process.env.NOTION_API_KEY || null;
}

async function notionRequest(endpoint: string, method = "GET", body?: any): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("NOTION_API_KEY not configured. Set it in your environment or config.");
  }

  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => response.statusText);
    throw new Error(`Notion API error (${response.status}): ${error}`);
  }

  return response.json();
}

function getPageTitle(page: any): string {
  const titleProp = page.properties?.Name || page.properties?.title;
  if (titleProp?.title?.[0]?.plain_text) return titleProp.title[0].plain_text;
  if (titleProp?.title?.[0]?.text?.content) return titleProp.title[0].text.content;
  return "Untitled";
}

function blockToText(block: any): string {
  const type = block.type;
  const blockData = block[type];
  if (!blockData) return "";
  
  const text = blockData.rich_text
    ?.map((rt: any) => rt.plain_text || rt.text?.content || "")
    .filter(Boolean)
    .join("") || "";

  if (!text) return "";

  switch (type) {
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `• ${text}`;
    case "numbered_list_item": return `1. ${text}`;
    case "quote": return `> ${text}`;
    case "code": return `\`\`\`${blockData.language || ""}\n${text}\n\`\`\``;
    default: return text;
  }
}

function contentToBlocks(content: string): any[] {
  const lines = content.split("\n");
  const blocks: any[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("# ")) {
      blocks.push({ heading_1: { rich_text: [{ text: { content: trimmed.slice(2) } }] } });
    } else if (trimmed.startsWith("## ")) {
      blocks.push({ heading_2: { rich_text: [{ text: { content: trimmed.slice(3) } }] } });
    } else if (trimmed.startsWith("### ")) {
      blocks.push({ heading_3: { rich_text: [{ text: { content: trimmed.slice(4) } }] } });
    } else if (trimmed.startsWith("• ") || trimmed.startsWith("- ")) {
      blocks.push({ bulleted_list_item: { rich_text: [{ text: { content: trimmed.slice(2) } }] } });
    } else if (trimmed.startsWith("> ")) {
      blocks.push({ quote: { rich_text: [{ text: { content: trimmed.slice(2) } }] } });
    } else {
      blocks.push({ paragraph: { rich_text: [{ text: { content: trimmed } }] } });
    }
  }

  return blocks;
}

async function getDefaultDatabaseId(): Promise<string> {
  const data = await notionRequest("/search", "POST", {
    filter: { property: "object", value: "database" },
    page_size: 1,
  });
  
  if (!data.results || data.results.length === 0) {
    throw new Error("No Notion databases found. Create a database and share it with your integration.");
  }
  
  return data.results[0].id;
}

async function listPages(): Promise<string> {
  const databaseId = await getDefaultDatabaseId();
  const data = await notionRequest(`/databases/${databaseId}/query`, "POST", { page_size: 20 });
  
  const pages = data.results.map((page: any) => ({
    id: page.id,
    title: getPageTitle(page),
    url: page.url,
    last_edited_time: page.last_edited_time,
  }));
  
  if (pages.length === 0) {
    return JSON.stringify({ success: true, message: "No pages found", pages: [] });
  }
  
  const formatted = pages.map((p: any, i: number) => 
    `${i + 1}. **${p.title}**\n   Last edited: ${new Date(p.last_edited_time).toLocaleDateString()}\n   ${p.url}`
  ).join("\n\n");
  
  return JSON.stringify({
    success: true,
    message: `Found ${pages.length} pages:`,
    pages: pages.map((p: any) => ({ title: p.title, url: p.url })),
    formatted,
  });
}

async function readPage(input: string): Promise<string> {
  if (!input.trim()) {
    return JSON.stringify({ success: false, error: "Please provide a page title" });
  }
  
  // Search for the page
  const searchData = await notionRequest("/search", "POST", { query: input });
  const page = searchData.results.find((p: any) => 
    getPageTitle(p).toLowerCase().includes(input.toLowerCase())
  );
  
  if (!page) {
    return JSON.stringify({ success: false, error: `Page not found: ${input}` });
  }
  
  // Get page blocks
  const blocksData = await notionRequest(`/blocks/${page.id}/children`);
  const content = blocksData.results.map((b: any) => blockToText(b)).filter(Boolean).join("\n\n");
  
  return JSON.stringify({
    success: true,
    title: getPageTitle(page),
    url: page.url,
    content,
  });
}

async function writePage(input: string): Promise<string> {
  let data: any;
  
  try {
    data = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    const parts = input.split(":");
    data = { title: parts[0]?.trim() || "Untitled", content: parts.slice(1).join(":").trim() || input };
  }
  
  if (!data.content) {
    return JSON.stringify({ success: false, error: "Content is required" });
  }
  
  const databaseId = data.parentDatabaseId || await getDefaultDatabaseId();
  
  // Create page
  const pageData = await notionRequest("/pages", "POST", {
    parent: { database_id: databaseId },
    properties: { Name: { title: [{ text: { content: data.title || "Untitled" } }] } },
  });
  
  // Add content blocks
  const children = contentToBlocks(data.content);
  await notionRequest(`/blocks/${pageData.id}/children/append`, "PATCH", { children });
  
  return JSON.stringify({
    success: true,
    message: "Page created successfully!",
    title: data.title || "Untitled",
    url: pageData.url,
  });
}

async function searchPages(query: string): Promise<string> {
  if (!query || query.trim().length < 2) {
    return JSON.stringify({ success: false, error: "Search query must be at least 2 characters" });
  }
  
  const data = await notionRequest("/search", "POST", { query, filter: { property: "object", value: "page" } });
  
  const pages = data.results.map((page: any) => ({
    id: page.id,
    title: getPageTitle(page),
    url: page.url,
  }));
  
  if (pages.length === 0) {
    return JSON.stringify({ success: true, message: `No pages found matching "${query}"`, pages: [] });
  }
  
  const formatted = pages.map((p: any, i: number) => `${i + 1}. **${p.title}**\n   ${p.url}`).join("\n\n");
  
  return JSON.stringify({
    success: true,
    message: `Found ${pages.length} pages matching "${query}":`,
    pages,
    formatted,
  });
}

async function main(): Promise<void> {
  try {
    const ability = getAbility();
    const input = getInput();
    let result: string;
    
    switch (ability.toLowerCase()) {
      case "list": result = await listPages(); break;
      case "read": result = await readPage(input); break;
      case "write": result = await writePage(input); break;
      case "search": result = await searchPages(input); break;
      default:
        result = JSON.stringify({ success: false, error: `Unknown ability: ${ability}` });
    }
    
    console.log(result);
  } catch (err) {
    console.log(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      hint: "Set NOTION_API_KEY and share your databases with the integration",
    }));
    process.exit(1);
  }
}

main();
