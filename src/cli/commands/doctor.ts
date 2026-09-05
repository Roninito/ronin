/**
 * ronin doctor
 *
 * Health-check command that validates the Ronin installation:
 *   - Ollama connectivity
 *   - Configured model availability
 *   - API keys for cloud providers
 *   - Config file syntax and location
 *   - Source of each value (env / file / default)
 *
 * ronin doctor ingest-docs
 *
 * Syncs reference docs, tools, and skills into memory/notes/ (as
 * refdoc-, tool-, and skill-prefixed entries) so agents can discover them
 * via local.memory.search.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getConfigService } from "../../config/ConfigService.js";
import type { AIProviderType } from "../../config/types.js";
import { createAPI } from "../../api/index.js";

interface CheckResult {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export async function doctorCommand(): Promise<void> {
  console.log("\nRonin Doctor\n");

  const configService = getConfigService();
  await configService.load();
  const config = configService.getAll();
  const results: CheckResult[] = [];

  // ── 1. Config file ───────────────────────────────────────────────────
  const configPath = configService.getConfigPath();
  if (existsSync(configPath)) {
    results.push({ label: "Config file", status: "ok", detail: configPath });
  } else {
    results.push({ label: "Config file", status: "warn", detail: `Not found at ${configPath} (using defaults)` });
  }

  // ── 2. AI provider ──────────────────────────────────────────────────
  const provider = config.ai.provider;
  const providerSource = configService.isFromEnv("ai.provider") ? "env" : "config/default";
  results.push({
    label: "AI provider",
    status: "ok",
    detail: `${provider} (source: ${providerSource})`,
  });

  // ── 3. Ollama connectivity ──────────────────────────────────────────
  if (provider === "ollama" || config.ai.fallback?.chain?.includes("ollama")) {
    const ollamaUrl = config.ai.ollamaUrl;
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const modelCount = (data.models || []).length;
        results.push({ label: "Ollama connection", status: "ok", detail: `${ollamaUrl} (${modelCount} models available)` });

        // Check if configured model exists
        const targetModel = config.ai.ollamaModel;
        const models = (data.models || []).map((m: { name: string }) => m.name);
        const found = models.some((m: string) => m === targetModel || m.startsWith(`${targetModel}:`));
        if (found) {
          results.push({ label: "Default model", status: "ok", detail: targetModel });
        } else {
          results.push({
            label: "Default model",
            status: "fail",
            detail: `"${targetModel}" not found. Run: ollama pull ${targetModel}`,
          });
        }

        // Check model tier slots
        if (config.ai.models) {
          for (const [tier, modelName] of Object.entries(config.ai.models)) {
            if (tier === "embedding") continue;
            const tierFound = models.some((m: string) => m === modelName || m.startsWith(`${modelName}:`));
            if (!tierFound) {
              results.push({
                label: `Model tier "${tier}"`,
                status: "warn",
                detail: `"${modelName}" not found locally. Run: ollama pull ${modelName}`,
              });
            }
          }
        }
      } else {
        results.push({ label: "Ollama connection", status: "fail", detail: `${ollamaUrl} returned ${res.status}` });
      }
    } catch (err) {
      results.push({
        label: "Ollama connection",
        status: "fail",
        detail: `Cannot reach ${ollamaUrl} — ${(err as Error).message}`,
      });
    }
  }

  // ── 4. Cloud provider API keys ──────────────────────────────────────
  const cloudChecks: Array<{ name: AIProviderType; key: string; source: string }> = [
    { name: "openai", key: config.ai.openai?.apiKey || "", source: "ai.openai.apiKey" },
    { name: "gemini", key: config.gemini?.apiKey || "", source: "gemini.apiKey" },
    { name: "grok", key: config.grok?.apiKey || "", source: "grok.apiKey" },
  ];

  for (const check of cloudChecks) {
    const isActive = provider === check.name || config.ai.fallback?.chain?.includes(check.name);
    if (isActive) {
      if (check.key) {
        const masked = check.key.slice(0, 4) + "..." + check.key.slice(-2);
        results.push({ label: `${check.name} API key`, status: "ok", detail: `Set (${masked})` });
      } else {
        results.push({
          label: `${check.name} API key`,
          status: "fail",
          detail: `Missing! Set via: ronin config set ${check.source} <key>`,
        });
      }
    } else if (check.key) {
      results.push({ label: `${check.name} API key`, status: "ok", detail: "Configured (not active provider)" });
    }
  }

  // ── 5. Fallback chain ───────────────────────────────────────────────
  if (config.ai.fallback?.enabled) {
    const chain = config.ai.fallback.chain;
    results.push({
      label: "Fallback chain",
      status: chain.length > 0 ? "ok" : "warn",
      detail: chain.length > 0 ? chain.join(" -> ") : "Enabled but empty",
    });
  }

  // ── 6. Temperature & timeout ────────────────────────────────────────
  results.push({
    label: "Temperature",
    status: "ok",
    detail: `${config.ai.temperature}`,
  });

  results.push({
    label: "Timeout",
    status: "ok",
    detail: `${config.ai.ollamaTimeoutMs}ms (${(config.ai.ollamaTimeoutMs / 1000).toFixed(0)}s)`,
  });

  // ── 7. Plugin directory ─────────────────────────────────────────────
  const pluginDir = config.system.userPluginDir;
  if (existsSync(pluginDir)) {
    results.push({ label: "Plugin directory", status: "ok", detail: pluginDir });
  } else {
    results.push({ label: "Plugin directory", status: "warn", detail: `${pluginDir} (does not exist yet)` });
  }

  // ── Output ──────────────────────────────────────────────────────────
  const statusIcons = { ok: "✅", warn: "⚠️ ", fail: "❌" };
  let failCount = 0;
  let warnCount = 0;

  for (const r of results) {
    console.log(`  ${statusIcons[r.status]} ${r.label}: ${r.detail}`);
    if (r.status === "fail") failCount++;
    if (r.status === "warn") warnCount++;
  }

  // Sync "how to list all skills/tools" reference notes so agents can discover them
  try {
    const system = config.system as { userPluginDir?: string; pluginDir?: string };
    const dbPath = (config as { dbPath?: string }).dbPath;
    const api = await createAPI({
      pluginDir: join(process.cwd(), "plugins"),
      userPluginDir: system?.userPluginDir,
      dbPath,
    });
    await syncListCapabilities(api);
    console.log("  ✅ List-all capability notes (skills, tools) synced");
  } catch (e) {
    // Non-fatal
  }

  console.log("");
  if (failCount > 0) {
    console.log(`${failCount} issue(s) found. Fix them and run "ronin doctor" again.`);
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`All good with ${warnCount} warning(s).`);
  } else {
    console.log("Everything looks good!");
  }
}

/**
 * Write "how do I list all skills/tools" reference notes into memory, so
 * agents can find them via local.memory.search.
 */
