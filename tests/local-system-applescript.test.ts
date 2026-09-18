import { describe, it, expect } from "bun:test";
import { readdirSync } from "fs";
import { tmpdir } from "os";
import type { DutyAPI } from "@ronin/types/index.js";
import type { ToolContext, ToolDefinition } from "../src/tools/types.js";
import { registerLocalTools } from "../src/tools/providers/LocalTools.js";

const dummyContext: ToolContext = { conversationId: "test", timestamp: Date.now() };

function leakedAppleScriptTempFiles(): string[] {
  return readdirSync(tmpdir()).filter((f) => f.startsWith("ronin-applescript-"));
}

function setup() {
  const tools = new Map<string, ToolDefinition>();
  const register = (tool: ToolDefinition) => tools.set(tool.name, tool);

  const api = {
    config: {
      getSystem: () => ({ dataDir: tmpdir() }),
      getAll: () => ({ desktop: { features: { screenCapture: true } } }),
      getNotifications: () => ({ preferredChat: "auto" }),
    },
    plugins: { has: () => false, call: async () => undefined },
    ai: {},
  } as unknown as DutyAPI;

  registerLocalTools(api, register);
  return tools;
}

// These run real `osascript` — reasonable for a macOS-only tool with no
// meaningful way to fake a process's stdout without also faking away the
// exact behavior (quoting, exit codes) being tested.
describe("local.system.applescript", () => {
  it("registers with medium risk", () => {
    const tools = setup();
    const tool = tools.get("local.system.applescript")!;
    expect(tool).toBeDefined();
    expect(tool.riskLevel).toBe("medium");
  });

  it("executes the script verbatim and returns its stdout", async () => {
    const tools = setup();
    const result = await tools.get("local.system.applescript")!.handler(
      { script: 'return "hello from ronin"' },
      dummyContext,
    );

    expect(result.success).toBe(true);
    expect((result.data as any).stdout.trim()).toBe("hello from ronin");
  });

  it("returns a failed ToolResult (not a throw) with the AppleScript error message on failure", async () => {
    const tools = setup();
    const result = await tools.get("local.system.applescript")!.handler(
      { script: 'error "boom"' },
      dummyContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("boom");
  });

  it("cleans up its temp script file after a successful run", async () => {
    const tools = setup();
    const before = leakedAppleScriptTempFiles();
    await tools.get("local.system.applescript")!.handler({ script: 'return "x"' }, dummyContext);
    const after = leakedAppleScriptTempFiles();
    expect(after.length).toBe(before.length);
  });

  it("cleans up its temp script file even after a failing run", async () => {
    const tools = setup();
    const before = leakedAppleScriptTempFiles();
    await tools.get("local.system.applescript")!.handler({ script: 'error "boom"' }, dummyContext);
    const after = leakedAppleScriptTempFiles();
    expect(after.length).toBe(before.length);
  });
});
