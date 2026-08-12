import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "../src/types/index.js";
import { SkillAdapter } from "../src/skills/adapter.js";

// SkillAdapter used to check api.tools.getSchemas() for a TOOL literally
// named the same as the skill — completely disconnected from the real skill
// system (api.skills.*, backed by plugins/skills.ts). These tests confirm
// the rewrite actually calls the real skills API instead.
function mockAPI(overrides?: Partial<DutyAPI["skills"]>): DutyAPI {
  return {
    skills: {
      discover_skills: async (query: string) =>
        query.toLowerCase() === "weather"
          ? [{ name: "weather", description: "Weather briefings" }]
          : [],
      explore_skill: async (_name: string, _includeScripts: boolean) => ({
        frontmatter: { name: "weather", description: "Weather briefings" },
        instructions: "",
        abilities: [
          { name: "morning-briefing", description: "Get a morning briefing", input: ["location"] },
        ],
        assets: [],
      }),
      use_skill: async (
        skillName: string,
        options?: { ability?: string; params?: Record<string, unknown>; pipeline?: string[] }
      ) => ({
        success: true,
        output: { skillName, ability: options?.ability, params: options?.params },
        logs: [],
      }),
      list_skills_with_abilities: async () => [],
      ...overrides,
    },
  } as unknown as DutyAPI;
}

describe("SkillAdapter", () => {
  it("validateSkillExists calls the real discover_skills, not a tool lookup", async () => {
    const adapter = new SkillAdapter(mockAPI());
    expect(await adapter.validateSkillExists("weather")).toBe(true);
    expect(await adapter.validateSkillExists("nonexistent")).toBe(false);
  });

  it("executeSkill calls api.skills.use_skill with the ability and params", async () => {
    const adapter = new SkillAdapter(mockAPI());
    const result = await adapter.executeSkill(
      "weather",
      { location: "Tokyo" },
      { taskId: "t1", currentPhase: "weather", variables: {} },
      "morning-briefing"
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      skillName: "weather",
      ability: "morning-briefing",
      params: { location: "Tokyo" },
    });
  });

  it("executeSkillWithTimeout resolves normally when use_skill is fast", async () => {
    const adapter = new SkillAdapter(mockAPI());
    const result = await adapter.executeSkillWithTimeout(
      "weather",
      {},
      { taskId: "t1", currentPhase: "weather", variables: {} },
      "morning-briefing",
      1000
    );
    expect(result.success).toBe(true);
  });

  it("validateSkillExists returns false when the skills API isn't available", async () => {
    const adapter = new SkillAdapter({} as DutyAPI);
    expect(await adapter.validateSkillExists("weather")).toBe(false);
  });

  it("executeSkill throws when the skills API isn't available", async () => {
    const adapter = new SkillAdapter({} as DutyAPI);
    await expect(
      adapter.executeSkill("weather", {}, { taskId: "t1", currentPhase: "weather", variables: {} })
    ).rejects.toThrow(/Skills API not available/);
  });
});
