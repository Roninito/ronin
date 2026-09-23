/**
 * SAR envelope integration test for DutyRegistry.executeDuty().
 *
 * Verifies:
 * - Sense/Act/Report phases run through the runner-applied envelope.
 * - The prepared ChainContext reaches duty.execute(ctx).
 * - Report middleware produces a non-empty ctx.report artifact.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DutyRegistry } from "../src/duty/DutyRegistry.js";
import { BaseDuty } from "../src/duty/Duty.js";
import { FilesAPI } from "../src/api/files.js";
import { HTTPAPI } from "../src/api/http.js";
import type { DutyAPI, ChainContext } from "../src/types/index.js";

const TEST_HOME = mkdtempSync(join(tmpdir(), "ronin-dutyregistry-sar-report-"));

class EchoDuty extends BaseDuty {
  receivedContext?: ChainContext;
  didWork = false;

  async execute(ctx?: ChainContext): Promise<void> {
    this.receivedContext = ctx;
    this.didWork = true;

    if (ctx) {
      ctx.messages.push({
        role: "assistant",
        content: `EchoDuty ran for ${ctx.metadata?.dutyName ?? "unknown"}`,
      });
      ctx.messages.push({
        role: "tool",
        name: "echo.mock",
        content: JSON.stringify({ success: true, data: { mocked: true } }),
      });
    }
  }
}

class SilentDuty extends BaseDuty {
  receivedContext?: ChainContext;

  async execute(_ctx?: ChainContext): Promise<void> {
    // Parameterless-style subclass still valid with optional ctx.
    this.receivedContext = _ctx;
  }
}

function buildApi(): DutyAPI {
  const stored: Record<string, unknown> = {};
  const emitted: { event: string; data: unknown; source: string }[] = [];

  return {
    ai: {
      complete: async () => "",
      stream: async function* () {},
      chat: async () => ({ role: "assistant", content: "" }),
      streamChat: async function* () {},
      callTools: async () => ({ message: { role: "assistant", content: "" }, toolCalls: [] }),
      checkModel: async () => true,
      analyzeImage: async () => "",
    },
    memory: {
      store: async (key: string, value: unknown) => {
        stored[key] = value;
      },
      retrieve: async () => undefined,
      search: async () => [],
      addContext: async () => "",
      getRecent: async () => [],
      forget: async () => true,
      forgetByKeyPrefix: async () => 0,
      countByKeyPrefix: async () => 0,
      addConversation: async () => "",
      getConversations: async () => [],
      getBlackboard: async () => "",
      setBlackboard: async () => {},
      appendBlackboard: async () => {},
      getRootDir: () => TEST_HOME,
    },
    files: new FilesAPI(),
    db: {
      query: async () => [],
      execute: async () => {},
      transaction: async (fn) => fn({ query: async () => [], execute: async () => {} } as any),
    },
    http: new HTTPAPI(),
    events: {
      emit: (event: string, data: unknown, source: string) => {
        emitted.push({ event, data, source });
      },
      on: () => {},
      off: () => {},
      beam: () => {},
      query: async () => undefined,
      reply: () => {},
      getRegisteredEvents: () => [],
    },
    plugins: {
      call: async () => undefined,
      has: () => false,
      list: () => [],
    },
    config: {
      get: () => undefined,
      getAll: () => ({}),
      getTelegram: () => ({}),
      getDiscord: () => ({}),
      getAI: () => ({ defaultModel: "claude-haiku" }),
      getGemini: () => ({}),
      getGrok: () => ({}),
      getBraveSearch: () => ({}),
      getSystem: () => ({}),
      getCLIOptions: () => ({}),
      getEventMonitor: () => ({}),
      getBlogBoy: () => ({}),
      getConfigEditor: () => ({}),
      getRssToTelegram: () => ({}),
      getRealm: () => ({}),
      getMesh: () => ({}),
      getMCP: () => ({}),
      getNotifications: () => ({}),
      isFromEnv: () => false,
      reload: async () => {},
      set: () => {},
    },
    tools: {
      list: () => [],
      getSchemas: () => [],
      execute: async () => ({ success: true, data: {} }),
      register: () => {},
    },
  } as unknown as DutyAPI;
}

describe("DutyRegistry.executeDuty() SAR envelope", () => {
  let scratchDir: string;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("passes ChainContext into execute(ctx) and produces a non-empty report artifact", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-duty-sar-"));

    const registry = new DutyRegistry({ files: new FilesAPI(), http: new HTTPAPI() });
    const api = buildApi();
    const duty = new EchoDuty(api);

    registry.register({
      name: "echo-duty",
      filePath: join(scratchDir, "echo-duty.ts"),
      description: "SAR envelope test duty",
      instance: duty,
    });

    await registry.executeDuty("echo-duty");

    expect(duty.didWork).toBe(true);
    expect(duty.receivedContext).toBeDefined();
    expect(duty.receivedContext!.metadata?.dutyName).toBe("echo-duty");
    expect(Array.isArray(duty.receivedContext!.messages)).toBe(true);

    // Report middleware should have finalized ctx.report.
    expect(duty.receivedContext!.report).toBeDefined();
    expect(duty.receivedContext!.report!.dutyName).toBe("echo-duty");
    expect(duty.receivedContext!.report!.summary.length).toBeGreaterThan(0);
    expect(duty.receivedContext!.report!.durationMs).toBeGreaterThanOrEqual(0);
    expect(duty.receivedContext!.report!.toolCalls?.length).toBe(1);
    expect(duty.receivedContext!.report!.toolCalls![0].name).toBe("echo.mock");
    expect(duty.receivedContext!.report!.toolCalls![0].success).toBe(true);
    expect(duty.receivedContext!.report!.finalContent).toContain("EchoDuty ran for echo-duty");
    expect(duty.receivedContext!.report!.memoryKey).toMatch(/^sar:report:echo-duty:/);
    expect(duty.receivedContext!.report!.eventEmitted).toEqual({ type: "duty.reported", ok: true });
  });

  it("still works for parameterless execute() subclasses (backward compatible overload)", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-duty-sar-compat-"));

    const registry = new DutyRegistry({ files: new FilesAPI(), http: new HTTPAPI() });
    const api = buildApi();
    const duty = new SilentDuty(api);

    registry.register({
      name: "silent-duty",
      filePath: join(scratchDir, "silent-duty.ts"),
      description: "Backward-compatible duty",
      instance: duty,
    });

    await registry.executeDuty("silent-duty");

    expect(duty.receivedContext).toBeDefined();
    expect(duty.receivedContext!.metadata?.dutyName).toBe("silent-duty");
    expect(duty.receivedContext!.report).toBeDefined();
    expect(duty.receivedContext!.report!.summary).toContain('"silent-duty" completed');
  });
});
