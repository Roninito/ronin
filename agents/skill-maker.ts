import path from "path";
import { rmSync } from "fs";
import { homedir } from "os";
const { join } = path;
import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import type { ToolDefinition, ToolResult, ToolContext } from "../src/tools/types.js";
import {
  createOntologyResolveMiddleware,
  createOntologyInjectMiddleware,
  createSmartTrimMiddleware,
  createTokenGuardMiddleware,
  createAiToolMiddleware,
  createChainLoggingMiddleware,
} from "../src/middleware/index.js";
import { Chain } from "../src/chain/Chain.js";
import { MiddlewareStack } from "../src/middleware/MiddlewareStack.js";
import type { ChainContext } from "../src/chain/types.js";

const SOURCE = "skill-maker";

const SKILL_MAKER_ONTOLOGY_SKILLS = [
  "skill_maker.set_slug",
  "skill_maker.ensure_dir",
  "skill_maker.write_file",
  "skill_maker.list_dir",
  "skill_maker.finish",
  "ontology_search",
  "local.memory.search",
  "mcp_brave-search_brave_web_search",
  "scrape_scrape_to_markdown",
];

function getSkillsDir(api: AgentAPI): string {
  const system = api.config.getSystem();
  return system.skillsDir ?? join(homedir(), ".ronin", "skills");
}

