import { describe, it, expect, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import type { ToolContext, ToolDefinition } from "../src/tools/types.js";
import { registerLocalTools } from "../src/tools/providers/LocalTools.js";

const dummyContext: ToolContext = { conversationId: "test", timestamp: Date.now() };

function setup(options: {
  dataDir: string;
  screenCaptureEnabled?: boolean;
  hasScreenshotPlugin?: boolean;
  pluginCall?: (method: string, args: unknown[]) => Promise<unknown>;
}) {
  const tools = new Map<string, ToolDefinition>();
  const register = (tool: ToolDefinition) => tools.set(tool.name, tool);

  const api = {
    config: {
      getSystem: () => ({ dataDir: options.dataDir }),
      getAll: () => ({
        desktop: { features: { screenCapture: options.screenCaptureEnabled ?? true } },
      }),
      getNotifications: () => ({ preferredChat: "auto" }),
    },
    plugins: {
      has: (name: string) => (name === "screenshot" ? (options.hasScreenshotPlugin ?? true) : false),
      call: async (_pluginName: string, method: string, ...args: unknown[]) => {
        if (options.pluginCall) return options.pluginCall(method, args);
        throw new Error("unexpected plugin call in test");
      },
    },
    ai: {},
  } as unknown as DutyAPI;

  registerLocalTools(api, register);
  return { tools };
}

describe("local.screen.capture", () => {
  it("registers the tool with medium risk", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      const { tools } = setup({ dataDir });
      const tool = tools.get("local.screen.capture")!;
      expect(tool).toBeDefined();
      expect(tool.riskLevel).toBe("medium");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("creates the ephemeral screenshots directory under dataDir/tmp/screenshots at registration", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      setup({ dataDir });
      expect(existsSync(join(dataDir, "tmp", "screenshots"))).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("returns disabled error when desktop.features.screenCapture is false", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      const { tools } = setup({ dataDir, screenCaptureEnabled: false });
      const result = await tools.get("local.screen.capture")!.handler({ mode: "full" }, dummyContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("disabled");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("returns a clear error when the screenshot plugin isn't loaded", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      const { tools } = setup({ dataDir, hasScreenshotPlugin: false });
      const result = await tools.get("local.screen.capture")!.handler({ mode: "full" }, dummyContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not loaded");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("calls the plugin, registers the resulting path for TTL cleanup, and returns path + expiresAt", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      let capturedPath = "";
      const { tools } = setup({
        dataDir,
        pluginCall: async (method, args) => {
          expect(method).toBe("captureFullScreen");
          capturedPath = args[0] as string;
          writeFileSync(capturedPath, "fake png");
          return { path: capturedPath, format: "png", capturedAt: Date.now() };
        },
      });

      const before = Date.now();
      const result = await tools.get("local.screen.capture")!.handler({ mode: "full" }, dummyContext);
      expect(result.success).toBe(true);
      expect((result.data as any).path).toBe(capturedPath);
      expect((result.data as any).expiresAt).toBeGreaterThan(before);
      expect(capturedPath.startsWith(join(dataDir, "tmp", "screenshots"))).toBe(true);

      // TTL registration happened — file should still exist immediately...
      expect(existsSync(capturedPath)).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("surfaces plugin/cancellation errors as a failed ToolResult, not a throw", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      const { tools } = setup({
        dataDir,
        pluginCall: async () => {
          throw new Error("Screenshot cancelled or failed — no image was captured.");
        },
      });

      const result = await tools.get("local.screen.capture")!.handler({ mode: "region" }, dummyContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("cancelled");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("local.vision.analyze", () => {
  it("delegates to api.ai.analyzeImage and returns its answer", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      const tools = new Map<string, ToolDefinition>();
      const register = (tool: ToolDefinition) => tools.set(tool.name, tool);
      const analyzeImage = mock(async (_path: string, _prompt: string) => "a description");

      const api = {
        config: {
          getSystem: () => ({ dataDir }),
          getAll: () => ({ desktop: { features: { screenCapture: true } } }),
          getNotifications: () => ({ preferredChat: "auto" }),
        },
        plugins: { has: () => false, call: async () => undefined },
        ai: { analyzeImage },
      } as unknown as DutyAPI;

      registerLocalTools(api, register);
      const result = await tools.get("local.vision.analyze")!.handler(
        { imagePath: "/tmp/shot.png", prompt: "what is this?" },
        dummyContext,
      );

      expect(analyzeImage).toHaveBeenCalledWith("/tmp/shot.png", "what is this?");
      expect(result.success).toBe(true);
      expect((result.data as any).answer).toBe("a description");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("returns a failed ToolResult when no vision model is configured", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-lt-"));
    try {
      const tools = new Map<string, ToolDefinition>();
      const register = (tool: ToolDefinition) => tools.set(tool.name, tool);

      const api = {
        config: {
          getSystem: () => ({ dataDir }),
          getAll: () => ({ desktop: { features: { screenCapture: true } } }),
          getNotifications: () => ({ preferredChat: "auto" }),
        },
        plugins: { has: () => false, call: async () => undefined },
        ai: {
          analyzeImage: async () => {
            throw new Error("No vision-capable model configured.");
          },
        },
      } as unknown as DutyAPI;

      registerLocalTools(api, register);
      const result = await tools.get("local.vision.analyze")!.handler(
        { imagePath: "/tmp/shot.png", prompt: "what is this?" },
        dummyContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No vision-capable model configured");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
