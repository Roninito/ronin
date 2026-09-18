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

// toolMetadata: real per-method descriptions + parameter schemas so the auto-generated
// memory/notes/tools/obsidian.md (regenerated at boot by src/tools/toolDocs.ts and
// daily by duties/tools-indexer.ts) shows actionable signatures instead of generic
// `args (array)` stubs — see plugins/skills.ts:1 and src/tools/toolDocs.ts for the
// generation pipeline. Without this, the messenger's `local.tools.load_category`
// + the system prompt's `local.memory.search` discovery both surface only generic
// "Call <method> from obsidian plugin" descriptions, which is why Telegram
// conversations have failed to use these tools end-to-end.
const toolMetadata: Plugin["toolMetadata"] = {
  getVaults: {
    description: "List the Obsidian vaults currently configured in config.json (those with `enabled: true`). Returns each vault's id, absolute path, and the folders Ronin is allowed to access within it. Call this first whenever a vault-scoped operation is needed — the returned `id` is what you pass to `obsidian-vault-indexer`, and the `path` is what you pass to `listNotes`/`readNote`/`writeNote`.",
    parameters: {
      type: "object",
      properties: {
        vaults: {
          type: "array",
          description: "Optional. Usually omitted — pass `api.config.get('obsidian.vaults')` if you have it; the plugin reads enabled vaults from config otherwise. Each entry: { id, path, enabled, allowedFolders[] }.",
        },
      },
    },
  },
  validateVaultAccess: {
    description: "Check whether a given file path is inside the vault and under one of its `allowedFolders` (folder whitelisting). Returns true/false. Use this before writeNote/appendNote/deleteNote to enforce the whitelist without surprise — the plugin will happily write anywhere, this is the gate.",
    parameters: {
      type: "object",
      properties: {
        vaultPath: { type: "string", description: "Absolute path to the vault root (from getVaults)." },
        filePath: { type: "string", description: "Absolute path to the candidate file." },
        allowedFolders: { type: "array", description: "Folder whitelist from the vault config; relative to vaultPath." },
      },
      required: ["vaultPath", "filePath", "allowedFolders"],
    },
  },
  listNotes: {
    description: "Walk one vault and return absolute paths of every `.md` file under the vault's `allowedFolders` (recursive). Use this to discover what's in a vault before reading. The returned paths are what you pass to `readNote`.",
    parameters: {
      type: "object",
      properties: {
        vaultPath: { type: "string", description: "Absolute path to the vault root." },
        allowedFolders: { type: "array", description: "Folder whitelist to walk (from vault config)." },
        recursive: { type: "boolean", description: "Default true. Set false to stop at the top level." },
      },
      required: ["vaultPath", "allowedFolders"],
    },
  },
  readNote: {
    description: "Read one markdown file and return its parsed structure: title (frontmatter.title or first `# heading` or filename), body content (frontmatter stripped), parsed YAML frontmatter, wikilinks [[like this]], tags (frontmatter + `#hashtags`), and file timestamps. Use this for full content reads; for fast metadata-only lookups across many notes, prefer `local.memory.search` over the indexed `obsidian-<vault>-<relative-path>` notes instead.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute path to a single `.md` file." },
      },
      required: ["filePath"],
    },
  },
  searchNotes: {
    description: "Filter a pre-loaded array of ObsidianNote objects by title / tags / content / all. Substring match, case-insensitive. You usually don't call this directly — combine `listNotes` + `readNote` (one at a time, on demand) and let `local.memory.search` handle indexed lookups across the daily-indexed `obsidian-*` memory notes.",
    parameters: {
      type: "object",
      properties: {
        notes: { type: "array", description: "Array of ObsidianNote objects (output of readNote)." },
        query: { type: "string", description: "Substring to search for." },
        searchIn: { type: "string", description: "One of: \"title\" | \"tags\" | \"content\" | \"all\" (default \"all\")." },
      },
      required: ["notes", "query"],
    },
  },
  listFilesInDir: {
    description: "List files directly inside one folder (non-recursive) filtered by extension. Distinct from listNotes which recurses into subfolders — use this when you want just the loose files at this level (e.g. auditing a vault's root-level notes without walking into unrelated subfolders).",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Absolute path to the directory." },
        extensions: { type: "array", description: "Filename extensions to include; default [\".md\"]." },
      },
      required: ["dir"],
    },
  },
  ensureFolder: {
    description: "Create a directory (and any missing parents) inside the vault if it doesn't exist. Idempotent. Call this before writeNote/appendNote when targeting a not-yet-existing folder.",
    parameters: {
      type: "object",
      properties: {
        folderPath: { type: "string", description: "Absolute path to the folder to create." },
      },
      required: ["folderPath"],
    },
  },
  writeNote: {
    description: "Write a markdown file (overwriting any existing content) and create its parent folders if missing. The single audited write path into a vault — Ronin's own MemoryStore goes through here rather than touching `fs` directly. Validate the path with `validateVaultAccess` first if folder whitelisting matters.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute path to the file to write." },
        content: { type: "string", description: "Full file content (UTF-8)." },
      },
      required: ["filePath", "content"],
    },
  },
  appendNote: {
    description: "Append content to an existing markdown file, creating it (and parents) if it doesn't exist. Use for log-style appends; for structured updates prefer writeNote.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute path to the file." },
        content: { type: "string", description: "Content to append (UTF-8)." },
      },
      required: ["filePath", "content"],
    },
  },
  deleteNote: {
    description: "Delete one markdown file. Returns true if a file was removed, false if it didn't exist. There is no undo; confirm intent for any non-reversible delete.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute path to the file to delete." },
      },
      required: ["filePath"],
    },
  },
  getBacklinks: {
    description: "Given a pre-loaded array of ObsidianNote and a target title, return notes whose wikilinks include the target (case-insensitive, .md suffix-insensitive). Pairs with readNote when scanning a graph by hand; for indexed backlink discovery prefer local.memory.search over obsidian-* notes.",
    parameters: {
      type: "object",
      properties: {
        notes: { type: "array", description: "Array of ObsidianNote objects." },
        targetTitle: { type: "string", description: "Title to search for as a wikilink target (with or without .md)." },
      },
      required: ["notes", "targetTitle"],
    },
  },
  getAllTags: {
    description: "Collect every unique tag from an array of ObsidianNote objects, sorted alphabetically. Use for building a tag index in memory; for tag lookups across the whole vault prefer local.memory.search.",
    parameters: {
      type: "object",
      properties: {
        notes: { type: "array", description: "Array of ObsidianNote objects." },
      },
      required: ["notes"],
    },
  },
};

