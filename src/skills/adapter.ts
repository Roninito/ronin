/**
 * Skill Adapter
 *
 * Bridges the Task Engine to the real skill system (plugins/skills.ts,
 * bound onto DutyAPI as api.skills.*) — every kata "run skill X" phase
 * action ends up here.
 *
 * Corrected: this used to check api.tools.getSchemas() for a TOOL literally
 * named the same as the skill — a completely different, disconnected
 * mechanism from the real skill system (SKILL.md + scripts/, driven by
 * api.skills.use_skill/discover_skills/explore_skill). Confirmed by direct
 * testing against every real .kata file in the repo: only one phase in one
 * kata passed the old check; every phase of morning-briefing.kata (and
 * effectively every kata-driven skill invocation) silently failed with
 * "not registered" — nothing about the skill itself was ever wrong.
 */

import type { DutyAPI } from "../types/index.js";
import type { TaskContext } from "../task/types.js";
import type { UseSkillResult } from "../types/skills.js";

export class SkillAdapter {
  constructor(private api: DutyAPI) {}

  /**
   * Execute a skill via the real skill system. `ability` comes from the
   * kata phase's optional `ability <name>` clause — when omitted,
   * use_skill resolves it itself if the skill has exactly one ability.
   */
  async executeSkill(
    skillName: string,
    input: Record<string, unknown>,
    _taskContext: TaskContext,
    ability?: string
  ): Promise<UseSkillResult> {
    if (!this.api.skills) {
      throw new Error("Skills API not available — the skills plugin isn't loaded.");
    }
    return this.api.skills.use_skill(skillName, { ability, params: input });
  }

  /**
   * Validate a skill exists before execution — checks the real skill
   * directories via discover_skills, not tool names.
   */
  async validateSkillExists(skillName: string): Promise<boolean> {
    if (!this.api.skills) return false;
    try {
      const matches = await this.api.skills.discover_skills(skillName);
      return matches.some((s) => s.name.toLowerCase() === skillName.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Get skill metadata (description, abilities) via the real skill explorer.
   */
  async getSkillMetadata(
    skillName: string
  ): Promise<{ name: string; description: string; abilities: Array<{ name: string; description?: string; input: string[] }> } | null> {
    if (!this.api.skills) return null;
    try {
      const detail = await this.api.skills.explore_skill(skillName, false);
      return {
        name: detail.frontmatter.name,
        description: detail.frontmatter.description,
        abilities: detail.abilities,
      };
    } catch {
      return null;
    }
  }

  /**
   * Execute skill with timeout protection.
   */
  async executeSkillWithTimeout(
    skillName: string,
    input: Record<string, unknown>,
    taskContext: TaskContext,
    ability?: string,
    timeoutMs: number = 30000
  ): Promise<UseSkillResult> {
    return Promise.race([
      this.executeSkill(skillName, input, taskContext, ability),
      new Promise<UseSkillResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Skill '${skillName}' timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }
}
