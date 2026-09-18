import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { proposeContract, ContractProposeError } from "../src/contract/propose.js";

const PHASES_DSL = `initial notify

phase notify
  run skill notify.user
  complete
`;

async function createMockAPI(
  aiResponse: string,
  skills: { name: string; description: string; abilities: { name: string; description?: string; input: string[] }[] }[] = [],
): Promise<DutyAPI> {
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
    // validateSkillReferences (src/contract/propose.ts) checks every "run skill
    // X" against this list — without it, any DSL that uses a skill fails with
    // "does not exist" regardless of how well-formed it is.
    skills: {
      list_skills_with_abilities: async () => skills,
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;

  await runEngineMigrations((api as any).db);
  return api;
}

describe("proposeContract", () => {
  it("drafts a contract with an inline phase graph from the AI's phasesDsl", async () => {
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
      phasesDsl: PHASES_DSL,
    });

    const api = await createMockAPI(aiResponse, [
      { name: "notify.user", description: "Notify the user", abilities: [] },
    ]);
    const proposal = await proposeContract("when trust drops below 40 and a rival is nearby, do a quiet handoff, then notify me", api);

    expect(proposal.contract.name).toBe("quiet-handoff-reflex");
    expect(proposal.contract.initialPhase).toBe("notify");
    expect(Object.keys(proposal.contract.phases)).toEqual(["notify"]);
    expect(proposal.contract.triggerType).toBe("event");
    expect(proposal.phasesDsl).toBe(PHASES_DSL);
    // Preview must be plain language, never the raw JSON — this is the entire
    // safety net for the approval card (see plan Phase C).
    expect(proposal.preview).not.toContain("{");
    expect(proposal.preview).toContain("trust_level < 40");
    expect(proposal.preview).toContain("rival.distance < 50");
    expect(proposal.preview).toContain("notify");
  });

  it("drafts a cron-triggered contract", async () => {
    const api = await createMockAPI(JSON.stringify({
      name: "daily-audit-reflex",
      description: "Daily finance audit",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "0 9 * * *" },
      phasesDsl: "initial check\n\nphase check\n  run skill finance.extract\n  complete\n",
    }), [
      { name: "finance.extract", description: "Extract finance data", abilities: [] },
    ]);

    const proposal = await proposeContract("audit finances every day at 9am", api);

    expect(proposal.contract.initialPhase).toBe("check");
    expect(proposal.preview).toContain("Daily at 09:00");
    expect(proposal.preview).toContain("check");
  });

  it("refuses to draft phases that reference a skill that doesn't exist", async () => {
    const api = await createMockAPI(JSON.stringify({
      name: "bogus-reflex",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      phasesDsl: "initial go\n\nphase go\n  run skill does.not.exist\n  complete\n",
    }), []);

    await expect(proposeContract("do something", api)).rejects.toThrow(ContractProposeError);
  });

  it("throws a clear error when the AI doesn't return valid JSON", async () => {
    const api = await createMockAPI("Sure! Here's your contract: <not json>");
    await expect(proposeContract("do something", api)).rejects.toThrow(ContractProposeError);
  });

  it("strips markdown fences before parsing", async () => {
    const fenced = "```json\n" + JSON.stringify({
      name: "fenced-reflex",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      phasesDsl: "initial check\n\nphase check\n  run skill finance.extract\n  complete\n",
    }) + "\n```";

    const api = await createMockAPI(fenced, [
      { name: "finance.extract", description: "Extract finance data", abilities: [] },
    ]);

    const proposal = await proposeContract("do something", api);
    expect(proposal.contract.name).toBe("fenced-reflex");
  });

  it("surfaces the raw drafted DSL on the error when the phase graph fails validation", async () => {
    // Two phases, but "next" points nowhere and neither is terminal correctly —
    // "go" has a dangling next; validateContractPhases must catch it.
    const malformedDsl = "initial go\n\nphase go\n  run skill finance.extract\n  next nowhere\n";
    const api = await createMockAPI(JSON.stringify({
      name: "bad-reflex",
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      phasesDsl: malformedDsl,
    }), [
      { name: "finance.extract", description: "Extract finance data", abilities: [] },
    ]);

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
