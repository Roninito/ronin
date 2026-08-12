import { describe, it, expect } from "bun:test";
import { FilesAPI } from "../src/api/files.js";
import skillsPlugin from "../plugins/skills.js";
import type { AgentAPI } from "../src/types/api.js";

// End-to-end through the REAL skill system (discover_skills -> explore_skill
// -> use_skill), not a mock — this is what a kata's "run skill weather"
// phase actually goes through via SkillAdapter now. Confirms the SKILL.md
// heading fix (## Abilities), the {location} placeholder convention, and the
// single-ability auto-resolve fallback in use_skill all work together against
// the real weather skill files on disk.
//
// skillsDir is pointed at a nonexistent path so getSkillsDirs() falls back to
// only process.cwd()/skills (the repo copy) — on this machine ~/.ronin/skills
// already has a separately-installed "weather" marketplace skill (abilities:
// current, forecast) that would otherwise shadow the repo's bundled one
// (ability: morning-briefing), since user skill dirs are checked first.
function realAPI(): AgentAPI {
  const files = new FilesAPI();
  return {
    files,
    shell: {
      exec: async (command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string> }) => {
        const proc = Bun.spawn([command, ...(args ?? [])], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: options?.cwd,
          env: { ...process.env, ...options?.env },
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        return { exitCode: proc.exitCode, stdout, stderr, success: proc.exitCode === 0 };
      },
    },
    config: { getSystem: () => ({ skillsDir: "/nonexistent-ronin-skills-dir-for-test" }) },
  } as unknown as AgentAPI;
}

describe("weather skill — real end-to-end through plugins/skills.ts", () => {
  const api = realAPI();
  (skillsPlugin.methods.setAPI as (a: AgentAPI) => void)(api);

  it("discover_skills finds the weather skill via its frontmatter", async () => {
    const results = await skillsPlugin.methods.discover_skills("weather");
    expect(results.some((s: { name: string }) => s.name.toLowerCase() === "weather")).toBe(true);
  });

  it("explore_skill parses the morning-briefing ability from the ## Abilities heading", async () => {
    const detail = await skillsPlugin.methods.explore_skill("weather", false);
    expect(detail.frontmatter.name).toBe("weather");
    expect(detail.abilities.length).toBe(1);
    expect(detail.abilities[0].name).toBe("morning-briefing");
    expect(detail.abilities[0].runCommand).toContain("--location={location}");
  });

  it("use_skill runs the real script end-to-end with an explicit ability and location", async () => {
    const result = await skillsPlugin.methods.use_skill("weather", {
      ability: "morning-briefing",
      params: { location: "Austin, TX" },
    });
    expect(result.success).toBe(true);
    const output = result.output as { success: boolean; briefing: string; conditions: string };
    expect(output.success).toBe(true);
    expect(output.briefing).toContain("Austin");
  }, 15000);

  it("use_skill auto-resolves the sole ability when none is given (the single-ability fallback)", async () => {
    const result = await skillsPlugin.methods.use_skill("weather", {
      params: { location: "Austin, TX" },
    });
    expect(result.success).toBe(true);
    const output = result.output as { success: boolean; briefing: string };
    expect(output.success).toBe(true);
    expect(output.briefing).toContain("Austin");
  }, 15000);
});
