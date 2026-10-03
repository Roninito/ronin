import { describe, it, expect } from "bun:test";
import { parseCrewMd, CrewClient } from "../src/dispatcher/crew.js";

const SAMPLE_CREW_MD = `---
api:
  port: 7717
  token: "b2d989a14c86ec72bbfa51c76f585279"
---

# crew machine settings
`;

describe("parseCrewMd", () => {
  it("extracts the machine token and port from crew.md frontmatter", () => {
    const auth = parseCrewMd(SAMPLE_CREW_MD);
    expect(auth.token).toBe("b2d989a14c86ec72bbfa51c76f585279");
    expect(auth.port).toBe(7717);
  });

  it("falls back to port 7717 and an empty token when frontmatter is missing", () => {
    const auth = parseCrewMd("# no frontmatter here\n");
    expect(auth.token).toBe("");
    expect(auth.port).toBe(7717);
  });
});

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json(handler(url, init));
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("CrewClient", () => {
  it("sends the machine token as a Bearer header", async () => {
    const { calls, fetchFn } = stubFetch(() => ({ ok: true, home: "h", pid: 1, projects: 2 }));
    const client = new CrewClient({ baseUrl: "http://127.0.0.1:7717", token: "tok123", fetchFn });
    await client.health();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:7717/health");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
  });

  it("fetches the dispatcher rollup in one call", async () => {
    const rollup = { projects: [{ id: "p1", paused: false, agents: [], tasks: [], review: ["t1"], questions: [], blocked: [], jobs: [], spend: {} }] };
    const { fetchFn } = stubFetch((url) => {
      expect(url).toBe("http://127.0.0.1:7717/dispatcher");
      return rollup;
    });
    const client = new CrewClient({ baseUrl: "http://127.0.0.1:7717", token: "t", fetchFn });
    expect(await client.dispatcher()).toEqual(rollup);
  });

  it("wakes via POST /cmd with crew wake argv", async () => {
    const { calls, fetchFn } = stubFetch(() => ({ code: 0, out: "Waking w.", data: null }));
    const client = new CrewClient({ baseUrl: "http://127.0.0.1:7717", token: "t", fetchFn });
    const result = await client.wake("p1", "worker", { task: "task-1", reason: "stale review" });
    expect(result.out).toBe("Waking w.");
    expect(calls[0]!.url).toBe("http://127.0.0.1:7717/cmd");
    expect(calls[0]!.init!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      project: "p1",
      argv: ["wake", "worker", "--task", "task-1", "--reason", "stale review"],
    });
  });

  it("falls back to /status + per-project calls when /dispatcher 404s (pre-Step-0 service)", async () => {
    const fetchFn = (async (url: string) => {
      if (String(url).endsWith("/dispatcher")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (String(url).endsWith("/status")) {
        return Response.json({
          p1: {
            paused: false,
            agents: [{ name: "worker", state: "idle", task: null }],
            tasks: { open: 2, review: 1 },
            jobs: 0,
            spend: 1.5,
          },
        });
      }
      if (String(url).endsWith("/p/p1/tasks")) {
        return Response.json([
          { id: "task-1", status: "open" },
          { id: "task-9", status: "review" },
          { id: "task-3", status: "blocked" },
          { id: "task-4", status: "open", sampled: true, sampled_ack: false },
        ]);
      }
      if (String(url).endsWith("/p/p1/questions")) {
        return Response.json([{ id: "q-1", status: "open" }]);
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    const client = new CrewClient({ baseUrl: "http://127.0.0.1:7717", token: "t", fetchFn });
    const { rollup, viaFallback } = await client.dispatcherWithFallback();
    expect(viaFallback).toBe(true);
    expect(rollup.projects).toEqual([
      {
        id: "p1",
        paused: false,
        agents: [{ name: "worker", state: "idle", task: null }],
        tasks: { open: 2, review: 1 },
        review: ["task-9", "task-4"],
        questions: ["q-1"],
        blocked: ["task-3"],
        jobs: 0,
        spend: 1.5,
      },
    ]);
  });

  it("rethrows non-404 sense errors instead of falling back", async () => {
    const fetchFn = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const client = new CrewClient({ baseUrl: "http://127.0.0.1:7717", token: "t", fetchFn });
    await expect(client.dispatcherWithFallback()).rejects.toThrow("500");
  });

  it("throws a clear error when crew is unreachable", async () => {
    const fetchFn = (async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;
    const client = new CrewClient({ baseUrl: "http://127.0.0.1:7717", token: "t", fetchFn });
    await expect(client.health()).rejects.toThrow("not reachable");
  });

  it("throws a clear error on non-2xx responses", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    const client = new CrewClient({ baseUrl: "http://127.0.0.1:7717", token: "bad", fetchFn });
    await expect(client.dispatcher()).rejects.toThrow("401");
  });
});
