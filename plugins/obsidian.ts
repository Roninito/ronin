/**
 * Obsidian Plugin
 *
 * Provides access to configured Obsidian vaults with:
 * - Vault enumeration and configuration validation
 * - Note listing with recursive folder support
 * - File reading with frontmatter extraction
 * - Metadata extraction (wikilinks, backlinks, tags)
 * - Access control enforcement (folder whitelisting)
 */

import type { Plugin } from "../src/plugins/base.js";
import * as fs from "fs";
import * as path from "path";
import type { ObsidianVaultConfig } from "../src/config/types.js";

interface ObsidianNote {
  vault_id: string;
  file_path: string;
  relative_path: string;
  title: string;
  content: string;
  frontmatter?: Record<string, any>;
  wikilinks: string[];
  backlinks: string[];
  tags: string[];
  created_at: number;
  modified_at: number;
}

interface VaultInfo {
  id: string;
  path: string;
  enabled: boolean;
  allowedFolders: string[];
}

/**
 * Parse YAML frontmatter from markdown content
 * Returns [frontmatter object, content without frontmatter]
 */
function extractFrontmatter(content: string): [Record<string, any>, string] {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return [{}, content];
  }

  const frontmatterStr = match[1];
  const contentWithout = content.slice(match[0].length);

  // Simple YAML parser for common frontmatter formats
  const frontmatter: Record<string, any> = {};
  frontmatterStr.split("\n").forEach((line) => {
    const colonIndex = line.indexOf(":");
    if (colonIndex > -1) {
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Parse arrays
      if (value.startsWith("[") && value.endsWith("]")) {
        try {
          frontmatter[key] = JSON.parse(value);
        } catch {
          frontmatter[key] = value;
        }
      } else {
        // Try to parse as boolean or number
        if (value === "true") frontmatter[key] = true;
        else if (value === "false") frontmatter[key] = false;
        else if (!isNaN(Number(value)) && value !== "") frontmatter[key] = Number(value);
        else frontmatter[key] = value;
      }
    }
  });

  return [frontmatter, contentWithout];
}

/**
 * Extract wikilinks [[...]] from content
 */
function extractWikilinks(content: string): string[] {
  const wikilinksRegex = /\[\[([^\[\]]+)\]\]/g;
  const matches: string[] = [];
  let match;

  while ((match = wikilinksRegex.exec(content)) !== null) {
    const link = match[1].split("|")[0].trim();
    if (link && !matches.includes(link)) {
      matches.push(link);
    }
  }

  return matches;
}

/**
 * Extract hashtags and tags from frontmatter
 */
function extractTags(content: string, frontmatter: Record<string, any>): string[] {
  const tags = new Set<string>();

  // From frontmatter
  if (frontmatter.tags) {
    const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
    fmTags.forEach((tag) => tags.add(String(tag)));
  }

  // From content hashtags
  const hashtagRegex = /#[\w-]+/g;
  let match;
  while ((match = hashtagRegex.exec(content)) !== null) {
    tags.add(match[0].substring(1));
  }

  return Array.from(tags);
}

