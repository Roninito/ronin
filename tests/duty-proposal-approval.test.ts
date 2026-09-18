import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { DutyProposalStorage } from "../src/duty/proposal-storage.js";
import DutyExecutorAgent from "../duties/duty-executor.js";

const VALID_CODE = `import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

export default class WatchOurDesignDuty extends BaseDuty {
  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // watches design threads
  }
}
`;

function createMockAPI(): {
  api: DutyAPI;
  routes: Map<string, (req: Request) => Response | Promise<Response>>;
  emittedEvents: Array<{ event: string; data: unknown }>;
} {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const emittedEvents: Array<{ event: string; data: unknown }> = [];

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
        emittedEvents.push({ event, data });
      },
      on: () => {},
      off: () => {},
      beam: () => {},
      query: async () => undefined,
      reply: () => {},
      getRegisteredEvents: () => [],
    },
    getAgents: () => [],
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;

  return { api, routes, emittedEvents };
}

function postJson(body: unknown): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// handleApproveProposal calls resolveExternalDutyDir(), which resolves to
// ~/.ronin/duties (os.homedir()-based) unless RONIN_EXTERNAL_DUTY_DIR is
// set — a chdir alone doesn't isolate it, and overriding process.env.HOME
// doesn't work either (Bun's os.homedir() doesn't re-read it at runtime,
// unlike Node's). Set RONIN_EXTERNAL_DUTY_DIR itself instead, so approval
// never writes into the real ~/.ronin/duties.
describe("Duty proposal approve/refuse routes", () => {
  let api: DutyAPI;
  let routes: Map<string, (req: Request) => Response | Promise<Response>>;
  let emittedEvents: Array<{ event: string; data: unknown }>;
  let storage: DutyProposalStorage;
  let scratchDir: string;
  let originalCwd: string;
  let originalExternalDutyDir: string | undefined;

  beforeEach(async () => {
    // realpathSync: macOS's tmpdir() returns a /var/folders path that's
    // actually a symlink to /private/var/folders — resolve it up front so
    // join(scratchDir, ...) matches what process.cwd() reports after chdir.
    scratchDir = realpathSync(mkdtempSync(join(tmpdir(), "ronin-duty-approval-")));
    originalCwd = process.cwd();
    process.chdir(scratchDir);
    originalExternalDutyDir = process.env.RONIN_EXTERNAL_DUTY_DIR;
    process.env.RONIN_EXTERNAL_DUTY_DIR = join(scratchDir, "duties");

    ({ api, routes, emittedEvents } = createMockAPI());
    await runEngineMigrations((api as any).db);
    storage = new DutyProposalStorage(api);
    new DutyExecutorAgent(api); // registers routes in its constructor
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalExternalDutyDir === undefined) {
      delete process.env.RONIN_EXTERNAL_DUTY_DIR;
    } else {
      process.env.RONIN_EXTERNAL_DUTY_DIR = originalExternalDutyDir;
    }
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("approve: hands off to coder-bot via PlanProposed+PlanApproved instead of writing the file itself, marks the proposal approved", async () => {
    const rec = await storage.create({
      intent: "watch our design threads",
      dutyName: "watch-our-design",
      code: VALID_CODE,
      preview: "Creates duty 'watch-our-design' — watch our design threads",
    });

    const handler = routes.get("/api/duties/proposals/approve")!;
    const res = await handler(postJson({ id: rec.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.dutyName).toBe("watch-our-design");

    // The draft's single api.ai.complete() code has no compile-check or
    // self-correction loop — approval must NOT write it straight to disk
    // anymore. The real implementation comes from coder-bot.ts's CLI spawn,
    // triggered by the events below, not from this handler.
    const filePath = join(scratchDir, "duties", "watch-our-design.ts");
    expect(existsSync(filePath)).toBe(false);

    const proposedEvent = emittedEvents.find((e) => e.event === "PlanProposed");
    expect(proposedEvent).toBeDefined();
    expect((proposedEvent!.data as any).id).toBe(rec.id);
    expect((proposedEvent!.data as any).title).toBe("watch-our-design");
    expect((proposedEvent!.data as any).description).toBe("watch our design threads");
    expect((proposedEvent!.data as any).tags).toEqual(["create", "duty"]);

    const approvedPlanEvent = emittedEvents.find((e) => e.event === "PlanApproved");
    expect(approvedPlanEvent).toBeDefined();
    expect((approvedPlanEvent!.data as any).id).toBe(rec.id);
    expect((approvedPlanEvent!.data as any).draftCode).toBe(VALID_CODE);
    expect((approvedPlanEvent!.data as any).tags).toEqual(["create", "duty"]);

    const approvedEvent = emittedEvents.find((e) => e.event === "duty.proposal_approved");
    expect(approvedEvent).toBeDefined();

    const proposalRow = await storage.getById(rec.id);
    expect(proposalRow?.status).toBe("approved");
  });

  it("refuse: writes nothing and marks the proposal refused", async () => {
    const rec = await storage.create({
      intent: "watch our design threads",
      dutyName: "watch-our-design",
      code: VALID_CODE,
      preview: "preview",
    });

    const handler = routes.get("/api/duties/proposals/refuse")!;
    const res = await handler(postJson({ id: rec.id }));
    expect(res.status).toBe(200);

    const filePath = join(scratchDir, "duties", "watch-our-design.ts");
    expect(existsSync(filePath)).toBe(false);

    const proposalRow = await storage.getById(rec.id);
    expect(proposalRow?.status).toBe("refused");
  });

  it("approving twice returns 409 the second time and does not double-write", async () => {
    const rec = await storage.create({
      intent: "x",
      dutyName: "watch-our-design",
      code: VALID_CODE,
      preview: "p",
    });
    const handler = routes.get("/api/duties/proposals/approve")!;

    const first = await handler(postJson({ id: rec.id }));
    expect(first.status).toBe(200);

    const second = await handler(postJson({ id: rec.id }));
    expect(second.status).toBe(409);
  });

  it("approve re-validates the code and refuses to write structurally invalid duty code", async () => {
    const rec = await storage.create({
      intent: "x",
      dutyName: "bad-duty",
      code: "export default class Foo {}", // no extends BaseDuty, no execute()
      preview: "p",
    });

    const handler = routes.get("/api/duties/proposals/approve")!;
    const res = await handler(postJson({ id: rec.id }));
    expect(res.status).toBe(422);

    const filePath = join(scratchDir, "duties", "bad-duty.ts");
    expect(existsSync(filePath)).toBe(false);
    // Validation fails before hand-off — coder-bot.ts must never be triggered
    // for a proposal this structurally broken.
    expect(emittedEvents.some((e) => e.event === "PlanProposed" || e.event === "PlanApproved")).toBe(false);
  });

  it("GET /api/duties/proposals lists only pending proposals", async () => {
    await storage.create({ intent: "a", dutyName: "duty-a", code: VALID_CODE, preview: "pa" });
    const b = await storage.create({ intent: "b", dutyName: "duty-b", code: VALID_CODE, preview: "pb" });
    await storage.decide(b.id, "refused");

    const handler = routes.get("/api/duties/proposals")!;
    const res = await handler(new Request("http://localhost/x"));
    const body = await res.json();
    expect(body.proposals.length).toBe(1);
    expect(body.proposals[0].intent).toBe("a");
  });
});

describe("GET /duties/review dashboard page", () => {
  let api: DutyAPI;
  let routes: Map<string, (req: Request) => Response | Promise<Response>>;
  let storage: DutyProposalStorage;
  let scratchDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    scratchDir = realpathSync(mkdtempSync(join(tmpdir(), "ronin-duty-review-")));
    originalCwd = process.cwd();
    process.chdir(scratchDir);

    ({ api, routes } = createMockAPI());
    await runEngineMigrations((api as any).db);
    storage = new DutyProposalStorage(api);
    new DutyExecutorAgent(api);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("renders pending proposals with escaped code and an empty state when there are none", async () => {
    const handler = routes.get("/duties/review")!;
    const emptyHtml = await (await handler(new Request("http://localhost/duties/review"))).text();
    expect(emptyHtml).toContain("No pending proposals");
    expect(emptyHtml).toContain("No duties loaded");

    await storage.create({
      intent: "test",
      dutyName: "watch-our-design",
      code: `${VALID_CODE}\n// <script>alert(1)</script>`,
      preview: "Creates duty 'watch-our-design'",
    });
    const html = await (await handler(new Request("http://localhost/duties/review"))).text();
    expect(html).toContain("proposal-card");
    expect(html).toContain("Creates duty");
    expect(html).toContain("decideProposal(");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("embeds a syntactically valid approve/refuse script", async () => {
    const handler = routes.get("/duties/review")!;
    const html = await (await handler(new Request("http://localhost/duties/review"))).text();
    const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const script = scriptBlocks.find((s) => s.includes("decideProposal"));
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
    expect(script).toContain("function decideProposal");
  });
});
