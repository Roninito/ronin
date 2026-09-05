import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { Memory, ConversationEntry } from "./types.js";

/**
 * File-backed memory: every entry is a plain markdown file under
 * <dataDir>/{notes,conversations,blackboards}/ — readable, greppable, and
 * diffable without a database. Replaces the old SQLite `memories` /
 * `conversations` / `duty_state` tables and the ontology knowledge graph:
 * opaque SQLite blobs made it hard to see what was actually stored,
 * including accidentally-stored secrets. See docs/KNOWLEDGE_RETRIEVAL_GUIDE.md.
 */
export class MemoryStore {
  private notesDir: string;
  private conversationsDir: string;
  private blackboardsDir: string;

  constructor(dataDir: string = "memory") {
    this.notesDir = path.join(dataDir, "notes");
    this.conversationsDir = path.join(dataDir, "conversations");
    this.blackboardsDir = path.join(dataDir, "blackboards");
    for (const dir of [this.notesDir, this.conversationsDir, this.blackboardsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ── Notes (store/retrieve/search/addContext/getRecent) ──────────────────

  private slugFor(key: string): string {
    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
    return `${slugify(key)}-${hash}`;
  }

  private notePath(slug: string): string {
    return path.join(this.notesDir, `${slug}.md`);
  }

  /** Store a key-value pair. Value round-trips exactly via a fenced JSON block. */
  async store(key: string, value: unknown): Promise<void> {
    const slug = this.slugFor(key);
    const file = this.notePath(slug);
    const now = new Date().toISOString();
    const createdAt = fs.existsSync(file) ? readFrontmatter(fs.readFileSync(file, "utf-8")).createdAt ?? now : now;

    const frontmatter = serializeFrontmatter({
      key,
      kind: "kv",
      createdAt,
      updatedAt: now,
    });
    const body = "```json\n" + JSON.stringify(value, null, 2) + "\n```\n";
    fs.writeFileSync(file, `${frontmatter}\n\n${body}`, "utf-8");
  }

  /** Retrieve a value by key, or null if it was never stored. */
  async retrieve(key: string): Promise<unknown> {
    const file = this.notePath(this.slugFor(key));
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, "utf-8");
    return extractJsonBlock(content);
  }

  /**
   * Search notes by substring match over the full file (frontmatter + body),
   * matching the old behaviour of scanning both the free text and the raw
   * value for a hit. No index — a directory walk over `memory/notes/`.
   */
  async search(query: string, limit: number = 10): Promise<Memory[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const files = listMarkdownFiles(this.notesDir);
    const matches: Array<{ file: string; mtime: number; content: string }> = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.toLowerCase().includes(q)) {
        matches.push({ file, mtime: fs.statSync(file).mtimeMs, content });
      }
    }
    matches.sort((a, b) => b.mtime - a.mtime);

    return matches.slice(0, limit).map(({ file, content }) => this.toMemory(file, content, { preview: true }));
  }

  /** Add a freeform note. Returns its slug (used as the memory id). */
  async addContext(text: string, metadata?: Record<string, unknown>): Promise<string> {
    const slug = this.slugFor(`${text.slice(0, 40)}-${crypto.randomUUID()}`);
    const file = this.notePath(slug);
    const now = new Date().toISOString();

    const frontmatter = serializeFrontmatter({
      kind: "note",
      createdAt: now,
      ...(metadata ?? {}),
    });
    fs.writeFileSync(file, `${frontmatter}\n\n${text}\n`, "utf-8");
    return slug;
  }

