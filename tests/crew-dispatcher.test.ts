import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { DutyAPI } from "../src/types/index.js";
import CrewDispatcherDuty from "../duties/crew-dispatcher.js";

interface Emitted {
  event: string;
  data: unknown;
  source: string;
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function createMockAPI(options: {
  crewConfig?: Record<string, unknown>;
  callTools?: (prompt: string, tools: unknown[]) => Promise<{ message: { content: string }; toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> }>;
}): { api: DutyAPI; emitted: Emitted[]; memory: Map<string, unknown> } {
  const emitted: Emitted[] = [];
  const memory = new Map<string, unknown>();
  const api = {
    config: {
      getAll: () => ({
        dispatcher: { crew: { enabled: true, maxWakesPerRun: 3, cooldownMinutes: 60, dryRun: false, ...options.crewConfig } },
      }),
      set: async () => {},
    },
    memory: {
      store: async (key: string, value: unknown) => { memory.set(key, value); },
      retrieve: async (key: string) => memory.get(key),
    },
    events: {
      emit: (event: string, data: unknown, source: string) => { emitted.push({ event, data, source }); },
      on: () => {},
      off: () => {},
    },
    ai: {
      callTools: options.callTools ?? (async () => ({ message: { content: "healthy" }, toolCalls: [] })),
    },
    tools: { getSchemas: () => [], execute: async () => ({ success: true }) },
    plugins: { has: () => false, call: async () => ({}) },
    http: { registerRoute: () => {} },
  } as unknown as DutyAPI;
  return { api, emitted, memory };
}

const ROLLUP = {
  projects: [
    { id: "p1", paused: false, agents: [{ name: "worker", state: "idle", task: null }], tasks: [], review: ["task-9"], questions: [], blocked: [], jobs: [], spend: {} },
  ],
};

describe("crew-dispatcher duty", () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  let fetchCalls: FetchCall[];

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url).endsWith("/dispatcher")) return Response.json(ROLLUP);
      if (String(url).endsWith("/cmd")) return Response.json({ code: 0, out: "Waking worker.", data: null });
      return Response.json({});
    }) as unknown as typeof fetch;
    process.env.CREW_TOKEN = "test-token";
    process.env.CREW_BASE_URL = "http://127.0.0.1:7717";
    delete process.env.RONIN_CREW_DISPATCHER_DISABLED;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("has an hourly static schedule", () => {
    expect((CrewDispatcherDuty as unknown as { schedule: string }).schedule).toBe("0 * * * *");
  });

  it("respects the env kill-switch without touching crew or AI", async () => {
    process.env.RONIN_CREW_DISPATCHER_DISABLED = "true";
    let aiCalled = false;
    const { api, emitted } = createMockAPI({
      callTools: async () => { aiCalled = true; throw new Error("must not be called"); },
    });
    await new CrewDispatcherDuty(api).execute();
    expect(fetchCalls).toHaveLength(0);
    expect(aiCalled).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it("respects dispatcher.crew.enabled=false without touching crew", async () => {
    const { api, emitted } = createMockAPI({ crewConfig: { enabled: false } });
    await new CrewDispatcherDuty(api).execute();
    expect(fetchCalls).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it("no-ops quietly on a healthy sweep: one sense call, one sweep event, no wakes", async () => {
    const { api, emitted, memory } = createMockAPI({});
    await new CrewDispatcherDuty(api).execute();
    expect(fetchCalls.map((c) => c.url)).toEqual(["http://127.0.0.1:7717/dispatcher"]);
    const sweeps = emitted.filter((e) => e.event === "dispatcher.sweep");
    expect(sweeps).toHaveLength(1);
    expect((sweeps[0]!.data as Record<string, unknown>).woke).toBe(0);
    expect(emitted.filter((e) => e.event === "dispatcher.woke")).toHaveLength(0);
    expect(typeof memory.get("crewDispatcher.lastRun")).toBe("number");
  });

  it("wakes through POST /cmd and emits dispatcher.woke", async () => {
    const { api, emitted } = createMockAPI({
      callTools: async () => ({
        message: { content: "wake worker" },
        toolCalls: [{ name: "crew_wake", arguments: { project: "p1", agent: "worker", task: "task-9", reason: "stale review task-9" } }],
      }),
    });
    await new CrewDispatcherDuty(api).execute();
    const cmdCalls = fetchCalls.filter((c) => c.url.endsWith("/cmd"));
    expect(cmdCalls).toHaveLength(1);
    expect(JSON.parse(cmdCalls[0]!.init!.body as string)).toEqual({
      project: "p1",
      argv: ["wake", "worker", "--task", "task-9", "--reason", "dispatcher: stale review task-9"],
    });
    const woke = emitted.filter((e) => e.event === "dispatcher.woke");
    expect(woke).toHaveLength(1);
    expect((woke[0]!.data as Record<string, unknown>).agent).toBe("worker");
  });

  it("caps wakes at maxWakesPerRun", async () => {
    const { api } = createMockAPI({
      crewConfig: { maxWakesPerRun: 1 },
      callTools: async () => ({
        message: { content: "wake two" },
        toolCalls: [
          { name: "crew_wake", arguments: { project: "p1", agent: "a1", reason: "r1" } },
          { name: "crew_wake", arguments: { project: "p1", agent: "a2", reason: "r2" } },
        ],
      }),
    });
    await new CrewDispatcherDuty(api).execute();
    expect(fetchCalls.filter((c) => c.url.endsWith("/cmd"))).toHaveLength(1);
  });

  it("enforces the per-agent cooldown across runs", async () => {
    const { api, memory } = createMockAPI({
      callTools: async () => ({
        message: { content: "wake" },
        toolCalls: [{ name: "crew_wake", arguments: { project: "p1", agent: "worker", reason: "again" } }],
      }),
    });
    const duty = new CrewDispatcherDuty(api);
    await duty.execute();
    expect(fetchCalls.filter((c) => c.url.endsWith("/cmd"))).toHaveLength(1);
    // Second run proposes the same wake — cooldown must suppress the POST.
    await duty.execute();
    expect(fetchCalls.filter((c) => c.url.endsWith("/cmd"))).toHaveLength(1);
    expect((memory.get("crewDispatcher.wakes") as Record<string, number>)["p1/worker"]).toBeGreaterThan(0);
  });

  it("dryRun reasons but never posts wakes", async () => {
    const { api, emitted } = createMockAPI({
      crewConfig: { dryRun: true },
      callTools: async () => ({
        message: { content: "wake" },
        toolCalls: [{ name: "crew_wake", arguments: { project: "p1", agent: "worker", reason: "r" } }],
      }),
    });
    await new CrewDispatcherDuty(api).execute();
    expect(fetchCalls.filter((c) => c.url.endsWith("/cmd"))).toHaveLength(0);
    expect(emitted.filter((e) => e.event === "dispatcher.woke")).toHaveLength(0);
    expect(emitted.filter((e) => e.event === "dispatcher.sweep")).toHaveLength(1);
  });

  it("emits dispatcher.needs_human for human flags", async () => {
    const { api, emitted } = createMockAPI({
      callTools: async () => ({
        message: { content: "flag" },
        toolCalls: [{ name: "flag_needs_human", arguments: { project: "p1", summary: "ambiguous owner", item: "task-9" } }],
      }),
    });
    await new CrewDispatcherDuty(api).execute();
    const flags = emitted.filter((e) => e.event === "dispatcher.needs_human");
    expect(flags).toHaveLength(1);
    expect((flags[0]!.data as Record<string, unknown>).summary).toBe("ambiguous owner");
  });

  it("emits a sweep error (no throw) when crew is unreachable", async () => {
    globalThis.fetch = (async () => { throw new Error("Connection refused"); }) as unknown as typeof fetch;
    const { api, emitted } = createMockAPI({});
    await new CrewDispatcherDuty(api).execute();
    const sweeps = emitted.filter((e) => e.event === "dispatcher.sweep");
    expect(sweeps).toHaveLength(1);
    expect(typeof (sweeps[0]!.data as Record<string, unknown>).error).toBe("string");
  });
});
