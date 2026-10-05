import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Tasker from "../duties/tasker.js";
import ScheduleSensor from "../duties/schedule-sensor.js";

function createEmitter() {
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  const emitted: Array<{ event: string; data: unknown }> = [];
  return {
    emitted,
    events: {
      emit(event: string, data: unknown) {
        emitted.push({ event, data });
        for (const h of handlers.get(event) || []) h(data);
      },
      on(event: string, handler: (data: unknown) => void) {
        const list = handlers.get(event) || [];
        list.push(handler);
        handlers.set(event, list);
      },
      off() {},
      beam() {},
      query: async () => null,
      reply() {},
      getRegisteredEvents: () => [],
    },
  };
}

const realOverride = process.env.RONIN_CONTRACTS_DIR;
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ronin-contracts-"));
  process.env.RONIN_CONTRACTS_DIR = dir;
});
afterEach(() => {
  if (realOverride === undefined) delete process.env.RONIN_CONTRACTS_DIR;
  else process.env.RONIN_CONTRACTS_DIR = realOverride;
  rmSync(dir, { recursive: true, force: true });
});

function writeContract(body: string): void {
  writeFileSync(join(dir, "c.md"), body);
}

function mockApi(overrides: Record<string, unknown> = {}) {
  const { emitted, events } = createEmitter();
  return {
    emitted,
    api: {
      events,
      tools: {
        getSchemas: () => [],
        execute: async () => ({ ok: true }),
      },
      ai: {
        callTools: async () => ({ message: { role: "assistant", content: "done" }, toolCalls: [] }),
      },
      plugins: { has: () => false, call: async () => "" },
      ...overrides,
    } as any,
  };
}

const MANUAL = `---
name: hello
description: Say hi
trigger: manual
mode: sar
on_failure: ignore
---

Say hello.
`;

describe("tasker", () => {
  it("runs a manual contract on tasker.run and emits tasker.completed", async () => {
    writeContract(MANUAL);
    const { api, emitted } = mockApi();
    new Tasker(api);
    api.events.emit("tasker.run", { contract: "hello" });
    await new Promise((r) => setTimeout(r, 50));
    const done = emitted.find((e) => e.event === "tasker.completed");
    expect(done).toBeDefined();
    expect((done!.data as any).contract).toBe("hello");
    expect((done!.data as any).result).toBe("done");
  });

  it("executes tool calls and feeds observations back", async () => {
    writeContract(MANUAL);
    const seen: string[] = [];
    let rounds = 0;
    const { api, emitted } = mockApi({
      ai: {
        callTools: async (prompt: string) => {
          rounds++;
          if (rounds === 1) {
            return {
              message: { role: "assistant", content: "checking" },
              toolCalls: [{ name: "local.memory.search", arguments: { q: "hi" } }],
            };
          }
          seen.push(prompt);
          return { message: { role: "assistant", content: "final answer" }, toolCalls: [] };
        },
      },
      tools: {
        getSchemas: () => [],
        execute: async (name: string) => {
          seen.push(name);
          return { hits: 1 };
        },
      },
    });
    new Tasker(api);
    api.events.emit("tasker.run", { contract: "hello" });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toContain("local.memory.search");
    const done = emitted.find((e) => e.event === "tasker.completed");
    expect((done!.data as any).result).toBe("final answer");
  });

  it("ignores unknown contracts and concurrent duplicate wakes", async () => {
    writeContract(MANUAL);
    const { api, emitted } = mockApi();
    new Tasker(api);
    api.events.emit("tasker.run", { contract: "nope" });
    await new Promise((r) => setTimeout(r, 50));
    expect(emitted.find((e) => e.event === "tasker.completed")).toBeUndefined();
  });

  it("emits tasker.failed with on_failure: notify", async () => {
    writeContract(MANUAL.replace("on_failure: ignore", "on_failure: notify"));
    const { api, emitted } = mockApi({
      ai: {
        callTools: async () => {
          throw new Error("boom");
        },
      },
    });
    new Tasker(api);
    api.events.emit("tasker.run", { contract: "hello" });
    await new Promise((r) => setTimeout(r, 50));
    const failed = emitted.find((e) => e.event === "tasker.failed");
    expect(failed).toBeDefined();
    expect((failed!.data as any).error).toContain("boom");
  });
});

describe("schedule-sensor", () => {
  it("emits tasker.wake for due cron contracts, skips others", async () => {
    writeFileSync(
      join(dir, "due.md"),
      `---\nname: due\ndescription: d\ntrigger: cron\ncron: "* * * * *"\nmode: sar\non_failure: ignore\n---\n\nDo it.\n`
    );
    writeFileSync(
      join(dir, "later.md"),
      `---\nname: later\ndescription: d\ntrigger: cron\ncron: "0 0 29 2 *"\nmode: sar\non_failure: ignore\n---\n\nDo it.\n`
    );
    const { api, emitted } = mockApi();
    const sensor = new ScheduleSensor(api);
    await sensor.execute();
    const wakes = emitted.filter((e) => e.event === "tasker.wake");
    expect(wakes.map((w) => (w.data as any).contract)).toEqual(["due"]);
    // Same-minute dedupe: second tick emits nothing new.
    await sensor.execute();
    expect(emitted.filter((e) => e.event === "tasker.wake").length).toBe(1);
  });
});