  /** Delete a stored key's note, if it exists. Returns whether anything was removed. */
  async forget(key: string): Promise<boolean> {
    const file = this.notePath(this.slugFor(key));
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  /**
   * Delete every note whose key starts with the given prefix (e.g. clearing
   * stale `refdoc-*` entries before a re-ingest, or pruning high-churn
   * `tool.cache.*`/`tool.result.*`/`analytics.*` keys on a schedule).
   * With `updatedBefore`, only notes last written before that time are removed.
   * Returns how many were removed.
   */
  async forgetByKeyPrefix(prefix: string, updatedBefore?: Date): Promise<number> {
    let removed = 0;
    for (const file of listMarkdownFiles(this.notesDir)) {
      const frontmatter = readFrontmatter(fs.readFileSync(file, "utf-8"));
      const key = frontmatter.key;
      if (typeof key !== "string" || !key.startsWith(prefix)) continue;
      if (updatedBefore) {
        const updatedAt = frontmatter.updatedAt ? new Date(String(frontmatter.updatedAt)) : new Date(fs.statSync(file).mtimeMs);
        if (updatedAt >= updatedBefore) continue;
      }
      fs.unlinkSync(file);
      removed++;
    }
    return removed;
  }

  /** Count notes whose key starts with the given prefix. */
  async countByKeyPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const file of listMarkdownFiles(this.notesDir)) {
      const key = readFrontmatter(fs.readFileSync(file, "utf-8")).key;
      if (typeof key === "string" && key.startsWith(prefix)) count++;
    }
    return count;
  }

  /** Most recently modified notes. */
  async getRecent(limit: number = 10): Promise<Memory[]> {
    const files = listMarkdownFiles(this.notesDir)
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    return files.map(({ file }) => this.toMemory(file, fs.readFileSync(file, "utf-8")));
  }

  private toMemory(file: string, content: string, opts: { preview?: boolean } = {}): Memory {
    const { frontmatter, body } = splitFrontmatter(content);
    const slug = path.basename(file, ".md");
    const stat = fs.statSync(file);
    const isKv = frontmatter.kind === "kv";

    return {
      id: slug,
      key: typeof frontmatter.key === "string" ? frontmatter.key : undefined,
      value: opts.preview ? content.slice(0, 4000) : isKv ? extractJsonBlock(content) : { text: body.trim() },
      text: isKv ? undefined : body.trim(),
      metadata: frontmatter,
      createdAt: frontmatter.createdAt ? new Date(String(frontmatter.createdAt)) : new Date(stat.birthtimeMs),
      updatedAt: frontmatter.updatedAt ? new Date(String(frontmatter.updatedAt)) : new Date(stat.mtimeMs),
    };
  }

  // ── Conversations (per-duty append-only transcript) ─────────────────────

  private conversationPath(dutyName: string): string {
    return path.join(this.conversationsDir, `${slugify(dutyName)}.md`);
  }

  /** Append one turn to a duty's conversation transcript. Returns the entry's timestamp as an id. */
  async addConversation(
    dutyName: string,
    role: "system" | "user" | "assistant",
    content: string,
  ): Promise<string> {
    const now = new Date().toISOString();
    const file = this.conversationPath(dutyName);
    const prefix = fs.existsSync(file) ? "\n" : "";
    fs.appendFileSync(file, `${prefix}### ${role} — ${now}\n${content}\n`, "utf-8");
    return now;
  }

  /** Read back a duty's conversation transcript, oldest-to-newest, tail-limited. */
  async getConversations(dutyName: string, limit: number = 50): Promise<ConversationEntry[]> {
    const file = this.conversationPath(dutyName);
    if (!fs.existsSync(file)) return [];

    const content = fs.readFileSync(file, "utf-8");
    const entries: ConversationEntry[] = [];
    const blockRe = /^### (\S+) — (.+)$/gm;
    const matches = [...content.matchAll(blockRe)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (!match) continue;
      const role = match[1] ?? "";
      const timestamp = match[2] ?? "";
      const header = match[0] ?? "";
      const start = (match.index ?? 0) + header.length + 1;
      const next = matches[i + 1];
      const end = next ? (next.index ?? content.length) : content.length;
      entries.push({
        role,
        content: content.slice(start, end).trim(),
        createdAt: new Date(timestamp),
      });
    }

    return entries.slice(-limit);
  }

  // ── Blackboards (per-duty scratch state) ─────────────────────────────────

  private blackboardPath(dutyName: string): string {
    return path.join(this.blackboardsDir, `${slugify(dutyName)}.md`);
  }

  /** Read a duty's blackboard. Empty string if it has never written one. */
  async getBlackboard(dutyName: string): Promise<string> {
    const file = this.blackboardPath(dutyName);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  }

  /** Overwrite a duty's blackboard entirely. */
  async setBlackboard(dutyName: string, content: string): Promise<void> {
    fs.writeFileSync(this.blackboardPath(dutyName), content, "utf-8");
  }

  /** Append to a duty's blackboard without disturbing what's already there. */
  async appendBlackboard(dutyName: string, content: string): Promise<void> {
    const file = this.blackboardPath(dutyName);
    const prefix = fs.existsSync(file) && fs.statSync(file).size > 0 ? "\n" : "";
    fs.appendFileSync(file, `${prefix}${content}`, "utf-8");
  }

  close(): void {
    // No connection to close — kept as a no-op for API parity with callers
    // that shut down the old SQLite-backed store.
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note"
  );
}

// ── Frontmatter helpers ─────────────────────────────────────────────────

function serializeFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, unknown> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    try {
      frontmatter[key] = JSON.parse(rawValue);
    } catch {
      frontmatter[key] = rawValue;
    }
  }
  return { frontmatter, body: content.slice(match[0].length) };
}

function readFrontmatter(content: string): Record<string, unknown> {
  return splitFrontmatter(content).frontmatter;
}

function extractJsonBlock(content: string): unknown {
  const match = content.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f));
}

/** Parse `[[wikilink]]` references out of a note body — the sole mechanism
 *  for representing relationships between notes (no edge table, no graph
 *  traversal API). Same pattern as plugins/obsidian.ts's extractWikilinks. */
export function extractRelated(content: string): string[] {
  const re = /\[\[([^\[\]]+)\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const link = (match[1] ?? "").split("|")[0]?.trim() ?? "";
    if (link && !links.includes(link)) links.push(link);
  }
  return links;
}