const obsidianPlugin: Plugin = {
  name: "obsidian",
  description: "Obsidian vault access with metadata extraction",
  methods: {
    /**
     * Get configured vaults from config
     * Must be passed by the agent/caller
     */
    getVaults: (vaults?: ObsidianVaultConfig[]): VaultInfo[] => {
      if (!vaults) {
        throw new Error("No Obsidian vaults configured. Add obsidian.vaults to config.");
      }

      return vaults
        .filter((v) => v.enabled)
        .map((v) => ({
          id: v.id,
          path: v.path,
          enabled: v.enabled,
          allowedFolders: v.allowedFolders,
        }));
    },

    /**
     * Validate that a file path is within allowed folders
     */
    validateVaultAccess: (
      vaultPath: string,
      filePath: string,
      allowedFolders: string[]
    ): boolean => {
      const resolvedVault = path.resolve(vaultPath);
      const resolvedFile = path.resolve(filePath);

      // Check if file is within vault
      if (!resolvedFile.startsWith(resolvedVault)) {
        return false;
      }

      // Check if file is in an allowed folder
      const relativePath = path.relative(resolvedVault, resolvedFile);
      const firstFolder = relativePath.split(path.sep)[0];

      return allowedFolders.some((folder) => {
        const normalizedFolder = folder.replace(/\\/g, "/");
        const normalizedRelative = relativePath.replace(/\\/g, "/");

        return normalizedRelative.startsWith(normalizedFolder + "/") || normalizedRelative === normalizedFolder;
      });
    },

    /**
     * List all .md files in vault within allowed folders
     */
    listNotes: async (
      vaultPath: string,
      allowedFolders: string[],
      _recursive: boolean = true
    ): Promise<string[]> => {
      const notes: string[] = [];

      for (const folder of allowedFolders) {
        const folderPath = path.join(vaultPath, folder);

        // Skip if folder doesn't exist
        if (!fs.existsSync(folderPath)) {
          continue;
        }

        // Recursively find .md files
        const walkDir = (dir: string) => {
          const files = fs.readdirSync(dir, { withFileTypes: true });

          for (const file of files) {
            const fullPath = path.join(dir, file.name);

            if (file.isDirectory()) {
              walkDir(fullPath);
            } else if (file.name.endsWith(".md")) {
              notes.push(fullPath);
            }
          }
        };

        walkDir(folderPath);
      }

      return notes;
    },

    /**
     * Read a markdown file from vault and extract metadata
     */
    readNote: async (filePath: string): Promise<ObsidianNote | null> => {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const stats = fs.statSync(filePath);

        const [frontmatter, bodyContent] = extractFrontmatter(content);
        const wikilinks = extractWikilinks(content);
        const tags = extractTags(content, frontmatter);

        // Try to get title from frontmatter or first h1
        let title = frontmatter.title || "";
        if (!title) {
          const h1Match = bodyContent.match(/^# (.+)$/m);
          title = h1Match ? h1Match[1] : path.basename(filePath, ".md");
        }

        return {
          vault_id: "",
          file_path: filePath,
          relative_path: "",
          title,
          content: bodyContent,
          frontmatter,
          wikilinks,
          backlinks: [],
          tags,
          created_at: stats.birthtimeMs,
          modified_at: stats.mtimeMs,
        };
      } catch (error) {
        console.error(`Failed to read note ${filePath}:`, error);
        return null;
      }
    },

    /**
     * Search notes by tag, title, or content pattern
     */
    searchNotes: async (
      notes: ObsidianNote[],
      query: string,
      searchIn: "title" | "tags" | "content" | "all" = "all"
    ): Promise<ObsidianNote[]> => {
      const queryLower = query.toLowerCase();

      return notes.filter((note) => {
        switch (searchIn) {
          case "title":
            return note.title.toLowerCase().includes(queryLower);
          case "tags":
            return note.tags.some((tag) => tag.toLowerCase().includes(queryLower));
          case "content":
            return note.content.toLowerCase().includes(queryLower);
          case "all":
          default:
            return (
              note.title.toLowerCase().includes(queryLower) ||
              note.tags.some((tag) => tag.toLowerCase().includes(queryLower)) ||
              note.content.toLowerCase().includes(queryLower)
            );
        }
      });
    },

    /**
     * Get notes linking to a specific note (backlinks)
     */
    getBacklinks: (notes: ObsidianNote[], targetTitle: string): ObsidianNote[] => {
      const normalized = targetTitle.toLowerCase().replace(/\.md$/i, "");

      return notes.filter((note) =>
        note.wikilinks.some((link) => link.toLowerCase().replace(/\.md$/i, "") === normalized)
      );
    },

    /**
     * Extract all unique tags from a collection of notes
     */
    getAllTags: (notes: ObsidianNote[]): string[] => {
      const allTags = new Set<string>();
      notes.forEach((note) => note.tags.forEach((tag) => allTags.add(tag)));
      return Array.from(allTags).sort();
    },
  },
};

export default obsidianPlugin;