export async function syncListCapabilities(api: {
  memory: { store: (key: string, value: unknown) => Promise<void> };
}): Promise<void> {
  await api.memory.store("refdoc-list-all-skills", {
    name: "List all skills",
    summary:
      "To retrieve the list of installed AgentSkills, call skills.list (returns array of { name, description }) or skills.run with query \"\" and action 'list all skills'. Skills live in ~/.ronin/skills and ./skills.",
  });
  await api.memory.store("refdoc-list-all-tools", {
    name: "List all tools",
    summary:
      "Every registered tool is indexed as a memory note (tool-<name>) by the tools-indexer duty. Use local.memory.search to find one, or inspect the tools available to the current agent directly.",
  });
}

/**
 * Write MessagingPlatform reference notes (Telegram, Discord, etc.) from
 * config, and a short note on how memory is laid out.
 */
export async function syncMessagingPlatforms(
  api: { memory: { store: (key: string, value: unknown) => Promise<void> } },
  config: { telegram?: { botToken?: string }; discord?: { enabled?: boolean; botToken?: string } }
): Promise<void> {
  if (config.telegram?.botToken) {
    await api.memory.store("messaging-platform-telegram", {
      name: "Telegram",
      summary: "Telegram messaging; chatId from config or from incoming event (e.g. create-skill, refactor-request). Use SendTelegramMessage event with chatId to reply.",
    });
  }
  if (config.discord?.enabled && config.discord?.botToken) {
    await api.memory.store("messaging-platform-discord", {
      name: "Discord",
      summary: "Discord messaging; channelIds from config. Use sourceChannel when emitting events so agents can reply to the right channel.",
    });
  }

  await api.memory.store("refdoc-memory-self-reflection", {
    name: "Memory layout and note types",
    summary:
      "Memory lives under memory/ as plain markdown: memory/notes/ (refdoc-*, tool-*, skill-*, messaging-platform-*, and freeform entries), memory/conversations/<duty>.md (per-duty transcripts), memory/blackboards/<duty>.md (per-duty scratch state). Find things with local.memory.search. Do not store passwords in memory notes; use config/secrets instead. Relationships between notes are plain [[wikilink]] references, not a graph.",
  });
}

const REFERENCE_DOC_PATHS: string[] = [
  "docs/RONIN_SCRIPT.md",
  "docs/PLUGINS.md",
  "docs/SKILLS.md",
  "AGENTS.md",
  "docs/CLI.md",
];