export interface ObsidianNote {
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

  // Capture group is mandatory in frontmatterRegex, so a successful match always has it.
  const frontmatterStr = match[1]!;
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
    // Capture group is mandatory in wikilinksRegex, so a successful exec() always has it.
    const link = match[1]!.split("|")[0]!.trim();
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
  toolMetadata,
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
     * List files directly inside a folder (non-recursive), filtered by extension.
     * Unlike `listNotes`, this does not descend into subfolders — used when a
     * caller wants "just the loose files here" without also pulling in every
     * nested folder (e.g. auditing a vault's root-level notes without also
     * walking into unrelated subfolders).
     */
    listFilesInDir: (dir: string, extensions: string[] = [".md"]): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)))
        .map((entry) => path.join(dir, entry.name));
    },

    /**
     * Create a vault folder (and any missing parents) if it doesn't exist yet.
     */
    ensureFolder: (folderPath: string): void => {
      fs.mkdirSync(folderPath, { recursive: true });
    },

    /**
     * Write a note's raw content, overwriting whatever was there. Creates
     * parent folders as needed. This is the sole write path into a vault —
     * Ronin's own file-backed memory store (src/memory/Memory.ts) goes
     * through this rather than touching `fs` directly, so every write Ronin
     * makes into a vault is one code path to audit or extend.
     */
    writeNote: (filePath: string, content: string): void => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
    },

    /**
     * Append raw content to a note, creating it (and parent folders) if it
     * doesn't exist yet.
     */
    appendNote: (filePath: string, content: string): void => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, content, "utf-8");
    },

    /**
     * Delete a note. Returns whether a file was actually removed.
     */
    deleteNote: (filePath: string): boolean => {
      if (!fs.existsSync(filePath)) return false;
      fs.unlinkSync(filePath);
      return true;
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
