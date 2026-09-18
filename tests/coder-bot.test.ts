import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import CoderBotDuty from "../duties/coder-bot.js";

interface PluginCall {
  pluginName: string;
  method: string;
  args: unknown[];
}

/**
 * A real (if tiny) in-memory pub/sub, not a no-op mock — coder-bot.ts's own
 * PlanApproved listener (registered in its constructor) has to actually fire
 * when the test "sends" one, and its runCliAndDetectDuty has to actually
 * receive a duty_created/duty_reloaded event fired mid-"execute" call.
 */
function createMockAPI(options: {
  executeImpl?: (pluginName: string, args: unknown[]) => Promise<{ success: boolean; output: string; error?: string }>;
  installedClis?: string[];
} = {}): { api: DutyAPI; emit: (event: string, data: unknown) => void; calls: PluginCall[] } {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const calls: PluginCall[] = [];
  const installed = new Set(options.installedClis ?? ["claude-cli"]);

  const emit = (event: string, data: unknown) => {
    for (const h of Array.from(listeners.get(event) ?? [])) h(data);
  };

  const api = {
    events: {
      on: (event: string, handler: (data: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
      },
      off: (event: string, handler: (data: unknown) => void) => {
        listeners.get(event)?.delete(handler);
      },
      emit: (event: string, data: unknown, _source?: string) => emit(event, data),
    },
    plugins: {
      has: (name: string) => installed.has(name),
      call: async (pluginName: string, method: string, ...args: unknown[]) => {
        calls.push({ pluginName, method, args });
        if (method === "checkInstallation") return true;
        if (method === "execute") {
          const [prompt, execOptions] = args as [string, { workspace: string }];
          if (options.executeImpl) return options.executeImpl(pluginName, [prompt, execOptions]);
          return { success: true, output: "done" };
        }
        return undefined;
      },
    },
    config: {
      getAll: () => ({
        defaultCLI: "claude",
        defaultAppsDirectory: undefined,
        apps: {},
        cliOptions: {},
      }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;

  return { api, emit, calls };
}

async function flush(): Promise<void> {
  // Let queued microtasks (async handlePlanApproved chain) settle.
  await new Promise((r) => setTimeout(r, 50));
}

describe("CoderBotDuty — create-duty wiring", () => {
  it("routes a #duty #create PlanApproved to the CLI with the real duty-authoring prompt and the reviewed draft", async () => {
    const { api, emit, calls } = createMockAPI();
    new CoderBotDuty(api);
    await flush();

    emit("PlanApproved", {
      id: "dprop_1",
      title: "watch-our-design",
      description: "watch our design threads on Discord",
      tags: ["create", "duty"],
      approvedAt: Date.now(),
      draftCode: "export default class WatchOurDesignDuty extends BaseDuty {}",
    });
    await flush();

    const execCall = calls.find((c) => c.method === "execute");
    expect(execCall).toBeDefined();
    const [prompt] = execCall!.args as [string];
    expect(prompt).toContain("Ronin duty files");
    expect(prompt).toContain("watch our design threads on Discord");
    expect(prompt).toContain("WatchOurDesignDuty");
  });

  it("still recognizes the legacy #agent tag as a duty-creation request (not just #duty)", async () => {
    const { api, emit, calls } = createMockAPI();
    new CoderBotDuty(api);
    await flush();

    emit("PlanApproved", {
      id: "dprop_2",
      title: "some-thing",
      description: "do a thing",
      tags: ["create", "agent"],
      approvedAt: Date.now(),
    });
    await flush();

    const execCall = calls.find((c) => c.method === "execute");
    expect(execCall).toBeDefined();
    const [prompt] = execCall!.args as [string];
    expect(prompt).toContain("Ronin duty files");
  });

  it("resolves the default workspace via resolveExternalDutyDir (respects RONIN_EXTERNAL_DUTY_DIR), not a hardcoded ~/.ronin/agents", async () => {
    const originalExternalDutyDir = process.env.RONIN_EXTERNAL_DUTY_DIR;
    process.env.RONIN_EXTERNAL_DUTY_DIR = "/tmp/ronin-coder-bot-test-workspace";
    try {
      const { api, emit, calls } = createMockAPI();
      new CoderBotDuty(api);
      await flush();

      emit("PlanApproved", {
        id: "dprop_3",
        title: "x",
        description: "y",
        tags: ["create", "duty"],
        approvedAt: Date.now(),
      });
      await flush();

      const execCall = calls.find((c) => c.method === "execute");
      const [, execOptions] = execCall!.args as [string, { workspace: string }];
      expect(execOptions.workspace).toBe("/tmp/ronin-coder-bot-test-workspace");
      expect(execOptions.workspace).not.toContain(".ronin/agents");
    } finally {
      if (originalExternalDutyDir === undefined) delete process.env.RONIN_EXTERNAL_DUTY_DIR;
      else process.env.RONIN_EXTERNAL_DUTY_DIR = originalExternalDutyDir;
    }
  });

  it("reports success and the real dutyName when the CLI's write triggers a duty_created event during execution", async () => {
    const workspace = "/tmp/ronin-coder-bot-detect-success";
    const { api, emit, calls } = createMockAPI({
      executeImpl: async (_plugin, [, execOptions]: any) => {
        // Simulate HotReloadService picking up the CLI's file write WHILE the
        // CLI is "running" — this is the realistic timing runCliAndDetectDuty
        // has to handle (listener attached before execute(), event fires
        // during it, not after).
        emit("duty_created", {
          dutyName: "watch-our-design",
          filePath: `${execOptions.workspace}/watch-our-design.ts`,
          routes: ["/watch-our-design"],
        });
        return { success: true, output: "Created watch-our-design.ts" };
      },
    });
    process.env.RONIN_EXTERNAL_DUTY_DIR = workspace;
    try {
      new CoderBotDuty(api);
      await flush();

      const appendedTasks: string[] = [];
      api.events.on("TaskAppendDescription", (data: any) => appendedTasks.push(data.content));
      const completedEvents: any[] = [];
      api.events.on("PlanCompleted", (data: any) => completedEvents.push(data));

      emit("PlanApproved", {
        id: "dprop_4",
        title: "watch-our-design",
        description: "watch our design threads",
        tags: ["create", "duty"],
        approvedAt: Date.now(),
      });
      await flush();

      expect(completedEvents.length).toBe(1);
      expect(completedEvents[0].id).toBe("dprop_4");
      const finalLog = appendedTasks.join("\n");
      expect(finalLog).toContain("watch-our-design");
      expect(finalLog).toContain("SUCCESS");
    } finally {
      delete process.env.RONIN_EXTERNAL_DUTY_DIR;
    }
  });

  it("reports a clear failure (not a false success) when the CLI finishes but no duty_created/duty_reloaded event is observed", async () => {
    const { api, emit } = createMockAPI({
      executeImpl: async () => ({ success: true, output: "did something, unclear what" }),
    });
    process.env.RONIN_EXTERNAL_DUTY_DIR = "/tmp/ronin-coder-bot-detect-failure";
    try {
      new CoderBotDuty(api);
      await flush();

      const appendedTasks: string[] = [];
      api.events.on("TaskAppendDescription", (data: any) => appendedTasks.push(data.content));

      emit("PlanApproved", {
        id: "dprop_5",
        title: "mystery-duty",
        description: "do something",
        tags: ["create", "duty"],
        approvedAt: Date.now(),
      });
      await flush(); // executeImpl resolves immediately
      await new Promise((r) => setTimeout(r, 600)); // past the 500ms grace window

      const finalLog = appendedTasks.join("\n");
      expect(finalLog).toContain("HOT RELOAD: ❌ Failed");
      expect(finalLog).toContain("no duty_created/duty_reloaded event was observed");
    } finally {
      delete process.env.RONIN_EXTERNAL_DUTY_DIR;
    }
  });

  it("ignores PlanApproved payloads with no create/fix/update/build tag", async () => {
    const { api, emit, calls } = createMockAPI();
    new CoderBotDuty(api);
    await flush();

    emit("PlanApproved", {
      id: "dprop_6",
      title: "untagged",
      description: "no tags here",
      tags: [],
      approvedAt: Date.now(),
    });
    await flush();

    expect(calls.some((c) => c.method === "execute")).toBe(false);
  });
});