function slugFromPath(path: string): string {
  return path.replace(/\.md$/, "").replace(/\//g, "-").replace(/^-/, "");
}

/**
 * Ingest reference docs, tools, and skills into memory/notes/.
 */
export async function doctorIngestDocsCommand(options: { clean?: boolean } = {}): Promise<void> {
  console.log(`\nRonin Doctor: Ingest docs, tools, and skills into memory${options.clean ? " (clean mode)" : ""}\n`);

  const configService = getConfigService();
  await configService.load();
  const config = configService.getAll();
  const system = config.system as { userPluginDir?: string; pluginDir?: string };
  const dbPath = (config as { dbPath?: string }).dbPath;

  const api = await createAPI({
    pluginDir: system?.pluginDir ?? join(process.cwd(), "plugins"),
    userPluginDir: system?.userPluginDir,
    dbPath,
  });

  const cwd = process.cwd();
  let docCount = 0;
  let toolCount = 0;
  let skillCount = 0;

  if (options.clean) {
    try {
      const removed = await api.memory.forgetByKeyPrefix("refdoc-");
      if (!process.env.RONIN_QUIET) console.log(`  🧹 Cleaned ${removed} refdoc notes`);
    } catch (err) {
      console.warn(`  ⚠️ Clean mode skipped: ${(err as Error).message}`);
    }
  }

  const docsFromDisk: string[] = [];
  const collectDocs = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectDocs(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".md") || entry.name.endsWith(".html")) {
        if (statSync(full).size <= 1_500_000) {
          docsFromDisk.push(full);
        }
      }
    }
  };
  collectDocs(join(cwd, "docs"));
  const referenceSet = new Set(
    REFERENCE_DOC_PATHS.map((p) => join(cwd, p))
  );
  for (const fullPath of docsFromDisk) referenceSet.add(fullPath);

  const ingestedPaths: string[] = [];
  for (const absolutePath of referenceSet) {
    const relPath = absolutePath.startsWith(cwd) ? absolutePath.slice(cwd.length + 1) : absolutePath;
    if (!existsSync(absolutePath)) continue;
    try {
      const content = readFileSync(absolutePath, "utf-8");
      const slug = slugFromPath(relPath);
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? relPath;
      const summary = content.slice(0, 300).replace(/\n/g, " ").trim();
      await api.memory.store(`refdoc-${slug}`, { name: title, summary, sourcePath: relPath, content });
      ingestedPaths.push(relPath);
      docCount++;
      if (!process.env.RONIN_QUIET) console.log(`  ✅ ${relPath} → refdoc-${slug}`);
    } catch (err) {
      console.warn(`  ⚠️ ${relPath}: ${(err as Error).message}`);
    }
  }
  await api.memory.store("refdoc-index", { updatedAt: Date.now(), paths: ingestedPaths });

  if (api.tools) {
    const tools = api.tools.list();
    for (const tool of tools) {
      await api.memory.store(`tool-${tool.name}`, {
        name: tool.name,
        summary: (tool.description ?? "").slice(0, 500),
      });
      toolCount++;
    }
    if (!process.env.RONIN_QUIET) console.log(`  ✅ ${toolCount} tools → memory`);
  }

  if (api.plugins?.has("skills")) {
    let skills: Array<{ name: string; description?: string }> = [];
    try {
      skills = (await api.plugins.call("skills", "discover_skills", "")) as Array<{ name: string; description?: string }>;
    } catch (err) {
      console.warn("  ⚠️ Skills plugin discover_skills failed:", (err as Error).message);
    }
    // Fallback: scan skills dirs directly when the plugin returns empty
    if (!Array.isArray(skills) || skills.length === 0) {
      const skillsDirs: string[] = [];
      const sys = config.system as { skillsDir?: string };
      const userDir = sys?.skillsDir ?? join(homedir(), ".ronin", "skills");
      if (existsSync(userDir)) skillsDirs.push(userDir);
      const projDir = join(cwd, "skills");
      if (existsSync(projDir) && projDir !== userDir) skillsDirs.push(projDir);
      for (const dir of skillsDirs) {
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const skillMd = join(dir, entry.name, "skill.md");
            const skillMdAlt = join(dir, entry.name, "SKILL.md");
            const mdPath = existsSync(skillMd) ? skillMd : existsSync(skillMdAlt) ? skillMdAlt : null;
            if (!mdPath) continue;
            const content = readFileSync(mdPath, "utf-8");
            const nameMatch = content.match(/name:\s*(.+)/);
            const descMatch = content.match(/description:\s*(.+)/);
            const name = (nameMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "") || entry.name;
            const desc = (descMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
            skills.push({ name, description: desc });
          }
        } catch {
          // ignore per-dir errors
        }
      }
    }
    if (Array.isArray(skills)) {
      for (const s of skills) {
        const name = typeof s === "object" && s?.name ? s.name : String(s);
        const desc = typeof s === "object" && s?.description ? s.description : "";
        await api.memory.store(`skill-${name}`, { name, summary: desc.slice(0, 500) });
        skillCount++;
      }
      if (!process.env.RONIN_QUIET) console.log(`  ✅ ${skillCount} skills → memory`);
    }
  }

  await syncListCapabilities(api);
  if (!process.env.RONIN_QUIET) console.log("  ✅ List-all capability notes (skills, tools) → memory");

  await syncMessagingPlatforms(api, config);
  if (!process.env.RONIN_QUIET) console.log("  ✅ MessagingPlatform notes → memory");

  console.log("");
  console.log(`Ingested: ${docCount} reference docs, ${toolCount} tools, ${skillCount} skills.`);
  console.log("Use local.memory.search to discover them (refdoc-*, tool-*, skill-* keys).");
}
