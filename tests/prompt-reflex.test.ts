import { describe, it, expect } from "bun:test";
import { filterToolSchemas, injectContractProposalCardIntoResponse } from "../src/utils/prompt.js";
import type { OpenAIFunctionSchema } from "../src/tools/types.js";

const reflexSchema: OpenAIFunctionSchema = {
  type: "function",
  function: {
    name: "contracts.proposeReflex",
    description: "Draft a reflex",
    parameters: { type: "object", properties: {} },
  },
};

describe("filterToolSchemas — reflex requests reach contracts.proposeReflex", () => {
  it("surfaces the tool for 'when X, do Y' phrasing (the exact wording the feature exists for)", () => {
    const result = filterToolSchemas([reflexSchema], {
      message: "when trust drops below 40 and a rival is nearby, do a quiet handoff, then notify me",
    });
    expect(result.some((s) => s.function.name === "contracts.proposeReflex")).toBe(true);
  });

  it("surfaces the tool for 'whenever' phrasing", () => {
    const result = filterToolSchemas([reflexSchema], {
      message: "whenever a new order comes in, run the finance audit",
    });
    expect(result.some((s) => s.function.name === "contracts.proposeReflex")).toBe(true);
  });

  it("surfaces the tool for 'every day at 9am' style cron requests via the existing creation-request gate", () => {
    const result = filterToolSchemas([reflexSchema], {
      message: "automatically send me a summary every day at 9am",
    });
    expect(result.some((s) => s.function.name === "contracts.proposeReflex")).toBe(true);
  });

  it("does NOT surface tools for an unrelated plain question (regression: gate isn't wide open)", () => {
    const result = filterToolSchemas([reflexSchema], {
      message: "what do you think about that?",
    });
    expect(result.some((s) => s.function.name === "contracts.proposeReflex")).toBe(false);
  });
});

const dutySchema: OpenAIFunctionSchema = {
  type: "function",
  function: {
    name: "duties.proposeDuty",
    description: "Draft a duty",
    parameters: { type: "object", properties: {} },
  },
};

describe("filterToolSchemas — conversational (non-reflex) propose requests", () => {
  // Real bug: a user asked Chatty this exact question and got a looping
  // "let me search the ontology" hallucination instead of a tool call,
  // because this phrasing matched none of isAboutDuties/isCreationRequest/
  // isReflexRequest — contracts.proposeReflex was never even offered to the
  // model. Fixed by adding "contract"/"kata" to isAboutDuties and
  // "propose"/"proposal" to isCreationRequest.
  it("surfaces contracts.proposeReflex for the exact real-world failing phrasing", () => {
    const result = filterToolSchemas([reflexSchema], {
      message: "I want to test your ability to propose a new contract. can you do a basic test contract proposal now?",
    });
    expect(result.some((s) => s.function.name === "contracts.proposeReflex")).toBe(true);
  });

  it("surfaces contracts.proposeReflex for plain 'propose a contract' phrasing", () => {
    const result = filterToolSchemas([reflexSchema], {
      message: "propose a contract that runs the finance audit kata",
    });
    expect(result.some((s) => s.function.name === "contracts.proposeReflex")).toBe(true);
  });

  it("surfaces duties.proposeDuty for plain 'propose a duty' phrasing", () => {
    const result = filterToolSchemas([dutySchema], {
      message: "can you propose a duty that watches the #design channel",
    });
    expect(result.some((s) => s.function.name === "duties.proposeDuty")).toBe(true);
  });

  it("surfaces tools for a plain 'list contracts' lookup", () => {
    const result = filterToolSchemas([reflexSchema], {
      message: "show me the active contracts",
    });
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("injectContractProposalCardIntoResponse", () => {
  it("appends a contract-proposal fence when the tool succeeded", () => {
    const response = "I've drafted that for you.";
    const toolResults = [
      { name: "contracts.proposeReflex", success: true, result: { id: "prop_123", preview: "Fires when X → runs kata Y" } },
    ];
    const out = injectContractProposalCardIntoResponse(response, toolResults);
    expect(out).toContain("```contract-proposal");
    expect(out).toContain('"id":"prop_123"');
    expect(out).toContain("Fires when X");
  });

  it("is a no-op when the tool didn't run or failed", () => {
    const response = "Sorry, I couldn't draft that.";
    expect(injectContractProposalCardIntoResponse(response, [])).toBe(response);
    expect(injectContractProposalCardIntoResponse(response, [
      { name: "contracts.proposeReflex", success: false, result: null, error: "boom" },
    ])).toBe(response);
  });

  it("doesn't duplicate the fence if the id is already present in the response", () => {
    const response = "See prop_123 above.";
    const toolResults = [
      { name: "contracts.proposeReflex", success: true, result: { id: "prop_123", preview: "p" } },
    ];
    expect(injectContractProposalCardIntoResponse(response, toolResults)).toBe(response);
  });
});