function createSkillMakerTools(
  api: AgentAPI,
  slugMap: Map<string, string>,
  finishStatusMap: Map<string, "success" | "abort">
): ToolDefinition[] {
  const baseMeta = (name: string, duration: number) => ({
    toolName: name,
    provider: "skill_maker",
    duration,
    cached: false,
    timestamp: Date.now(),
    callId: `skill_maker-${Date.now()}`,
  });

  return [
    {
      name: "skill_maker.set_slug",
      description:
        "Set the skill slug (directory name) for this run. Call this first with a lowercase hyphenated name (e.g. log-monitor). All subsequent ensure_dir and write_file paths are relative to skills/<slug>.",
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Lowercase hyphenated slug (e.g. log-monitor)",
          },
        },
        required: ["slug"],
      },
      provider: "skill_maker",
      handler: async (
        args: { slug: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        const slug = (args.slug ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        if (!slug) {
          return {
            success: false,
            data: null,
            error: "slug must be non-empty after normalizing",
            metadata: baseMeta("skill_maker.set_slug", Date.now() - start),
          };
        }
        slugMap.set(ctx.conversationId, slug);
        return {
          success: true,
          data: { slug },
          metadata: baseMeta("skill_maker.set_slug", Date.now() - start),
        };
      },
      riskLevel: "low",
      cacheable: false,
    },
    {
      name: "skill_maker.ensure_dir",
      description:
        "Create a directory under the current skill (e.g. '.' for skill root, 'scripts' for scripts/). Call set_slug first.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Path relative to skill root (e.g. . or scripts)",
          },
        },
        required: ["relativePath"],
      },
      provider: "skill_maker",
      handler: async (
        args: { relativePath: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        let slug = slugMap.get(ctx.conversationId);
        if (!slug) {
          slug = `generated-${Date.now()}`;
          slugMap.set(ctx.conversationId, slug);
        }
        const skillsDir = getSkillsDir(api);
        const fullPath = join(skillsDir, slug, args.relativePath ?? ".");
        try {
          await api.files.ensureDir(fullPath);
          return {
            success: true,
            data: { path: fullPath },
            metadata: baseMeta("skill_maker.ensure_dir", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "ensure_dir failed",
            metadata: baseMeta("skill_maker.ensure_dir", Date.now() - start),
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    },
    {
      name: "skill_maker.write_file",
      description:
        "Write content to a file under the current skill. Path is relative to skill root (e.g. skill.md, scripts/run.ts). Call set_slug first.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "File path relative to skill root (e.g. skill.md or scripts/run.ts)",
          },
          content: { type: "string", description: "Full file content" },
        },
        required: ["relativePath", "content"],
      },
      provider: "skill_maker",
      handler: async (
        args: { relativePath: string; content: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        let slug = slugMap.get(ctx.conversationId);
        if (!slug) {
          slug = `generated-${Date.now()}`;
          slugMap.set(ctx.conversationId, slug);
        }
        const skillsDir = getSkillsDir(api);
        const fullPath = join(skillsDir, slug, args.relativePath ?? "");
        try {
          await api.files.ensureDir(path.dirname(fullPath));
          await api.files.write(fullPath, args.content ?? "");
          return {
            success: true,
            data: { path: fullPath },
            metadata: baseMeta("skill_maker.write_file", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "write failed",
            metadata: baseMeta("skill_maker.write_file", Date.now() - start),
          };
        }
      },
      riskLevel: "medium",
      cacheable: false,
    },
    {
      name: "skill_maker.list_dir",
      description:
        "List entries in a directory under the current skill. Path is relative to skill root (default '.'). Call set_slug first.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Directory path relative to skill root (optional, default '.')",
          },
        },
        required: [],
      },
      provider: "skill_maker",
      handler: async (
        args: { relativePath?: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        let slug = slugMap.get(ctx.conversationId);
        if (!slug) {
          slug = `generated-${Date.now()}`;
          slugMap.set(ctx.conversationId, slug);
        }
        const skillsDir = getSkillsDir(api);
        const fullPath = join(skillsDir, slug, args.relativePath ?? ".");
        try {
          const entries = await api.files.list(fullPath);
          return {
            success: true,
            data: { path: fullPath, entries },
            metadata: baseMeta("skill_maker.list_dir", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "list failed",
            metadata: baseMeta("skill_maker.list_dir", Date.now() - start),
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    },
    {
      name: "skill_maker.finish",
      description:
        "Signal that you are done with this skill-creation run. Call with status 'success' after you have written skill.md and all scripts (so we validate and complete). Call with status 'abort' if you cannot complete (e.g. you are replying with text only, hit an error, or need to give up). Do not leave the run without calling finish; otherwise we may assume failure from missing tool calls.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["success", "abort"],
            description: "success = I wrote all files. abort = I cannot complete, treat as aborted.",
          },
          message: {
            type: "string",
            description: "Optional short reason (e.g. for abort: why you could not complete).",
          },
        },
        required: ["status"],
      },
      provider: "skill_maker",
      handler: async (
        args: { status: "success" | "abort"; message?: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        const status = args.status === "abort" ? "abort" : "success";
        finishStatusMap.set(ctx.conversationId, status);
        if (args.message && !process.env.RONIN_QUIET) {
          console.log(`[skill-maker] finish(${status}): ${args.message}`);
        }
        return {
          success: true,
          data: { status, message: args.message },
          metadata: baseMeta("skill_maker.finish", Date.now() - start),
        };
      },
      riskLevel: "low",
      cacheable: false,
    },
  ];
}

/**
 * SkillMaker agent: creation-only. Reacts to agent.task.failed and create-skill
 * events; generates a new skill via SAR Chain (tools: set_slug, ensure_dir,
 * write_file, list_dir) and emits new-skill.
 */
export default class SkillMaker extends BaseAgent {
  private skillSlugByConversation = new Map<string, string>();
  private finishStatusByConversation = new Map<string, "success" | "abort">();

  constructor(api: AgentAPI) {
    super(api);
    for (const tool of createSkillMakerTools(
      api,
      this.skillSlugByConversation,
      this.finishStatusByConversation
    )) {
      api.tools.register(tool);
    }
    this.api.events.on("agent.task.failed", (data: unknown) => {
      this.handleFailure(data as FailurePayload).catch((err) =>
        console.error("[skill-maker] handleFailure:", err)
      );
    });
    this.api.events.on("create-skill", (data: unknown) => {
      this.handleCreateSkill(data as CreateSkillPayload).catch((err) =>
        console.error("[skill-maker] handleCreateSkill:", err)
      );
    });
    console.log("✅ SkillMaker agent ready (SAR). Listening for agent.task.failed and create-skill.");
  }

  async execute(): Promise<void> {
    // Event-driven only
  }

  private async handleFailure(payload: FailurePayload): Promise<void> {
    const request =
      payload.request ?? payload.description ?? payload.error ?? "Task failed";
    const failureNotes = payload.failureNotes ?? payload.error ?? "";
    await this.generateAndWriteSkill({
      request: `${request}. ${failureNotes}`.trim(),
      reason: "Failed task inspired creation",
      taskId: payload.taskId,
      telegramChatId: payload.telegramChatId,
      sourceChannel: payload.sourceChannel,
      sourceUser: payload.sourceUser,
    });
  }

  private async handleCreateSkill(payload: CreateSkillPayload): Promise<void> {
    const request = payload.request ?? "";
    if (!request.trim()) {
      console.warn("[skill-maker] create-skill event had empty request");
      return;
    }
    await this.generateAndWriteSkill({
      request,
      reason: "User request",
      telegramChatId: payload.telegramChatId,
      sourceChannel: payload.sourceChannel,
      sourceUser: payload.sourceUser,
    });
  }

  /** Public entry for CLI: create a skill from a request string (no event). */
  async createSkillFromRequest(request: string): Promise<void> {
    if (!request.trim()) {
      console.warn("[skill-maker] createSkillFromRequest had empty request");
      return;
    }
    await this.generateAndWriteSkill({
      request,
      reason: "User request",
    });
  }

  private async generateAndWriteSkill(options: {
    request: string;
    reason: string;
    taskId?: string;
    telegramChatId?: string | number;
    sourceChannel?: string;
    sourceUser?: string;
  }): Promise<void> {
    const { request, reason, taskId, telegramChatId, sourceChannel, sourceUser } = options;
    const conversationId = `skill-maker-${Date.now()}`;

    const emitCompletionMessage = (text: string, isError = false): void => {
      if (telegramChatId == null) return;
      (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
        "SendTelegramMessage",
        {
          text,
          chatId: telegramChatId,
          parseMode: "HTML",
          source: SOURCE,
        },
        SOURCE
      );
    };

    const systemContent = `You are creating a Ronin AgentSkill. You MUST use the tools to write real files. Do not output only text.

Research phase (when unsure): If you are not sure how the service, API, or technology works, research first. (1) Use Brave search: call mcp_brave-search_brave_web_search with a query (e.g. "X API documentation", "how does X work") to find official docs or tutorials. (2) Use our scraping tools: call scrape_scrape_to_markdown with a url (e.g. a doc URL from the search results) to fetch the page and get clean markdown — use this to read how the service actually works. (3) You can also call ontology_search (type "ReferenceDoc" or "Tool", nameLike matching the topic) or local.memory.search for internal docs. Use the combined results to implement the skill correctly, then proceed with set_slug, write_file, finish.

How tool calling works: You must respond with tool calls (each tool has a name and arguments). If you reply with only prose, no tool runs. The system executes your tool calls, appends the results, and gives you another turn. Use that next turn to call more tools (e.g. write_file again) or call skill_maker.finish. If you cannot complete the skill, call skill_maker.finish with status "abort" so we know you are intentionally giving up — do not leave the run without calling finish. When you have written skill.md and scripts/run.ts, call skill_maker.finish with status "success".

Scripts must accept input via argv: All generated scripts MUST take input from command-line arguments (e.g. --input=, --path=, --query=). The Run: line in skill.md must use placeholders, e.g. Run: bun run scripts/run.ts --input={input}. The script must parse process.argv for these flags. Do not assume input files (e.g. input.txt) exist — the caller (skills.run) passes params as argv. If the user explicitly wants file-based input, the skill can optionally read a file path from argv (e.g. --file=path) but must not require a hardcoded filename.

Required tool sequence: (1) If unsure, research (Brave search mcp_brave-search_brave_web_search, then scrape_scrape_to_markdown to read doc URLs; or ontology_search / local.memory.search). (2) skill_maker.set_slug with a lowercase hyphenated slug. (3) skill_maker.ensure_dir for "." and "scripts". (4) skill_maker.write_file for skill.md (full content: YAML frontmatter name + description, then ## Abilities, ### run with Input:, Output:, Run: bun run scripts/run.ts --input={input} or similar placeholders). (5) skill_maker.write_file for scripts/run.ts with actual TypeScript that parses argv (e.g. --input=) and implements the behavior — not a stub. (6) skill_maker.finish with status "success". If you cannot implement, call skill_maker.finish with status "abort".

You MUST call skill_maker.finish before ending: "success" after writing all files, or "abort" if you cannot complete. Do not leave the run without calling finish. Do not reply with only prose — respond with tool calls so that write_file and finish actually run.

If you cannot or do not use tools, you MUST output the skill in this exact text format (so it can be parsed and written automatically). Use these delimiters exactly:

NAME: <lowercase-slug>
---SKILL.MD---
(full skill.md content: YAML frontmatter with name and description, then Markdown with ## Abilities and ### abilityName)
---END SKILL.MD---
---SCRIPTS---
FILENAME: scripts/run.ts
CONTENT:
(typescript code)
---END SCRIPT---
---END SCRIPTS---

Skill structure: skill.md has frontmatter (name, description) and body (## Abilities, ### run with Input:, Output:, Run: bun run scripts/run.ts --input={input} or similar argv placeholders). Scripts are TypeScript in scripts/ and must parse argv (e.g. --input=) for input.

Either call the tools (and finish with success or abort) OR output the block above. Do not reply with only a prose description.`;

    const userContent = `Create a skill that: ${request}`;

    console.log(`[skill-maker] Creating skill: "${request.slice(0, 80)}${request.length > 80 ? "…" : ""}"`);

    const stack = new MiddlewareStack<ChainContext>();
    stack.use(createChainLoggingMiddleware("skill-maker"));
    stack.use(createOntologyResolveMiddleware({ api: this.api }));
    stack.use(createOntologyInjectMiddleware());
    stack.use(createSmartTrimMiddleware({ recentCount: 12 }));
    stack.use(createTokenGuardMiddleware());
    stack.use(createAiToolMiddleware(this.api, { logLabel: "skill-maker" }));

    const ctx: ChainContext = {
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      ontology: {
        domain: "skill_maker",
        relevantSkills: SKILL_MAKER_ONTOLOGY_SKILLS,
      },
      budget: {
        max: 8192,
        current: 0,
        reservedForResponse: 512,
      },
      conversationId,
      model: "smart",
    };

    const runChainOnce = async (): Promise<void> => {
      this.createChain();
      const chain = new Chain(this.executor!, stack, "skill-maker");
      chain.withContext(ctx);
      await chain.run();
    };

    let chainError: Error | null = null;
    try {
      console.log("[skill-maker] Running chain…");
      await runChainOnce();

      const slugAfterFirstRun = this.skillSlugByConversation.get(conversationId);
      const finishStatusAfterRun = this.finishStatusByConversation.get(conversationId);
      const lastMsg = ctx.messages[ctx.messages.length - 1];
      const lastRoundHadNoToolCalls = lastMsg?.role === "assistant";

      if (!slugAfterFirstRun && lastRoundHadNoToolCalls) {
        console.log("[skill-maker] Model replied without tool calls; injecting retry instruction and running again.");
        ctx.messages.push({
          role: "user",
          content:
            "You must use the tools. Call skill_maker.set_slug with a slug (e.g. mermaid-diagram), skill_maker.ensure_dir for '.' and 'scripts', skill_maker.write_file for skill.md and script(s), then skill_maker.finish with status 'success'. If you cannot complete, call skill_maker.finish with status 'abort'. Do not reply with only text.",
        });
        await runChainOnce();
      } else if (slugAfterFirstRun && !finishStatusAfterRun && lastRoundHadNoToolCalls) {
        console.log("[skill-maker] Model created dirs but did not call write_file or finish; prompting for finish or write.");
        ctx.messages.push({
          role: "user",
          content:
            "You created the skill directory but did not call skill_maker.write_file or skill_maker.finish. You must either: (1) Call skill_maker.write_file for skill.md (full markdown with frontmatter and ## Abilities ### run Run: bun run scripts/run.ts) and for scripts/run.ts (real implementation, not a stub), then skill_maker.finish with status 'success', or (2) Call skill_maker.finish with status 'abort' if you cannot complete. Reply with tool calls only.",
        });
        await runChainOnce();
      }
      // Third chance: if we still have no write_file calls (folder will be empty), try one more explicit nudge
      const slugAfterSecond = this.skillSlugByConversation.get(conversationId);
      const finishAfterSecond = this.finishStatusByConversation.get(conversationId);
      const lastMsg2 = ctx.messages[ctx.messages.length - 1];
      const lastRound2NoTools = lastMsg2?.role === "assistant";
      if (slugAfterSecond && !finishAfterSecond && lastRound2NoTools) {
        const hasWriteFile = ctx.messages.some(
          (m) => m.role === "tool" && (m as { name?: string }).name === "skill_maker.write_file"
        );
        if (!hasWriteFile) {
          console.log("[skill-maker] Still no write_file after second prompt; third chance with concrete example.");
          ctx.messages.push({
            role: "user",
            content: `Call skill_maker.write_file twice now: (1) relativePath "skill.md" with full content (frontmatter name/description, ## Abilities, ### run with Run: bun run scripts/run.ts). (2) relativePath "scripts/run.ts" with real TypeScript that implements: ${request.slice(0, 200)}. No stubs — the script must perform the actual behavior. Then call skill_maker.finish with status "success".`,
          });
          await runChainOnce();
        }
      }
    } catch (err) {
      chainError = err instanceof Error ? err : new Error(String(err));
      console.error("[skill-maker] Chain run failed:", chainError);
      emitCompletionMessage(
        `❌ <b>Skill creation failed</b>\n\n${escapeHtml(chainError.message)}\n\nNo skill was written.`,
        true
      );
      return;
    } finally {
      // allow cleanup of slug map below
    }

    let slug = this.skillSlugByConversation.get(conversationId);
    this.skillSlugByConversation.delete(conversationId);
    const finishStatus = this.finishStatusByConversation.get(conversationId);
    this.finishStatusByConversation.delete(conversationId);

    const skillsDir = getSkillsDir(this.api);

    if (finishStatus === "abort") {
      if (slug) {
        const skillDir = join(skillsDir, slug);
        try {
          rmSync(skillDir, { recursive: true });
          console.log("[skill-maker] Removed skill directory after abort:", skillDir);
        } catch (e) {
          console.warn("[skill-maker] Could not remove skill dir after abort:", (e as Error).message);
        }
      }
      emitCompletionMessage(
        "🛑 <b>Skill creation aborted</b>\n\nThe model reported it could not complete the skill. Any empty folder was removed. Try again or use the CLI: <code>ronin skills create \"your description\"</code>.",
        true
      );
      return;
    }

    if (!slug) {
      const assistantContent = ctx.messages
        .filter((m) => m.role === "assistant")
        .map((m) => m.content)
        .join("\n\n");
      const parsed = parseSkillFromText(assistantContent, request);
      if (parsed) {
        console.log("[skill-maker] No tool calls; parsed skill from assistant text.");
        slug = parsed.slug;
        const skillDir = join(skillsDir, slug);
        try {
          await this.api.files.ensureDir(skillDir);
          await this.api.files.ensureDir(join(skillDir, "scripts"));
          await this.api.files.write(join(skillDir, "skill.md"), parsed.skillMdContent);
          for (const { path: relPath, content } of parsed.scripts) {
            const fullPath = join(skillDir, relPath);
            await this.api.files.ensureDir(path.dirname(fullPath));
            await this.api.files.write(fullPath, content);
          }
        } catch (writeErr) {
          console.error("[skill-maker] Failed to write parsed skill:", writeErr);
          slug = undefined;
        }
      }
    }

    if (slug) {
      console.log(`[skill-maker] Resolved slug: ${slug}`);
    }
    if (!slug) {
      console.warn("[skill-maker] No slug set during chain run; skill may be incomplete.");
      emitCompletionMessage(
        "⚠️ <b>Skill creation finished with no slug</b>\n\nThe model did not call the skill-making tools. You may find partial files under <code>~/.ronin/skills/generated-*</code>. Try again or use the CLI: <code>ronin skills create \"your description\"</code>.",
        true
      );
      return;
    }

    const skillDir = join(skillsDir, slug);

    // Ensure we actually have content: model may have called set_slug + ensure_dir but never write_file.
    // Also verify any script files referenced in skill.md (e.g. Run: bun run scripts/run.ts) exist.
    const skillMdPath = join(skillDir, "skill.md");
    const skillMdAltPath = join(skillDir, "SKILL.md");
    let skillDirHasContent = false;
    try {
      const entries = await this.api.files.list(skillDir);
      const hasSkillMd = entries.some(
        (p) => p.endsWith("skill.md") || p.endsWith("SKILL.md")
      );
      if (hasSkillMd) {
        let content: string;
        try {
          content = await this.api.files.read(skillMdPath);
        } catch {
          content = await this.api.files.read(skillMdAltPath);
        }
        const referencedScripts = getReferencedScriptPaths(content);
        let allScriptsExist = true;
        for (const relPath of referencedScripts) {
          try {
            await this.api.files.read(join(skillDir, relPath));
          } catch {
            allScriptsExist = false;
            console.warn(`[skill-maker] Referenced script missing: ${relPath}`);
            break;
          }
        }
        skillDirHasContent = allScriptsExist;
      }
    } catch {
      // dir might not exist or be empty
    }
    if (!skillDirHasContent) {
      const assistantContent = ctx.messages
        .filter((m) => m.role === "assistant")
        .map((m) => m.content)
        .join("\n\n");
      // Use request as hint so parser derives a slug; accept any parse when we already have a folder (slug from set_slug)
      const parsed = parseSkillFromText(assistantContent, request);
      if (parsed) {
        // Write into current slug's folder (parsed.slug may differ e.g. longer request-based slug)
        try {
          await this.api.files.ensureDir(skillDir);
          await this.api.files.ensureDir(join(skillDir, "scripts"));
          await this.api.files.write(join(skillDir, "skill.md"), parsed.skillMdContent);
          for (const { path: relPath, content } of parsed.scripts) {
            const fullPath = join(skillDir, relPath);
            await this.api.files.ensureDir(path.dirname(fullPath));
            await this.api.files.write(fullPath, content);
          }
          skillDirHasContent = true;
          console.log("[skill-maker] Wrote skill from parsed assistant text (folder was empty).");
        } catch (writeErr) {
          console.error("[skill-maker] Failed to write parsed skill (empty folder):", writeErr);
        }
      }
      if (!skillDirHasContent) {
        this.skillSlugByConversation.delete(conversationId);
        try {
          rmSync(skillDir, { recursive: true });
          console.log("[skill-maker] Removed empty skill directory:", skillDir);
        } catch (e) {
          console.warn("[skill-maker] Could not remove empty skill dir:", (e as Error).message);
        }
        emitCompletionMessage(
          "⚠️ <b>Skill folder created but no content written</b>\n\nThe model created the directory but did not complete writing skill.md or scripts. The empty folder was removed. Try again or use the CLI: <code>ronin skills create \"your description\"</code>.",
          true
        );
        return;
      }
    }

    const newSkillPayload = { name: slug, reason, taskId, path: skillDir };
    (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
      "new-skill",
      newSkillPayload,
      SOURCE
    );
    console.log(`[skill-maker] Created skill: ${slug} at ${skillDir}`);

    if (this.api.ontology) {
      try {
        let summary = reason?.slice(0, 500);
        try {
          const skillMdPath = join(skillDir, "skill.md");
          const content = await this.api.files.read(skillMdPath);
          const descMatch = content.match(/(?:^---\s*\n[\s\S]*?\ndescription:\s*["']?([^"'\n]+)["']?|^#\s+.+\n\n([^\n]+))/m);
          if (descMatch?.[1] || descMatch?.[2]) {
            summary = (descMatch[1] ?? descMatch[2]).trim().slice(0, 500);
          }
        } catch {
          // use reason as summary
        }
        await this.api.ontology.setNode({
          id: `Skill-${slug}`,
          type: "Skill",
          name: slug,
          summary: summary ?? undefined,
          domain: "skills",
        });
        console.log(`[skill-maker] Ontology updated with Skill-${slug}`);
      } catch (err) {
        console.warn("[skill-maker] Failed to update ontology with new skill:", (err as Error).message);
      }
    }

    emitCompletionMessage(
      `✅ <b>Skill created</b>\n\n<code>${escapeHtml(slug)}</code>\nPath: <code>${escapeHtml(skillDir)}</code>`
    );

    if (taskId) {
      (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
        "retry.task",
        { taskId },
        SOURCE
      );
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Extract script paths referenced in skill.md (e.g. from "Run: bun run scripts/run.ts").
 * Returns relative paths like ["scripts/run.ts", "scripts/discover.ts"].
 */
function getReferencedScriptPaths(skillMdContent: string): string[] {
  const paths: string[] = [];
  const runRegex = /Run:\s*(.+?)(?=\n|$)/gim;
  const scriptPathRegex = /scripts\/[^\s'"\n)]+\.(ts|js|mjs|cjs)/gi;
  let runMatch: RegExpExecArray | null;
  while ((runMatch = runRegex.exec(skillMdContent)) !== null) {
    const line = runMatch[1];
    let pathMatch: RegExpExecArray | null;
    const pathRegex = /scripts\/[^\s'"\n)]+\.(ts|js|mjs|cjs)/gi;
    while ((pathMatch = pathRegex.exec(line)) !== null) {
      const rel = pathMatch[0];
      if (!paths.includes(rel)) paths.push(rel);
    }
  }
  return paths;
}

/**
 * Parse assistant text output for legacy skill format (NAME:, ---SKILL.MD---, ---SCRIPTS---)
 * or frontmatter + markdown/code blocks. requestHint used to derive slug when not found in text.
 */
function parseSkillFromText(
  raw: string,
  requestHint?: string
): {
  slug: string;
  skillMdContent: string;
  scripts: Array<{ path: string; content: string }>;
} | null {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim();

  let slug: string | null = null;
  const nameMatch = text.match(/\bNAME:\s*(\S+)/i) ?? text.match(/\bname:\s*(\S+)/);
  if (nameMatch) {
    slug = nameMatch[1].trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  if (!slug) {
    const frontmatterMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const nameInYaml = frontmatterMatch[1].match(/\bname:\s*["']?([a-z0-9-]+)["']?/i);
      if (nameInYaml) slug = nameInYaml[1].trim().toLowerCase();
    }
  }
  if (!slug && requestHint) {
    slug = requestHint
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 50) || "generated-skill";
  }
  if (!slug) return null;

  let skillMdContent: string | null =
    text.match(/---SKILL\.MD---\s*([\s\S]*?)---END\s*SKILL\.MD---/i)?.[1]?.trim() ??
    text.match(/```(?:markdown|md)\s*([\s\S]*?)```/)?.[1]?.trim() ??
    null;
  if (!skillMdContent && text.startsWith("---")) {
    const scriptsStart = text.indexOf("---SCRIPTS---");
    const endMd = text.indexOf("---END SKILL.MD---");
    const sliceEnd = scriptsStart >= 0 ? scriptsStart : endMd >= 0 ? endMd : text.length;
    const candidate = text.slice(0, sliceEnd).trim();
    if (candidate.length > 80 && (candidate.includes("##") || candidate.includes("\ndescription:"))) {
      skillMdContent = candidate;
    }
  }
  // Fallback: slug from request + any markdown that looks like a skill (frontmatter or ## Abilities)
  if (!skillMdContent && slug) {
    const scriptsMarker = text.indexOf("---SCRIPTS---");
    const bodyEnd = scriptsMarker >= 0 ? scriptsMarker : text.length;
    const candidate = text.slice(0, bodyEnd).trim();
    const hasStructure =
      (candidate.includes("---") && candidate.includes("description:")) ||
      candidate.includes("## Abilities") ||
      (candidate.includes("### ") && (candidate.includes("Run:") || candidate.includes("Input:")));
    if (candidate.length > 100 && hasStructure) {
      skillMdContent = candidate;
    }
  }
  // Last resort: model returned no tool calls but sent prose + code block — build minimal skill from request + code
  if (!skillMdContent && slug) {
    const tsBlock = text.match(/```(?:ts|typescript)\s*\n([\s\S]*?)```/);
    if (tsBlock?.[1]?.trim()) {
      const name = slug.replace(/-/g, " ");
      const desc = requestHint?.slice(0, 120).trim() || `Skill: ${name}`;
      skillMdContent = `---
name: ${slug}
description: ${desc}
---

# ${name}

${requestHint?.slice(0, 300).trim() || ""}

## Abilities

### run
Run: bun run scripts/run.ts
`;
    }
  }
  if (!skillMdContent) return null;

  const scriptsSection = text.match(/---SCRIPTS---\s*([\s\S]*?)---END\s*SCRIPTS---/i)?.[1] ?? "";
  const scriptBlocks = scriptsSection.split(/---END\s*SCRIPT---/i).filter(Boolean);
  const scripts: Array<{ path: string; content: string }> = [];
  for (const block of scriptBlocks) {
    const fnMatch = block.match(/FILENAME:\s*(\S+)/i);
    const contentMatch = block.match(/CONTENT:\s*([\s\S]*?)(?=---END\s*SCRIPT|---FILENAME:|\z)/i);
    if (fnMatch?.[1]) {
      const relPath = fnMatch[1].replace(/^scripts\//, "");
      const content = (contentMatch?.[1] ?? "// no content").trim();
      scripts.push({ path: `scripts/${relPath}`, content });
    }
  }
  if (scripts.length === 0) {
    const tsBlock = text.match(/```(?:ts|typescript)\s*\n([\s\S]*?)```/);
    if (tsBlock?.[1]?.trim()) {
      scripts.push({ path: "scripts/run.ts", content: tsBlock[1].trim() });
    }
  }

  return { slug, skillMdContent, scripts };
}

interface FailurePayload {
  taskId?: string;
  error?: string;
  agent?: string;
  failureNotes?: string;
  request?: string;
  description?: string;
  timestamp?: number;
  telegramChatId?: string | number;
  sourceChannel?: string;
  sourceUser?: string;
}

interface CreateSkillPayload {
  request: string;
  telegramChatId?: string | number;
  sourceChannel?: string;
  sourceUser?: string;
  source?: string;
}
