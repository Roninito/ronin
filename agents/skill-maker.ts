import path from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";
const { join } = path;
import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

const SOURCE = "skill-maker";

function getSkillsDir(api: AgentAPI): string {
  const system = api.config.getSystem();
  return system.skillsDir ?? join(homedir(), ".ronin", "skills");
}

/**
 * SkillMaker agent: creation-only. Reacts to agent.task.failed and create-skill
 * events; generates a new skill (skill.md + scripts) via AI and writes to
 * ~/.ronin/skills/<name>, then emits new-skill.
 */
export default class SkillMaker extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
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
    console.log("✅ SkillMaker agent ready. Listening for agent.task.failed and create-skill.");
  }

  async execute(): Promise<void> {
    // Event-driven only; nothing to do on schedule
  }

  private async handleFailure(payload: FailurePayload): Promise<void> {
    const request =
      payload.request ?? payload.description ?? payload.error ?? "Task failed";
    const failureNotes = payload.failureNotes ?? payload.error ?? "";
    await this.generateAndWriteSkill({
      request: `${request}. ${failureNotes}`.trim(),
      reason: "Failed task inspired creation",
      taskId: payload.taskId,
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
  }): Promise<void> {
    const { request, reason, taskId } = options;
    const prompt = `You are generating an AgentSkill for Ronin. The user needs a skill that: ${request}

Output exactly and only the following structure. No other text before or after.

---BEGIN SKILL---
NAME: <lowercase-slug e.g. log-monitor>
---SKILL.MD---
(full content of skill.md including YAML frontmatter with name and description, then Markdown with ## Abilities and ### abilityName sections; each ability can have Input:, Output:, Run: bun run scripts/name.ts --param=...)
---END SKILL.MD---
---SCRIPTS---
FILENAME: scripts/<name>.ts
CONTENT:
(typescript code)
---END SCRIPT---
(repeat FILENAME/CONTENT/END SCRIPT for each script if multiple)
---END SCRIPTS---
---END SKILL---`;

    let raw: string;
    try {
      raw = await this.api.ai.complete(prompt, { temperature: 0.3 });
    } catch (err) {
      console.error("[skill-maker] AI complete failed:", err);
      return;
    }

    const nameMatch = raw.match(/NAME:\s*(\S+)/);
    const skillName = nameMatch?.[1]?.trim() ?? "generated-skill";
    const slug = skillName.replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9-]/g, "");

    const skillMdMatch = raw.match(/---SKILL\.MD---\s*([\s\S]*?)---END SKILL\.MD---/);
    const skillMdContent = skillMdMatch?.[1]?.trim() ?? `---
name: ${slug}
description: Generated skill for ${request.slice(0, 80)}
---

# ${slug}\n\nGenerated skill.\n\n## Abilities\n\n### run\nRun the main script.\n- Input: (none)\n- Output: result\n- Run: bun run scripts/run.ts\n`;

    const scriptsSection = raw.match(/---SCRIPTS---\s*([\s\S]*?)---END SCRIPTS---/)?.[1] ?? "";
    const scriptBlocks = scriptsSection.split(/---END SCRIPT---/).filter(Boolean);
    const scripts: Array<{ path: string; content: string }> = [];
    for (const block of scriptBlocks) {
      const fnMatch = block.match(/FILENAME:\s*(\S+)/);
      const contentMatch = block.match(/CONTENT:\s*([\s\S]*?)(?=---END SCRIPT|---FILENAME:|\z)/);
      if (fnMatch?.[1]) {
        const path = fnMatch[1].replace(/^scripts\//, "");
        const content = (contentMatch?.[1] ?? "// no content").trim();
        scripts.push({ path: `scripts/${path}`, content });
      }
    }

    const skillsDir = getSkillsDir(this.api);
    const skillDir = join(skillsDir, slug);
    try {
      mkdirSync(skillDir, { recursive: true });
      await this.api.files.ensureDir(join(skillDir, "scripts"));
    } catch (e) {
      console.error("[skill-maker] mkdir/ensureDir failed:", e);
      return;
    }

    const skillMdPath = join(skillDir, "skill.md");
    try {
      await this.api.files.write(skillMdPath, skillMdContent);
    } catch (e) {
      console.error("[skill-maker] write skill.md failed:", e);
      return;
    }

    for (const { path: relPath, content } of scripts) {
      const fullPath = join(skillDir, relPath);
      try {
        await this.api.files.ensureDir(path.dirname(fullPath));
        await this.api.files.write(fullPath, content);
      } catch (e) {
        console.error("[skill-maker] write script failed:", relPath, e);
      }
    }

    (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
      "new-skill",
      { name: slug, reason, taskId, path: skillDir },
      SOURCE
    );
    console.log(`[skill-maker] Created skill: ${slug} at ${skillDir}`);

    if (taskId) {
      (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
        "retry.task",
        { taskId },
        SOURCE
      );
    }
  }
}

interface FailurePayload {
  taskId?: string;
  error?: string;
  agent?: string;
  failureNotes?: string;
  request?: string;
  description?: string;
  timestamp?: number;
}

interface CreateSkillPayload {
  request: string;
}
