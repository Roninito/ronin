import { describe, it, expect } from "bun:test";
import { ContractParserV2 } from "../src/contract/parser-v2.js";

// Replaces tests/kata-parser-ability.test.ts (KataParser deleted 2026-09-17
// along with the rest of src/kata/ — Contract now owns the phase grammar
// directly). Phases had no way to name which ability of a multi-ability
// skill to run — `run skill weather` alone is ambiguous once weather has
// more than one ability — so `run skill X ability Y` is optional syntax on
// every phase's action line.
describe("ContractParserV2 — optional 'ability' clause on 'run skill'", () => {
  it("parses 'run skill X ability Y' into the phase action's ability", () => {
    const source = `contract test.ability v1
  trigger manual

  initial only

  phase only
    run skill weather ability morning-briefing
    complete
`;
    const def = new ContractParserV2().parse(source);
    const action = def.phases.only!.action;
    expect(action.type).toBe("run");
    if (action.type === "run") {
      expect(action.skill).toBe("weather");
      expect(action.ability).toBe("morning-briefing");
    }
  });

  it("still parses plain 'run skill X' with no ability (backward compatible)", () => {
    const source = `contract test.no-ability v1
  trigger manual

  initial only

  phase only
    run skill weather
    complete
`;
    const def = new ContractParserV2().parse(source);
    const action = def.phases.only!.action;
    expect(action.type).toBe("run");
    if (action.type === "run") {
      expect(action.skill).toBe("weather");
      expect(action.ability).toBeUndefined();
    }
  });

  it("rejects a malformed ability clause missing its name", () => {
    const source = `contract test.malformed v1
  trigger manual

  initial only

  phase only
    run skill weather ability
    complete
`;
    expect(() => new ContractParserV2().parse(source)).toThrow();
  });
});
