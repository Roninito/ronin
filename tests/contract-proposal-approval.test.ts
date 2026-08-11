import { describe, it, expect, beforeEach } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { ContractProposalStorage } from "../src/contract/proposal-storage.js";
import { ContractStorageV2 } from "../src/contract/storage-v2.js";
import ContractExecutorAgent from "../duties/contract-executor.js";
import type { ContractV2Definition } from "../src/types/shared.js";

const SAMPLE_CONTRACT: ContractV2Definition = {
  name: "quiet-handoff-reflex",
  version: "v1",
  description: "test",
  targetKata: "quiet.handoff",
  targetKataVersion: "v1",
  parameters: {},
  triggerType: "event",
  triggerConfig: { type: "event", eventType: "trust.changed" },
  onFailureAction: "ignore",
  enabled: true,
};

const KATA_DSL = "kata quiet.handoff v1\n  requires skill notify.user\n\n  initial notify\n\n  phase notify\n    run skill notify.user\n    complete\n";

function createMockAPI(): { api: DutyAPI; routes: Map<string, (req: Request) => Response | Promise<Response>> } {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  const api = {
    db: {
      query: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.all(...params) : stmt.all();
      },
      execute: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.run(...params) : stmt.run();
      },
    },
    http: {
      registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
        routes.set(path, handler);
      },
    },
    tools: {
      register: () => {},
    },
    events: {
      emit: (event: string, data: unknown, _source: string) => {
        for (const handler of [...(listeners.get(event) ?? [])]) handler(data);
      },
      on: (event: string, handler: (data: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
      },
      off: (event: string, handler: (data: unknown) => void) => {
        listeners.get(event)?.delete(handler);
      },
      beam: () => {},
      query: async () => undefined,
      reply: () => {},
      getRegisteredEvents: () => [],
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;

  return { api, routes };
}

function postJson(body: unknown): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("ContractProposalStorage", () => {
  let api: DutyAPI;
  let storage: ContractProposalStorage;

  beforeEach(async () => {
    ({ api } = createMockAPI());
    await runEngineMigrations((api as any).db);
    storage = new ContractProposalStorage(api);
  });

  it("creates a pending proposal and lists it", async () => {
    const rec = await storage.create({ intent: "test intent", contract: SAMPLE_CONTRACT, preview: "Fires when..." });
    expect(rec.status).toBe("pending");

    const pending = await storage.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(rec.id);
    expect(pending[0].contract.name).toBe("quiet-handoff-reflex");
  });

  it("marks a superseded proposal when a revision is created", async () => {
    const original = await storage.create({ intent: "v1", contract: SAMPLE_CONTRACT, preview: "p1" });
    const revised = await storage.create({
      intent: "v2 — only when rival is also close",
      contract: SAMPLE_CONTRACT,
      preview: "p2",
      supersedesId: original.id,
    });

    const originalRow = await storage.getById(original.id);
    expect(originalRow?.status).toBe("superseded");

    const pending = await storage.listPending();
    expect(pending.map((p) => p.id)).toEqual([revised.id]);
  });

  it("decide() moves a proposal out of pending", async () => {
    const rec = await storage.create({ intent: "test", contract: SAMPLE_CONTRACT, preview: "p" });
    await storage.decide(rec.id, "refused");

    const row = await storage.getById(rec.id);
    expect(row?.status).toBe("refused");
    expect(row?.decidedAt).not.toBeNull();
    expect(await storage.listPending()).toEqual([]);
  });
});

describe("Contract proposal approve/refuse routes", () => {
  let api: DutyAPI;
  let routes: Map<string, (req: Request) => Response | Promise<Response>>;
  let storage: ContractProposalStorage;

  beforeEach(async () => {
    ({ api, routes } = createMockAPI());
    await runEngineMigrations((api as any).db);
    storage = new ContractProposalStorage(api);
    new ContractExecutorAgent(api); // registers routes in its constructor
  });

  it("approve: registers the kata (if any) and the contract enabled, marks the proposal approved", async () => {
    const rec = await storage.create({
      intent: "when trust drops, quietly hand off",
      contract: SAMPLE_CONTRACT,
      kataDsl: KATA_DSL,
      preview: "Fires when trust.changed → drafts a new kata 'quiet.handoff'",
    });

    const handler = routes.get("/api/contracts/proposals/approve")!;
    const res = await handler(postJson({ id: rec.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const contractStorage = new ContractStorageV2(api);
    const contractRow = await contractStorage.getByName("quiet-handoff-reflex");
    expect(contractRow).not.toBeNull();
    expect(contractRow?.enabled).toBe(1);

    const proposalRow = await storage.getById(rec.id);
    expect(proposalRow?.status).toBe("approved");
  });

  it("refuse: leaves nothing registered", async () => {
    const rec = await storage.create({
      intent: "when trust drops, quietly hand off",
      contract: SAMPLE_CONTRACT,
      kataDsl: KATA_DSL,
      preview: "preview",
    });

    const handler = routes.get("/api/contracts/proposals/refuse")!;
    const res = await handler(postJson({ id: rec.id }));
    expect(res.status).toBe(200);

    const contractStorage = new ContractStorageV2(api);
    expect(await contractStorage.getByName("quiet-handoff-reflex")).toBeNull();

    const proposalRow = await storage.getById(rec.id);
    expect(proposalRow?.status).toBe("refused");
  });

  it("approving twice returns 409 the second time and does not double-register", async () => {
    const rec = await storage.create({ intent: "x", contract: SAMPLE_CONTRACT, preview: "p" });
    const handler = routes.get("/api/contracts/proposals/approve")!;

    const first = await handler(postJson({ id: rec.id }));
    expect(first.status).toBe(200);

    const second = await handler(postJson({ id: rec.id }));
    expect(second.status).toBe(409);
  });

  it("GET /api/contracts/proposals lists only pending proposals", async () => {
    await storage.create({ intent: "a", contract: SAMPLE_CONTRACT, preview: "pa" });
    const b = await storage.create({ intent: "b", contract: { ...SAMPLE_CONTRACT, name: "other" }, preview: "pb" });
    await storage.decide(b.id, "refused");

    const handler = routes.get("/api/contracts/proposals")!;
    const res = await handler(new Request("http://localhost/x"));
    const body = await res.json();
    expect(body.proposals.length).toBe(1);
    expect(body.proposals[0].intent).toBe("a");
  });
});

describe("GET /contracts dashboard review page", () => {
  let api: DutyAPI;
  let routes: Map<string, (req: Request) => Response | Promise<Response>>;
  let storage: ContractProposalStorage;

  beforeEach(async () => {
    ({ api, routes } = createMockAPI());
    await runEngineMigrations((api as any).db);
    storage = new ContractProposalStorage(api);
    new ContractExecutorAgent(api);
  });

  it("renders active contracts with a deterministic (never raw-JSON) trigger description", async () => {
    const contractStorage = new ContractStorageV2(api);
    await contractStorage.create({
      ...SAMPLE_CONTRACT,
      name: "trusted-<script>alert(1)</script>", // also exercises HTML-escaping
      triggerType: "event",
      triggerConfig: {
        type: "event",
        eventType: "trust.changed",
        condition: { variable: "trust_level", operator: "<", value: 40 },
      },
    });

    const handler = routes.get("/contracts")!;
    const res = await handler(new Request("http://localhost/contracts"));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("trust_level &lt; 40");
    expect(html).toContain("when trust.changed fires");
    expect(html).not.toContain("<script>alert(1)</script>"); // must be escaped, not injected raw
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders pending proposals as cards and an empty state when there are none", async () => {
    const handlerEmpty = routes.get("/contracts")!;
    const emptyHtml = await (await handlerEmpty(new Request("http://localhost/contracts"))).text();
    expect(emptyHtml).toContain("No pending proposals");
    expect(emptyHtml).toContain("No contracts registered yet");

    await storage.create({ intent: "test", contract: SAMPLE_CONTRACT, preview: "Fires when trust.changed → runs kata 'quiet.handoff'" });
    const html = await (await handlerEmpty(new Request("http://localhost/contracts"))).text();
    expect(html).toContain("proposal-card");
    expect(html).toContain("Fires when trust.changed");
    expect(html).toContain("decideProposal(");
  });

  it("embeds a syntactically valid approve/refuse script", async () => {
    const handler = routes.get("/contracts")!;
    const html = await (await handler(new Request("http://localhost/contracts"))).text();
    const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const script = scriptBlocks.find((s) => s.includes("decideProposal"));
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
    expect(script).toContain("function decideProposal");
  });
});
