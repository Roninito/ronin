import { describe, it, expect } from "bun:test";
import { parseReActToolCalls } from "../src/utils/reactTools.js";

describe("parseReActToolCalls", () => {
  it("parses TOOL: lines with JSON arguments", () => {
    const calls = parseReActToolCalls(
      "I need to read a file.\nTOOL: local.file.read {\"path\":\"/tmp/test.txt\"}\nThen answer."
    );
    expect(calls).toEqual([{ name: "local.file.read", arguments: { path: "/tmp/test.txt" } }]);
  });

  it("parses TOOL: lines without arguments", () => {
    const calls = parseReActToolCalls("TOOL: local.memory.search\n");
    expect(calls).toEqual([{ name: "local.memory.search", arguments: {} }]);
  });

  it("parses multiple TOOL lines including those inside markdown fences", () => {
    const calls = parseReActToolCalls(
      "Maybe this?\n```\nTOOL: local.file.read {\"path\":\"/tmp/x\"}\n```\nOr this one:\nTOOL: git_status {}"
    );
    expect(calls.length).toBe(2);
    expect(calls[0].name).toBe("local.file.read");
    expect(calls[1].name).toBe("git_status");
  });

  it("returns empty array when no TOOL lines", () => {
    const calls = parseReActToolCalls("No tools needed.");
    expect(calls).toEqual([]);
  });
});
