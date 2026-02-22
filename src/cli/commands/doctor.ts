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
 * Syncs reference docs, tools, and skills into the ontology and memory
 * so agents can discover them via ontology_search (types ReferenceDoc, Tool, Skill).
 * Also syncs list-all capability nodes (skills, tools) with edges to the right tools.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
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

  // Sync list-all capability nodes (skills, tools) so the graph is discoverable
  try {
    const system = config.system as { userPluginDir?: string; pluginDir?: string };
    const dbPath = (config as { dbPath?: string }).dbPath;
    const api = await createAPI({
      pluginDir: join(process.cwd(), "plugins"),
      userPluginDir: system?.userPluginDir,
      dbPath,
    });
    await syncListCapabilities(api);
    console.log("  ✅ Ontology list-all capabilities (skills, tools) synced");
  } catch (e) {
    // Non-fatal: ontology may be unavailable
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

const LIST_ALL_SKILLS_NODE_ID = "ReferenceDoc-ListAllSkills";
const LIST_ALL_TOOLS_NODE_ID = "ReferenceDoc-ListAllTools";
const TOOL_SKILLS_RUN_ID = "Tool-skills-run";
const TOOL_SKILLS_LIST_ID = "Tool-skills-list";
const TOOL_ONTOLOGY_SEARCH_ID = "Tool-ontology-search";

/**
 * Sync "list all skills" and "list all tools" capability nodes and edges into the ontology
 * so agents find them via ontology_search (type ReferenceDoc or nameLike "list") and
 * traverse to the right tool via ontology_related.
 */
export async function syncListCapabilities(api: {
  ontology?: {
    setNode: (node: { id: string; type: string; name?: string; summary?: string; domain?: string }) => Promise<void>;
    setEdge: (edge: { id: string; from_id: string; to_id: string; relation: string }) => Promise<void>;
  };
}): Promise<void> {
  if (!api.ontology) return;

  await api.ontology.setNode({
    id: LIST_ALL_SKILLS_NODE_ID,
    type: "ReferenceDoc",
    name: "List all skills",
    summary:
      "To retrieve the list of installed AgentSkills, call skills.list (returns array of { name, description }) or skills.run with query \"\" and action 'list all skills'. Skills live in ~/.ronin/skills and ./skills. Use when the user asks what skills are available or when ontology_search type 'Skill' returns empty.",
    domain: "reference",
  });
  await api.ontology.setEdge({
    id: `edge-${LIST_ALL_SKILLS_NODE_ID}-use-${TOOL_SKILLS_RUN_ID}`,
    from_id: LIST_ALL_SKILLS_NODE_ID,
    to_id: TOOL_SKILLS_RUN_ID,
    relation: "use_tool",
  });
  await api.ontology.setEdge({
    id: `edge-${LIST_ALL_SKILLS_NODE_ID}-use-${TOOL_SKILLS_LIST_ID}`,
    from_id: LIST_ALL_SKILLS_NODE_ID,
    to_id: TOOL_SKILLS_LIST_ID,
    relation: "use_tool",
  });

  await api.ontology.setNode({
    id: LIST_ALL_TOOLS_NODE_ID,
    type: "ReferenceDoc",
    name: "List all tools",
    summary:
      "To list all available tools, call ontology_search with params { type: 'Tool', limit: 50 }. Returns all registered tools. Use this when the user asks what tools are available or to discover tools.",
    domain: "reference",
  });
  await api.ontology.setEdge({
    id: `edge-${LIST_ALL_TOOLS_NODE_ID}-use-${TOOL_ONTOLOGY_SEARCH_ID}`,
    from_id: LIST_ALL_TOOLS_NODE_ID,
    to_id: TOOL_ONTOLOGY_SEARCH_ID,
    relation: "use_tool",
  });
}

/** Node types for messaging and users; linkable from logs/events (user ids, links, etc.). */
const ONTOLOGY_SELF_REFLEXION_NODE_ID = "ReferenceDoc-OntologySelfReflection";

/**
 * Sync MessagingPlatform (Telegram, Discord, etc.) and ReferenceDoc for UserID / self-reflection
 * so the ontology reflects configured apps and can be extended from logs (user ids, links).
 */
export async function syncMessagingAndUserNodes(
  api: {
    ontology?: {
      setNode: (node: { id: string; type: string; name?: string; summary?: string; domain?: string }) => Promise<void>;
      setEdge: (edge: { id: string; from_id: string; to_id: string; relation: string }) => Promise<void>;
    };
  },
  config: { telegram?: { botToken?: string }; discord?: { enabled?: boolean; botToken?: string } }
): Promise<void> {
  if (!api.ontology) return;

  // MessagingPlatform nodes from config (Telegram, Discord)
  if (config.telegram?.botToken) {
    await api.ontology.setNode({
      id: "MessagingPlatform-Telegram",
      type: "MessagingPlatform",
      name: "Telegram",
      summary: "Telegram messaging; chatId from config or from incoming event (e.g. create-skill, refactor-request). Use SendTelegramMessage event with chatId to reply.",
      domain: "messaging",
    });
  }
  if (config.discord?.enabled && config.discord?.botToken) {
    await api.ontology.setNode({
      id: "MessagingPlatform-Discord",
      type: "MessagingPlatform",
      name: "Discord",
      summary: "Discord messaging; channelIds from config. Use sourceChannel when emitting events so agents can reply to the right channel.",
      domain: "messaging",
    });
  }

  // ReferenceDoc: ontology self-reflection — node types and log mining
  await api.ontology.setNode({
    id: ONTOLOGY_SELF_REFLEXION_NODE_ID,
    type: "ReferenceDoc",
    name: "Ontology self-reflection and node types",
    summary:
      "Ontology node types include ReferenceDoc, Tool, Skill, MessagingPlatform, UserID, Link. MessagingPlatform nodes (e.g. Telegram, Discord) are synced from config by doctor ingest-docs. UserID and Link nodes can be created from logs or events (e.g. telegram chat id, discord user id, URLs). Do not store passwords in ontology; use sensitivity or external secrets. Edges link capabilities to tools and platforms (e.g. use_tool, uses_platform).",
    domain: "reference",
  });

  // Optional: edge from self-reflection doc to ontology_search so agents discover it
  await api.ontology.setEdge({
    id: `edge-${ONTOLOGY_SELF_REFLEXION_NODE_ID}-use-${TOOL_ONTOLOGY_SEARCH_ID}`,
    from_id: ONTOLOGY_SELF_REFLEXION_NODE_ID,
    to_id: TOOL_ONTOLOGY_SEARCH_ID,
    relation: "use_tool",
  });
}

const REFERENCE_DOC_PATHS: string[] = [
  "docs/RONIN_SCRIPT.md",
  "docs/PLUGINS.md",
  "docs/SKILLS.md",
  "AGENTS.md",
  "docs/CLI.md",
  "docs/RAG.md",
];

function slugFromPath(path: string): string {
  return path.replace(/\.md$/, "").replace(/\//g, "-").replace(/^-/, "");
}

/**
 * Ingest reference docs, tools, and skills into ontology and memory.
 */
export async function doctorIngestDocsCommand(): Promise<void> {
  console.log("\nRonin Doctor: Ingest docs, tools, and skills into ontology\n");

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

  if (api.ontology) {
    for (const relPath of REFERENCE_DOC_PATHS) {
      const fullPath = join(cwd, relPath);
      if (!existsSync(fullPath)) continue;
      try {
        const content = readFileSync(fullPath, "utf-8");
        const slug = slugFromPath(relPath);
        const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? relPath;
        const summary = content.slice(0, 300).replace(/\n/g, " ").trim();
        const nodeId = `ReferenceDoc-${slug}`;
        await api.ontology.setNode({
          id: nodeId,
          type: "ReferenceDoc",
          name: title,
          summary,
          domain: "reference",
        });
        await api.memory.store(`refdoc:${slug}`, content);
        docCount++;
        if (!process.env.RONIN_QUIET) console.log(`  ✅ ${relPath} → ${nodeId}`);
      } catch (err) {
        console.warn(`  ⚠️ ${relPath}: ${(err as Error).message}`);
      }
    }
  } else {
    console.log("  (Ontology plugin not loaded; skipping reference docs)");
  }

  if (api.ontology && api.tools) {
    const tools = api.tools.list();
    for (const tool of tools) {
      const nodeId = `Tool-${tool.name.replace(/\./g, "-")}`;
      await api.ontology.setNode({
        id: nodeId,
        type: "Tool",
        name: tool.name,
        summary: (tool.description ?? "").slice(0, 500),
        domain: "tools",
      });
      toolCount++;
    }
    if (!process.env.RONIN_QUIET) console.log(`  ✅ ${toolCount} tools → ontology`);
  }

  if (api.ontology && api.plugins?.has("skills")) {
    let skills: Array<{ name: string; description?: string }> = [];
    try {
      skills = (await api.plugins.call("skills", "discover_skills", "")) as Array<{ name: string; description?: string }>;
    } catch (err) {
      console.warn("  ⚠️ Skills plugin discover_skills failed:", (err as Error).message);
    }
    // Fallback: scan skills dirs so ontology gets Skill nodes even when plugin returns empty
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
        await api.ontology.setNode({
          id: `Skill-${name}`,
          type: "Skill",
          name,
          summary: desc.slice(0, 500),
          domain: "skills",
        });
        skillCount++;
      }
      if (!process.env.RONIN_QUIET) console.log(`  ✅ ${skillCount} skills → ontology`);
    }
  }

  await syncListCapabilities(api);
  if (!process.env.RONIN_QUIET) console.log("  ✅ List-all capabilities (skills, tools) → ontology");

  await syncMessagingAndUserNodes(api, config);
  if (!process.env.RONIN_QUIET) console.log("  ✅ MessagingPlatform / UserID (ontology) → ontology");

  console.log("");
  console.log(`Ingested: ${docCount} reference docs, ${toolCount} tools, ${skillCount} skills.`);
  console.log("Use ontology_search with type 'ReferenceDoc', 'Tool', 'Skill', 'MessagingPlatform', or 'UserID' to discover them.");
}
