import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import type { ToolContext, ToolDefinition } from "../src/tools/types.js";
import { registerLocalTools } from "../src/tools/providers/LocalTools.js";
import elevenlabsPlugin from "../plugins/elevenlabs.js";
import sttPlugin from "../plugins/stt.js";

describe("elevenlabs TTS plugin", () => {
  const realKey = process.env.ELEVENLABS_API_KEY;

  afterEach(() => {
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
  });

  it("is registered under the elevenlabs name with speak/speakAndPlay/listVoices", () => {
    expect(elevenlabsPlugin.name).toBe("elevenlabs");
    expect(typeof elevenlabsPlugin.methods.speak).toBe("function");
    expect(typeof elevenlabsPlugin.methods.speakAndPlay).toBe("function");
    expect(typeof elevenlabsPlugin.methods.listVoices).toBe("function");
  });

  it("speak fails with a clear message (not a stack trace) when keyless", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(elevenlabsPlugin.methods.speak!("hello")).rejects.toThrow("ELEVENLABS_API_KEY");
  });

  it("speak rejects empty text without hitting the network", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    await expect(elevenlabsPlugin.methods.speak!("  ")).rejects.toThrow("no text");
  });

  it("listVoices fails with a clear message when keyless", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(elevenlabsPlugin.methods.listVoices!()).rejects.toThrow("ELEVENLABS_API_KEY");
  });

  it("isAvailable returns false (never throws) when keyless", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(elevenlabsPlugin.methods.isAvailable!()).resolves.toBe(false);
  });
});

describe("stt elevenlabs backend", () => {
  const realKey = process.env.ELEVENLABS_API_KEY;
  const realBackend = process.env.STT_BACKEND;

  beforeEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
    if (realBackend === undefined) delete process.env.STT_BACKEND;
    else process.env.STT_BACKEND = realBackend;
  });

  it("transcribe with backend=elevenlabs fails with a clear message when keyless", async () => {
    await expect(sttPlugin.methods.transcribe!("/tmp/does-not-matter.wav", { backend: "elevenlabs" })).rejects.toThrow(
      "ELEVENLABS_API_KEY",
    );
  });

  it("listBackends includes elevenlabs only when a key is configured", async () => {
    const without = (await sttPlugin.methods.listBackends!()) as string[];
    expect(without.some((b) => b.startsWith("elevenlabs"))).toBe(false);

    process.env.ELEVENLABS_API_KEY = "test-key";
    const withKey = (await sttPlugin.methods.listBackends!()) as string[];
    expect(withKey).toContain("elevenlabs (cloud)");
  });

  it("still rejects unknown backends", async () => {
    await expect(sttPlugin.methods.transcribe!("/tmp/x.wav", { backend: "nope" })).rejects.toThrow("Unknown STT backend");
  });
});

describe("local.speech.say elevenlabs backend", () => {
  const dummyContext: ToolContext = { conversationId: "test", timestamp: Date.now() };

  it("passes the config-saved apiKey through to the plugin", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ronin-say-"));
    try {
      const calls: Array<{ plugin: string; method: string; args: unknown[] }> = [];
      const tools = new Map<string, ToolDefinition>();
      const api = {
        config: {
          getSystem: () => ({ dataDir }),
          getAll: () => ({
            speech: {
              tts: { backend: "elevenlabs", elevenlabsApiKey: "cfg-key-123" },
            },
          }),
          getNotifications: () => ({ preferredChat: "auto" }),
        },
        plugins: {
          has: (name: string) => name === "elevenlabs",
          call: async (plugin: string, method: string, ...args: unknown[]) => {
            calls.push({ plugin, method, args });
            return { audioPath: "/tmp/say-test.mp3" };
          },
        },
        ai: {},
      } as unknown as DutyAPI;
      registerLocalTools(api, (tool: ToolDefinition) => tools.set(tool.name, tool));

      const result = await tools.get("local.speech.say")!.handler({ text: "hi" }, dummyContext);
      expect(result.success).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].plugin).toBe("elevenlabs");
      expect(calls[0].method).toBe("speakAndPlay");
      expect((calls[0].args[1] as Record<string, unknown>).apiKey).toBe("cfg-key-123");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
