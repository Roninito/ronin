/**
 * Notion Plugin
 * 
 * Provides API access to Notion workspaces.
 * Requires NOTION_API_KEY environment variable or config.
 */

import type { Plugin } from "./base.js";

interface NotionPage {
  id: string;
  title: string;
  url: string;
  created_time: string;
  last_edited_time: string;
}

interface NotionBlock {
  type: string;
  [key: string]: any;
}

const notionPlugin: Plugin = {
  name: "notion",
  description: "Notion API integration for reading/writing pages",
  methods: {
    /**
     * Get Notion API key from env or config
     */
    getApiKey(): string | null {
      return process.env.NOTION_API_KEY || null;
    },

    /**
     * List all pages in a database or workspace
     */
    listPages: async (options?: { databaseId?: string; limit?: number }): Promise<NotionPage[]> => {
      const apiKey = notionPlugin.methods.getApiKey();
      if (!apiKey) {
        throw new Error("NOTION_API_KEY not configured");
      }

      const databaseId = options?.databaseId || await notionPlugin.methods.getDefaultDatabaseId(apiKey);
      const limit = options?.limit || 20;

      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: limit,
        }),
      });

      if (!response.ok) {
        throw new Error(`Notion API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.results.map((page: any) => ({
        id: page.id,
        title: getPageTitle(page),
        url: page.url,
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
      }));
    },

    /**
     * Read a page by ID or title
     */
    readPage: async (identifier: string): Promise<{ title: string; content: string; url: string }> => {
      const apiKey = notionPlugin.methods.getApiKey();
      if (!apiKey) {
        throw new Error("NOTION_API_KEY not configured");
      }

      // Try to find page by title first
      const pages = await notionPlugin.methods.listPages({ limit: 100 });
      const page = pages.find(p => 
        p.title.toLowerCase().includes(identifier.toLowerCase()) || 
        p.id === identifier
      );

      if (!page) {
        throw new Error(`Page not found: ${identifier}`);
      }

      // Get page blocks
      const blocksResponse = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
        },
      });

      if (!blocksResponse.ok) {
        throw new Error(`Notion API error: ${blocksResponse.status}`);
      }

      const blocksData = await blocksResponse.json();
      const content = blocksData.results
        .map((block: any) => blockToText(block))
        .filter(Boolean)
        .join("\n\n");

      return {
        title: page.title,
        content,
        url: page.url,
      };
    },

    /**
     * Create or update a page with content
     */
    writePage: async (options: {
      title: string;
      content: string;
      parentDatabaseId?: string;
      pageId?: string; // If provided, update existing page
    }): Promise<{ id: string; title: string; url: string }> => {
      const apiKey = notionPlugin.methods.getApiKey();
      if (!apiKey) {
        throw new Error("NOTION_API_KEY not configured");
      }

      const { title, content, parentDatabaseId, pageId } = options;

      // Convert content to Notion blocks
      const children = contentToBlocks(content);

      if (pageId) {
        // Update existing page - append blocks
        const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children/append`, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ children }),
        });

        if (!response.ok) {
          throw new Error(`Notion API error: ${response.status}`);
        }

        const page = await response.json();
        return {
          id: page.id || pageId,
          title,
          url: page.url || `https://notion.so/${pageId}`,
        };
      } else {
        // Create new page
        const databaseId = parentDatabaseId || await notionPlugin.methods.getDefaultDatabaseId(apiKey);
        
        const response = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: { database_id: databaseId },
            properties: {
              Name: {
                title: [{ text: { content: title } }],
              },
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Notion API error: ${response.status}`);
        }

        const page = await response.json();
        const pageId = page.id;

        // Now add content blocks
        await fetch(`https://api.notion.com/v1/blocks/${pageId}/children/append`, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ children }),
        });

        return {
          id: pageId,
          title,
          url: page.url,
        };
      }
    },

    /**
     * Search for pages by query
     */
    search: async (query: string): Promise<NotionPage[]> => {
      const apiKey = notionPlugin.methods.getApiKey();
      if (!apiKey) {
        throw new Error("NOTION_API_KEY not configured");
      }

      const response = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          filter: { property: "object", value: "page" },
        }),
      });

      if (!response.ok) {
        throw new Error(`Notion API error: ${response.status}`);
      }

      const data = await response.json();
      return data.results.map((page: any) => ({
        id: page.id,
        title: getPageTitle(page),
        url: page.url,
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
      }));
    },

    // Internal helpers
    async getDefaultDatabaseId(apiKey: string): Promise<string> {
      // Try to find the first available database
      const response = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: { property: "object", value: "database" },
          page_size: 1,
        }),
      });

      if (!response.ok) {
        throw new Error("No Notion databases found. Please create a database and share it with the integration.");
      }

      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        throw new Error("No Notion databases found");
      }

      return data.results[0].id;
    },
  },
};

// Helper functions
function getPageTitle(page: any): string {
  const titleProp = page.properties?.Name || page.properties?.title;
  if (titleProp?.title?.[0]?.plain_text) {
    return titleProp.title[0].plain_text;
  }
  if (titleProp?.title?.[0]?.text?.content) {
    return titleProp.title[0].text.content;
  }
  return "Untitled";
}

function blockToText(block: any): string {
  const type = block.type;
  const blockData = block[type];
  
  if (!blockData) return "";
  
  // Extract text from rich_text array
  const text = blockData.rich_text
    ?.map((rt: any) => rt.plain_text || rt.text?.content || "")
    .filter(Boolean)
    .join("") || "";

  if (!text) return "";

  // Add formatting based on block type
  switch (type) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `• ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "quote":
      return `> ${text}`;
    case "code":
      return `\`\`\`${blockData.language || ""}\n${text}\n\`\`\``;
    default:
      return text;
  }
}

function contentToBlocks(content: string): any[] {
  const lines = content.split("\n");
  const blocks: any[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect block type from markdown-like syntax
    if (trimmed.startsWith("# ")) {
      blocks.push({
        heading_1: {
          rich_text: [{ text: { content: trimmed.slice(2) } }],
        },
      });
    } else if (trimmed.startsWith("## ")) {
      blocks.push({
        heading_2: {
          rich_text: [{ text: { content: trimmed.slice(3) } }],
        },
      });
    } else if (trimmed.startsWith("### ")) {
      blocks.push({
        heading_3: {
          rich_text: [{ text: { content: trimmed.slice(4) } }],
        },
      });
    } else if (trimmed.startsWith("• ") || trimmed.startsWith("- ")) {
      blocks.push({
        bulleted_list_item: {
          rich_text: [{ text: { content: trimmed.slice(2) } }],
        },
      });
    } else if (trimmed.startsWith("> ")) {
      blocks.push({
        quote: {
          rich_text: [{ text: { content: trimmed.slice(2) } }],
        },
      });
    } else if (trimmed.startsWith("```")) {
      // Code block handling (simplified)
      blocks.push({
        code: {
          rich_text: [{ text: { content: trimmed.replace(/```/g, "") } }],
        },
      });
    } else {
      // Default paragraph
      blocks.push({
        paragraph: {
          rich_text: [{ text: { content: trimmed } }],
        },
      });
    }
  }

  return blocks;
}

export default notionPlugin;
