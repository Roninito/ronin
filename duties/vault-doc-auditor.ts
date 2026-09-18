/**
 * Vault Doc Auditor
 *
 * Runs daily against the Ronin documentation living in the configured
 * Obsidian vault (`memory.vaultPath`'s parent folder) to catch the kind of
 * drift that piled up silently before the 2026-09-17 cleanup — docs quoting
 * renamed classes, deleted subsystems, or file paths that no longer exist.
 *
 * What it does each run, cheapest first:
 *   1. Scans every in-scope vault doc for a fixed list of known-legacy terms
 *      and for inline code spans that look like repo file paths, checking
 *      those paths actually exist. Both checks are deterministic — no AI
 *      call, no false positives from a model guessing.
 *   2. Removes exact-duplicate files (byte-identical content) automatically.
 *      This is the only autonomous deletion here, because it's the only one
 *      that's provably lossless — everything else gets flagged, not fixed.
 *   3. Sends a small rotating batch of files (a few per day, tracked on this
 *      duty's blackboard) through one AI sanity-check call each, so the
 *      whole vault gets an LLM pass every few days without a daily cost
 *      spike.
 *   4. Any file with new deterministic flags gets a visible, self-contained
 *      callout inserted at its top (removed again once the flags clear).
 *      Nothing else about the file is touched — no rewriting prose.
 *   5. Rebuilds one "Documentation Audit.md" index note at the vault root
 *      summarizing every scanned file's current status.
 *
 * Known limitation, worth restating: KNOWN_LEGACY_TERMS and the AI
 * sanity-check's "current facts" briefing are both a frozen snapshot of what
 * was true on 2026-09-17. Neither re-verifies against the live repo the way
 * a human pass (or an LLM with real grep/read access) would — they'll drift
 * themselves as the codebase moves on, and expect an occasional manual
 * refresh rather than being treated as permanently authoritative.
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Vault subfolders that are actually Ronin documentation. Deliberately an
// allowlist, not a denylist: folders like "copilot/", "Prompts/", "OPTTSP/",
// and the vault's own "memory/" (Ronin's own store) are excluded by simply
// never being named here.
const DOC_SUBFOLDERS = [
  "new flow",
  "old but still useful",
  "The Kata Architecture",
  "Rag+LangChain Cleanup and SAR Integraton",
];

const INDEX_NOTE_NAME = "Documentation Audit.md";

// Files that already carry a manually-written, dated "historical" caveat —
// skip auto-flagging these. Re-flagging a doc that already explains it's a
// deliberately-kept historical record would just be noise on top of context
// a human already wrote by hand.
const SKIP_CALLOUT_FILES = new Set([
  "Seals.md",
  "Yoriki.md",
  "SAR_vs_LANGCHAIN_DECISION.md",
  "ARCHITECTURE_REFACTORING_COMPLETE.md",
]);

const KNOWN_LEGACY_TERMS: Array<{ pattern: RegExp; note: string }> = [
  { pattern: /\bBaseAgent\b/, note: "`BaseAgent` is gone — the real base class is `BaseDuty`" },
  { pattern: /\bAgentAPI\b/, note: "`AgentAPI` is gone — the real type is `DutyAPI`" },
  { pattern: /@ronin\/agent/, note: "`@ronin/agent` package alias doesn't exist — plugins import via plain relative paths" },
  { pattern: /@ronin\/plugins/, note: "`@ronin/plugins` package alias doesn't exist — plugins import via plain relative paths" },
  { pattern: /\bapi\.ontology\b/, note: "the ontology knowledge-graph API was removed 2026-09-04" },
  { pattern: /\bapi\.rag\b/, note: "the RAG plugin/API was removed" },
  { pattern: /\bgetByMetadata\b/, note: "`MemoryStore` has no `getByMetadata` method" },
  { pattern: /\bregisterWorkflow\b|\bexecuteWorkflow\b/, note: "no Workflow Engine exists in the codebase — likely superseded by Kata" },
  { pattern: /--agent-dir\b/, note: "the real CLI flag is `--duty-dir`" },
  { pattern: /\bContractRunner\b|\bContractParser\b|\bReportBuilder\b/, note: "not present anywhere in the repo — this spec was never implemented" },
  { pattern: /`agents\/[\w.-]+`/, note: "references a file under `agents/` — that directory was renamed to `duties/`" },
];

// Inline-code spans that look like a repo-relative source path, e.g.
// `src/memory/Memory.ts` or `duties/schedule-manager.ts`.
const PATH_SPAN_RE = /`((?:src|duties|plugins|packages)\/[\w./-]+\.(?:ts|tsx|js))`/g;

// A path containing one of these is almost certainly an illustrative example
// in "here's how you'd create a plugin" prose, not a claim that a specific
// file exists — skip the dead-path check for these rather than flag every
// tutorial snippet in the vault.
const PLACEHOLDER_PATH_RE = /\b(my-plugin|my-agent|my-duty|your-plugin|example-plugin|placeholder|foo|bar)\b/i;

// A legacy-term match on a line containing one of these is almost certainly
// the doc correctly explaining that the term is gone, not using it as if
// current — e.g. "BaseAgent is gone", "there is no api.ontology".
// Note: "n't" is matched as a bare substring, not `\bn't\b` — a word boundary
// never occurs right before "n" inside a contraction ("doesn't", "isn't"),
// so the bounded form would silently never match the most common negation.
const NEGATION_CUE_RE = /\b(no|not|never|gone|removed|deleted|without|nonexistent|neither)\b|n't/i;

interface FileState {
  hash: string;
  flags: string[];
  lastChecked: string;
  lastAiNote?: string;
}

interface AuditorState {
  cursor: number;
  files: Record<string, FileState>;
}

interface ScannedFile {
  absPath: string;
  relPath: string;
  content: string;
  hash: string;
  flags: string[];
}

export default class VaultDocAuditorDuty extends BaseDuty {
  // Run daily at 4 AM — after codebase-analyzer (1 AM) and obsidian-vault-indexer (2 AM).
  static schedule = "0 4 * * *";

  private readonly repoRoot = process.cwd();
  private readonly aiBatchSize = 5;

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      const vaultPath = this.getVaultPath();
      if (!vaultPath) {
        console.warn("[vault-doc-auditor] memory.vaultPath is not configured — skipping.");
        return;
      }

      const files = await this.scanVault(vaultPath);
      if (files.length === 0) {
        console.log("[vault-doc-auditor] No documentation files found to audit.");
        return;
      }

      const removedDuplicates = await this.removeExactDuplicates(files);
      const remaining = files.filter((f) => !removedDuplicates.has(f.absPath));

      const state = await this.loadState();
      const batch = this.pickNextBatch(remaining, state);
      await this.runAiSanityChecks(batch, state);

      let flaggedNew = 0;
      let cleared = 0;
      for (const file of remaining) {
        const prev = state.files[file.relPath];
        const wasFlagged = !!prev && prev.flags.length > 0;
        const nowFlagged = file.flags.length > 0;
        if (!SKIP_CALLOUT_FILES.has(path.basename(file.absPath))) {
          if (nowFlagged) {
            await this.upsertCallout(file);
            if (!wasFlagged) flaggedNew++;
          } else if (wasFlagged) {
            await this.removeCallout(file);
            cleared++;
          }
        }
        state.files[file.relPath] = {
          hash: file.hash,
          flags: file.flags,
          lastChecked: prev?.lastChecked ?? new Date().toISOString(),
          lastAiNote: prev?.lastAiNote,
        };
      }

      await this.writeIndexNote(vaultPath, remaining, state);
      await this.saveState(state);

      console.log(
        `[vault-doc-auditor] Scanned ${files.length} files — ${removedDuplicates.size} exact duplicates removed, ` +
          `${flaggedNew} newly flagged, ${cleared} cleared, ${batch.length} sent through an AI sanity check.`
      );
    } catch (error) {
      console.error("[vault-doc-auditor] Error:", error);
    }
  }

  private getVaultPath(): string | null {
    const memoryVaultPath = this.api.config.get<string | undefined>("memory.vaultPath");
    return memoryVaultPath ? path.dirname(memoryVaultPath) : null;
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  private async scanVault(vaultPath: string): Promise<ScannedFile[]> {
    const obsidian = this.api.plugins;
    if (!obsidian.has("obsidian")) {
      console.warn("[vault-doc-auditor] obsidian plugin not available — skipping.");
      return [];
    }

    const rootFiles = ((await obsidian.call("obsidian", "listFilesInDir", vaultPath)) as string[]) || [];
    const subfolderFiles: string[] = [];
    for (const folder of DOC_SUBFOLDERS) {
      const notes = ((await obsidian.call("obsidian", "listNotes", vaultPath, [folder], true)) as string[]) || [];
      subfolderFiles.push(...notes);
    }

    const allPaths = [...rootFiles, ...subfolderFiles].filter(
      (p) => path.basename(p) !== INDEX_NOTE_NAME
    );

    const scanned: ScannedFile[] = [];
    for (const absPath of allPaths) {
      let content: string;
      try {
        content = fs.readFileSync(absPath, "utf-8");
      } catch {
        continue;
      }
      const relPath = path.relative(vaultPath, absPath);
      const hash = crypto.createHash("sha1").update(content).digest("hex");
      const flags = this.detectFlags(content);
      scanned.push({ absPath, relPath, content, hash, flags });
    }
    return scanned.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  private detectFlags(content: string): string[] {
    const flags: string[] = [];

    // Check line-by-line so a legacy term mentioned *while explaining it's
    // gone* ("BaseAgent is gone", "there is no api.ontology") doesn't get
    // flagged as if the doc were using it as current. A doc correctly
    // documenting its own history shouldn't trip its own staleness check.
    const lines = content.split("\n");
    for (const { pattern, note } of KNOWN_LEGACY_TERMS) {
      const hit = lines.some((line) => pattern.test(line) && !NEGATION_CUE_RE.test(line));
      if (hit) flags.push(note);
    }

    const seenPaths = new Set<string>();
    for (const match of content.matchAll(PATH_SPAN_RE)) {
      const refPath = match[1];
      if (!refPath || seenPaths.has(refPath)) continue;
      seenPaths.add(refPath);
      if (PLACEHOLDER_PATH_RE.test(refPath)) continue; // illustrative example path, not a real claim
      if (!fs.existsSync(path.join(this.repoRoot, refPath))) {
        flags.push(`references \`${refPath}\`, which doesn't exist in the repo`);
      }
    }

    return flags;
  }

  // ── Exact-duplicate removal (the one safe autonomous fix) ────────────────

  private async removeExactDuplicates(files: ScannedFile[]): Promise<Set<string>> {
    const byHash = new Map<string, ScannedFile[]>();
    for (const file of files) {
      const group = byHash.get(file.hash) ?? [];
      group.push(file);
      byHash.set(file.hash, group);
    }

    const removed = new Set<string>();
    for (const group of byHash.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.relPath.localeCompare(b.relPath));
      const keep = sorted[0]!;
      for (const dup of sorted.slice(1)) {
        const ok = (await this.api.plugins.call("obsidian", "deleteNote", dup.absPath)) as boolean;
        if (ok) {
          removed.add(dup.absPath);
          console.log(`[vault-doc-auditor] Removed exact duplicate "${dup.relPath}" (identical to "${keep.relPath}")`);
        }
      }
    }
    return removed;
  }

  // ── Bounded AI sanity check (rotates through the vault a few files/day) ──

  private pickNextBatch(files: ScannedFile[], state: AuditorState): ScannedFile[] {
    if (files.length === 0) return [];
    const start = state.cursor % files.length;
    const batch: ScannedFile[] = [];
    for (let i = 0; i < Math.min(this.aiBatchSize, files.length); i++) {
      batch.push(files[(start + i) % files.length]!);
    }
    state.cursor = (start + batch.length) % files.length;
    return batch;
  }

  private async runAiSanityChecks(batch: ScannedFile[], state: AuditorState): Promise<void> {
    const briefing = [
      "Current Ronin architecture facts (2026-09-17):",
      "- Agents are called duties. `BaseDuty`/`DutyAPI` from `src/duty/`, files live in `duties/` (not `agents/`).",
      "- Memory is a plain-markdown MemoryStore (`src/memory/Memory.ts`) living inside the Obsidian vault at `<vault>/memory/`, written through `plugins/obsidian.ts`. No SQLite, no ontology graph (removed 2026-09-04), no RAG.",
      "- Kata (`src/kata/`), Contract (`src/contract/`), and Task (`src/task/`) subsystems are real and current.",
      "- There is no \"Techniques\" DSL/CLI/registry layer, no \"Yoriki\" or \"Seal\" execution model — these were designed but never built.",
    ].join("\n");

    for (const file of batch) {
      try {
        const prompt =
          `${briefing}\n\nDoes the following documentation excerpt (from "${file.relPath}") contradict any of the ` +
          `facts above? Answer in one sentence. If it's consistent, say "Consistent." and nothing else.\n\n---\n` +
          `${file.content.slice(0, 6000)}`;
        const answer = await this.api.ai.complete(prompt, {
          model: "smart",
          temperature: 0.1,
          timeoutMs: 20000,
          retries: 0,
        });
        const note = answer.trim();
        if (note && !/^consistent\.?$/i.test(note)) {
          file.flags.push(`AI sanity check: ${note}`);
        }
        const existing = state.files[file.relPath];
        state.files[file.relPath] = {
          hash: file.hash,
          flags: file.flags,
          lastChecked: new Date().toISOString(),
          lastAiNote: note,
        };
        void existing;
      } catch (error) {
        console.warn(`[vault-doc-auditor] AI sanity check failed for "${file.relPath}":`, error);
      }
    }
  }

  // ── Callout insertion/removal (non-destructive, self-contained) ──────────

  private async upsertCallout(file: ScannedFile): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const body = file.flags.map((f) => `> - ${f}`).join("\n");
    const callout =
      `<!-- vault-doc-auditor:start -->\n` +
      `> 🔎 **Auto-flagged by vault-doc-auditor — ${today}.** Possibly stale:\n` +
      `${body}\n` +
      `>\n> Review recommended — see "${INDEX_NOTE_NAME}" for the full picture.\n` +
      `<!-- vault-doc-auditor:end -->\n\n`;

    const stripped = this.stripCallout(file.content);
    const updated = callout + stripped;
    if (updated !== file.content) {
      await this.api.plugins.call("obsidian", "writeNote", file.absPath, updated);
    }
  }

  private async removeCallout(file: ScannedFile): Promise<void> {
    const stripped = this.stripCallout(file.content);
    if (stripped !== file.content) {
      await this.api.plugins.call("obsidian", "writeNote", file.absPath, stripped);
    }
  }

  private stripCallout(content: string): string {
    return content
      .replace(/<!-- vault-doc-auditor:start -->[\s\S]*?<!-- vault-doc-auditor:end -->\n*/, "")
      .replace(/^\s+/, "");
  }

  // ── Index note ────────────────────────────────────────────────────────────

  private async writeIndexNote(vaultPath: string, files: ScannedFile[], state: AuditorState): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const rows = files
      .map((f) => {
        const status = f.flags.length === 0 ? "✅ clean" : `⚠️ ${f.flags.length} flag${f.flags.length === 1 ? "" : "s"}`;
        const lastChecked = state.files[f.relPath]?.lastChecked?.slice(0, 10) ?? today;
        return `| \`${f.relPath}\` | ${status} | ${lastChecked} |`;
      })
      .join("\n");

    const flaggedDetail = files
      .filter((f) => f.flags.length > 0)
      .map((f) => `### \`${f.relPath}\`\n${f.flags.map((flag) => `- ${flag}`).join("\n")}`)
      .join("\n\n");

    const content =
      `# Documentation Audit\n\n` +
      `Auto-generated by \`vault-doc-auditor\` — last run ${today}. This file is regenerated in full every run; don't hand-edit it.\n\n` +
      `${files.length} files scanned, ${files.filter((f) => f.flags.length === 0).length} clean, ` +
      `${files.filter((f) => f.flags.length > 0).length} flagged.\n\n` +
      `| File | Status | Last checked |\n|---|---|---|\n${rows}\n\n` +
      (flaggedDetail ? `## Flag detail\n\n${flaggedDetail}\n` : "");

    await this.api.plugins.call("obsidian", "writeNote", path.join(vaultPath, INDEX_NOTE_NAME), content);
  }

  // ── State (rotation cursor + per-file history) ────────────────────────────

  private async loadState(): Promise<AuditorState> {
    const raw = await this.api.memory.getBlackboard("vault-doc-auditor");
    if (!raw.trim()) return { cursor: 0, files: {} };
    try {
      const parsed = JSON.parse(raw) as AuditorState;
      return { cursor: parsed.cursor ?? 0, files: parsed.files ?? {} };
    } catch {
      return { cursor: 0, files: {} };
    }
  }

  private async saveState(state: AuditorState): Promise<void> {
    await this.api.memory.setBlackboard("vault-doc-auditor", JSON.stringify(state, null, 2));
  }
}
