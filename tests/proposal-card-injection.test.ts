import { describe, it, expect } from "bun:test";
import {
  injectContractProposalCardIntoResponse,
  injectDutyProposalCardIntoResponse,
  injectWorkflowProposalCardIntoResponse,
} from "../src/utils/prompt.js";

// This file used to also test filterToolSchemas — a keyword-regex guesser
// that decided whether contracts.proposeReflex/duties.proposeDuty were even
// offered to the model, based on message phrasing. It had a real bug history
// (documented in the tests that used to be here): "propose a contract" and
// "when X happens" phrasings kept missing the regex buckets, so the tool was
// silently never offered and the model hallucinated instead.
//
// filterToolSchemas is deleted (see ARCHITECTURE.md §7.1). Duty-self-registered
// tools like contracts.proposeReflex now stay unconditionally visible in every
// chat turn regardless of message content — a structural guarantee, not a
// phrasing match. See the regression test "duty-self-registered tools (custom
// provider...) must stay visible" in tests/tool-docs.test.ts, which pins
// exactly this for contracts.proposeReflex, duties.proposeDuty, and
// schedule.writeSchedule.
//
// This file's scope grew to cover all three proposal-card injectors after a
// real production bug: a user proposed a duty, the tool call succeeded (a
// real proposal was drafted and stored), but no card appeared in chat. Root
// cause: the model narrated the id back in prose ("...with ID
// dprop_123..."), and the injector's duplicate-guard checked for the bare id
// string anywhere in the response — which the model's own sentence
// satisfied — so it concluded a card was "already there" and silently
// skipped appending one. All three injectors (contract/duty/workflow) shared
// this exact bug. Fixed by checking for the actual rendered fence, not the
// bare id.

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

  it("REGRESSION: still appends the card when the model narrates the id in prose", () => {
    // This is the exact bug: the model's own sentence mentions the bare id,
    // which must NOT be mistaken for the card already being present.
    const response = "I've drafted that reflex for you — the proposal ID is prop_123, take a look.";
    const toolResults = [
      { name: "contracts.proposeReflex", success: true, result: { id: "prop_123", preview: "Fires when X" } },
    ];
    const out = injectContractProposalCardIntoResponse(response, toolResults);
    expect(out).toContain("```contract-proposal");
    expect(out).toContain('"id":"prop_123"');
  });

  it("does not duplicate when the exact fence is already in the response", () => {
    const fence = '```contract-proposal\n{"id":"prop_123","preview":"p"}\n```';
    const response = `Here you go.\n\n${fence}`;
    const toolResults = [
      { name: "contracts.proposeReflex", success: true, result: { id: "prop_123", preview: "p" } },
    ];
    expect(injectContractProposalCardIntoResponse(response, toolResults)).toBe(response);
  });
});

describe("injectDutyProposalCardIntoResponse", () => {
  it("appends a duty-proposal fence (including code) when the tool succeeded", () => {
    const response = "I've drafted a Log Analyzer Duty for you.";
    const toolResults = [
      {
        name: "duties.proposeDuty",
        success: true,
        result: { id: "dprop_123", preview: "Scans logs daily, posts a summary", code: "export default class LogAnalyzer {}" },
      },
    ];
    const out = injectDutyProposalCardIntoResponse(response, toolResults);
    expect(out).toContain("```duty-proposal");
    expect(out).toContain('"id":"dprop_123"');
    expect(out).toContain("LogAnalyzer");
  });

  it("REGRESSION: the exact reported bug — narrating the id in prose must not suppress the card", () => {
    const response =
      "I've drafted a Log Analyzer Duty proposal for you... " +
      "A proposal card should appear in your chat UI with ID dprop_1789193500295_fxzlatyz. " +
      "You can approve it to install the duty or refuse it if you'd like changes.";
    const toolResults = [
      {
        name: "duties.proposeDuty",
        success: true,
        result: { id: "dprop_1789193500295_fxzlatyz", preview: "Daily log analysis", code: "export default class LogAnalyzer {}" },
      },
    ];
    const out = injectDutyProposalCardIntoResponse(response, toolResults);
    expect(out).toContain("```duty-proposal");
    expect(out).toContain('"id":"dprop_1789193500295_fxzlatyz"');
  });

  it("is a no-op when the tool didn't run, failed, or the result is missing a required field", () => {
    const response = "Sorry, I couldn't draft that.";
    expect(injectDutyProposalCardIntoResponse(response, [])).toBe(response);
    expect(injectDutyProposalCardIntoResponse(response, [
      { name: "duties.proposeDuty", success: false, result: null, error: "boom" },
    ])).toBe(response);
    // Missing `code` — malformed result, must not crash or half-render a card.
    expect(injectDutyProposalCardIntoResponse(response, [
      { name: "duties.proposeDuty", success: true, result: { id: "dprop_1", preview: "p" } },
    ])).toBe(response);
  });

  it("does not duplicate when the exact fence is already in the response", () => {
    const fence = '```duty-proposal\n{"id":"dprop_1","preview":"p","code":"c"}\n```';
    const response = `Here you go.\n\n${fence}`;
    const toolResults = [
      { name: "duties.proposeDuty", success: true, result: { id: "dprop_1", preview: "p", code: "c" } },
    ];
    expect(injectDutyProposalCardIntoResponse(response, toolResults)).toBe(response);
  });
});

describe("injectWorkflowProposalCardIntoResponse", () => {
  it("appends a workflow-proposal fence when the tool succeeded", () => {
    const response = "I've drafted that SOP for you.";
    const toolResults = [
      { name: "workflows.propose", success: true, result: { id: "wprop_123", preview: "How we launch a new app" } },
    ];
    const out = injectWorkflowProposalCardIntoResponse(response, toolResults);
    expect(out).toContain("```workflow-proposal");
    expect(out).toContain('"id":"wprop_123"');
  });

  it("REGRESSION: still appends the card when the model narrates the id in prose", () => {
    const response = "Drafted — the workflow proposal ID is wprop_123.";
    const toolResults = [
      { name: "workflows.propose", success: true, result: { id: "wprop_123", preview: "p" } },
    ];
    const out = injectWorkflowProposalCardIntoResponse(response, toolResults);
    expect(out).toContain("```workflow-proposal");
  });

  it("does not duplicate when the exact fence is already in the response", () => {
    const fence = '```workflow-proposal\n{"id":"wprop_1","preview":"p"}\n```';
    const response = `Here you go.\n\n${fence}`;
    const toolResults = [
      { name: "workflows.propose", success: true, result: { id: "wprop_1", preview: "p" } },
    ];
    expect(injectWorkflowProposalCardIntoResponse(response, toolResults)).toBe(response);
  });
});
