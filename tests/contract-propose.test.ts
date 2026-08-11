import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { KataRegistry } from "../src/kata/registry.js";
import { proposeContract, ContractProposeError } from "../src/contract/propose.js";

const NEW_KATA_DSL = `kata quiet.handoff v1
  requires skill notify.user

  initial notify

  phase notify
    run skill notify.user
    complete
`;

async function createMockAPI(aiResponse: string): Promise<DutyAPI> {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");

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
    ai: {
      complete: async (_prompt: string) => aiResponse,
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;

  await runEngineMigrations((api as any).db);
  return api;
}

async function registerFinanceAuditKata(api: DutyAPI): Promise<void> {
  const registry = new KataRegistry(api);
  await registry.register(
    "kata finance.audit v1\n  requires skill finance.extract\n\n  initial check\n\n  phase check\n    run skill finance.extract\n    complete\n"
  );
}

describe("proposeContract", () => {
  it("drafts a contract targeting a new inline kata when the AI proposes one", async () => {
    const aiResponse = JSON.stringify({
      name: "quiet-handoff-reflex",
      description: "Quietly hand off when trust drops and a rival is near",
      triggerType: "event",
      triggerConfig: {
        type: "event",
        eventType: "trust.changed",
        condition: {
          type: "AND",
          conditions: [
            { variable: "trust_level", operator: "<", value: 40 },
            { variable: "rival.distance", operator: "<", value: 50 },
          ],
        },
      },
      existingKataName: null,
      existingKataVersion: null,
      newKataDsl: NEW_KATA_DSL,
    });

    const api = await createMockAPI(aiResponse);
    const proposal = await proposeContract("when trust drops below 40 and a rival is nearby, do a quiet handoff, then notify me", api);

    expect(proposal.contract.name).toBe("quiet-handoff-reflex");
    expect(proposal.contract.targetKata).toBe("quiet.handoff");
    expect(proposal.contract.triggerType).toBe("event");
    expect(proposal.kataDsl).toBe(NEW_KATA_DSL);
    expect(proposal.kataCompiled).toBeDefined();
    // Preview must be plain language, never the raw JSON — this is the entire
    // safety net for the approval card (see plan Phase C).
    expect(proposal.preview).not.toContain("{");
    expect(proposal.preview).toContain("trust_level < 40");
    expect(proposal.preview).toContain("rival.distance < 50");
    expect(proposal.preview).toContain("quiet.handoff");
  });

  it("targets an existing registered kata when the AI names one that's actually registered", async () => {
    const api = await createMockAPI("placeholder");
    await registerFinanceAuditKata(api);

    (api.ai as any).complete = async () => JSON.stringify({
      name: "daily-audit-reflex",
      description: "Daily finance audit",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "0 9 * * *" },
      existingKataName: "finance.audit",
      existingKataVersion: "v1",
      newKataDsl: null,
    });

    const proposal = await proposeContract("audit finances every day at 9am", api);

    expect(proposal.contract.targetKata).toBe("finance.audit");
    expect(proposal.kataDsl).toBeUndefined();
    expect(proposal.preview).toContain("Daily at 09:00");
    expect(proposal.preview).toContain("finance.audit");
  });

  it("refuses to target a kata the AI hallucinated (not actually registered)", async () => {
    const api = await createMockAPI(JSON.stringify({
      name: "bogus-reflex",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      existingKataName: "does.not.exist",
      existingKataVersion: "v1",
      newKataDsl: null,
    }));

    await expect(proposeContract("do something", api)).rejects.toThrow(ContractProposeError);
  });

  it("throws a clear error when the AI doesn't return valid JSON", async () => {
    const api = await createMockAPI("Sure! Here's your contract: <not json>");
    await expect(proposeContract("do something", api)).rejects.toThrow(ContractProposeError);
  });

  it("strips markdown fences before parsing (mirrors kata propose's DSL stripping)", async () => {
    const fenced = "```json\n" + JSON.stringify({
      name: "fenced-reflex",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      existingKataName: "finance.audit",
      existingKataVersion: "v1",
      newKataDsl: null,
    }) + "\n```";

    const api = await createMockAPI(fenced);
    await registerFinanceAuditKata(api);

    const proposal = await proposeContract("do something", api);
    expect(proposal.contract.name).toBe("fenced-reflex");
  });

  it("surfaces the raw drafted DSL on the error when kata compilation fails (mirrors kata propose's failure UX)", async () => {
    const malformedDsl = "kata bad.kata v1\n  initial start\n\nstart\n  run skill x\n  complete\n"; // missing 'phase' keyword
    const api = await createMockAPI(JSON.stringify({
      name: "bad-reflex",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      existingKataName: null,
      existingKataVersion: null,
      newKataDsl: malformedDsl,
    }));

    try {
      await proposeContract("do something", api);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContractProposeError);
      expect((error as InstanceType<typeof ContractProposeError>).rawDsl).toBe(malformedDsl);
    }
  });

  it("rejects an empty intent", async () => {
    const api = await createMockAPI("{}");
    await expect(proposeContract("   ", api)).rejects.toThrow(ContractProposeError);
  });
});
