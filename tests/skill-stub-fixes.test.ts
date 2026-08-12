import { describe, it, expect } from "bun:test";
import { FilesAPI } from "../src/api/files.js";
import skillsPlugin from "../plugins/skills.js";
import type { AgentAPI } from "../src/types/api.js";

// Regression coverage for the stub-skill fixes: alpaca and git both moved
// from a plain "## Operations" heading (invisible to the runtime parser,
// which only recognizes "## Abilities") to real, script-backed abilities.
// bun-cli and find-skills are documentation-only fixes (no ## Abilities
// section expected), and skills/test was deleted outright as a dead stub.
function realAPI(): AgentAPI {
  return {
    files: new FilesAPI(),
    config: { getSystem: () => ({ skillsDir: "/nonexistent-ronin-skills-dir-for-test" }) },
  } as unknown as AgentAPI;
}

describe("stub skill fixes", () => {
  const api = realAPI();
  (skillsPlugin.methods.setAPI as (a: AgentAPI) => void)(api);

  it("alpaca exposes real, script-backed abilities", async () => {
    const detail = await skillsPlugin.methods.explore_skill("alpaca", false);
    const names = detail.abilities.map((a) => a.name).sort();
    expect(names).toEqual(["get-account-health", "get-positions", "place-order"]);
    for (const a of detail.abilities) {
      expect(a.runCommand).toBeTruthy();
    }
  });

  it("git exposes a real, script-backed commit-summary ability", async () => {
    const detail = await skillsPlugin.methods.explore_skill("git", false);
    expect(detail.abilities.map((a) => a.name)).toEqual(["commit-summary"]);
    expect(detail.abilities[0].runCommand).toContain("--count={count}");
  });

  it("skills/test was removed as a dead stub", async () => {
    const results = await skillsPlugin.methods.discover_skills("");
    expect(results.some((s) => s.name.toLowerCase() === "test")).toBe(false);
  });
});
