import { describe, it, expect } from "bun:test";
import { buildSystemPrompt, type RoninContext } from "../src/utils/prompt.js";

const context: RoninContext = {
  duties: [],
  plugins: [],
  routes: [],
  architecture: "",
  hasArtifacts: false,
};

const quiet = {
  includeArchitecture: false,
  includeDutyList: false,
  includePluginList: false,
  memoryHint: false,
};

describe("chat logs guidance", () => {
  it("defines logs as all ronin logs with scan-first, errors called out", () => {
    const prompt = buildSystemPrompt(context, quiet);
    expect(prompt).toContain("RONIN LOGS");
    expect(prompt).toContain("~/.ronin/logs/ronin-desktop.log");
    expect(prompt).toContain("~/.ronin/logs/runs/");
    expect(prompt).toContain("ALL of the above");
    expect(prompt).toContain("call out any errors");
  });

  it("asks clarifying questions on ambiguous log requests", () => {
    const prompt = buildSystemPrompt(context, quiet);
    expect(prompt).toContain("clarifying question");
    expect(prompt).toContain("which log?");
  });

  it("requires summarizing tool output, never pasting raw JSON", () => {
    const prompt = buildSystemPrompt(context, quiet);
    expect(prompt).toContain("never paste raw tool output or JSON");
  });
});
