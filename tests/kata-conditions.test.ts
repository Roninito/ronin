import { describe, it, expect } from "bun:test";
import { evaluateCondition, evaluateConditionGroup, conditionToHuman } from "../src/kata/conditions.js";

// `evaluateCondition`/`evaluateConditionGroup` were built for kata task variables
// but had zero runtime callers and zero tests anywhere in the repo before this file.
// The contract event-trigger engine (src/contract/event-engine.ts) is their first
// real caller, evaluating conditions against arbitrary event payloads rather than
// kata task variables — these tests confirm that reuse is actually safe.
describe("evaluateCondition — against arbitrary event payloads", () => {
  const payload = {
    trust_level: 35,
    rival: { name: "Kael", distance: 40 },
    tags: ["stealth", "night"],
  };

  it("evaluates a simple numeric comparison", () => {
    expect(evaluateCondition({ variable: "trust_level", operator: "<", value: 40 }, payload)).toBe(true);
    expect(evaluateCondition({ variable: "trust_level", operator: ">=", value: 40 }, payload)).toBe(false);
  });

  it("walks dot-notation paths into nested objects", () => {
    expect(evaluateCondition({ variable: "rival.name", operator: "==", value: "Kael" }, payload)).toBe(true);
    expect(evaluateCondition({ variable: "rival.distance", operator: "<", value: 50 }, payload)).toBe(true);
  });

  it("returns false (not a throw) for a missing/undefined path", () => {
    expect(evaluateCondition({ variable: "nonexistent.deeply.nested", operator: "==", value: "x" }, payload)).toBe(false);
  });

  it("evaluates 'contains' against an array field", () => {
    expect(evaluateCondition({ variable: "tags", operator: "contains", value: "stealth" }, payload)).toBe(true);
    expect(evaluateCondition({ variable: "tags", operator: "contains", value: "loud" }, payload)).toBe(false);
  });

  it("combines conditions with an AND group, matching a real reflex guard", () => {
    // "when trust drops below 40 and a rival is nearby"
    const group = {
      type: "AND" as const,
      conditions: [
        { variable: "trust_level", operator: "<" as const, value: 40 },
        { variable: "rival.distance", operator: "<" as const, value: 50 },
      ],
    };
    expect(evaluateConditionGroup(group, payload)).toBe(true);
    expect(evaluateConditionGroup(group, { ...payload, rival: { name: "Kael", distance: 999 } })).toBe(false);
  });

  it("combines conditions with an OR group", () => {
    const group = {
      type: "OR" as const,
      conditions: [
        { variable: "trust_level", operator: ">" as const, value: 999 },
        { variable: "rival.distance", operator: "<" as const, value: 50 },
      ],
    };
    expect(evaluateConditionGroup(group, payload)).toBe(true);
  });
});

describe("conditionToHuman — deterministic preview rendering", () => {
  it("renders a single condition in plain language", () => {
    expect(conditionToHuman({ variable: "trust_level", operator: "<", value: 40 })).toBe("trust_level < 40");
    expect(conditionToHuman({ variable: "rival.name", operator: "==", value: "Kael" })).toBe('rival.name is "Kael"');
  });

  it("joins an AND group with 'and', wrapped in parens", () => {
    const group = {
      type: "AND" as const,
      conditions: [
        { variable: "trust_level", operator: "<" as const, value: 40 },
        { variable: "rival.distance", operator: "<" as const, value: 50 },
      ],
    };
    expect(conditionToHuman(group)).toBe("(trust_level < 40 and rival.distance < 50)");
  });

  it("joins an OR group with 'or'", () => {
    const group = {
      type: "OR" as const,
      conditions: [
        { variable: "trust_level", operator: "<" as const, value: 10 },
        { variable: "alarm", operator: "==" as const, value: true },
      ],
    };
    expect(conditionToHuman(group)).toBe("(trust_level < 10 or alarm is true)");
  });
});
