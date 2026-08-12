import { describe, it, expect } from "bun:test";
import { KataParser } from "../src/kata/parser.js";

// Kata phases had no way to name which ability of a multi-ability skill to
// run — `run skill weather` alone is ambiguous once weather has more than
// one ability. This adds an optional `ability <name>` clause, mirroring the
// existing optional `wait ... timeout N` clause already in the grammar.
describe("KataParser — optional 'ability' clause on 'run skill'", () => {
  it("parses 'run skill X ability Y' into action.ability", () => {
    const source = `kata test.ability v1
  initial only

  phase only
    run skill weather ability morning-briefing
    complete
`;
    const ast = new KataParser().parse(source);
    const action = ast.phases.only.action;
    expect(action.type).toBe("run");
    if (action.type === "run") {
      expect(action.skill).toBe("weather");
      expect(action.ability).toBe("morning-briefing");
    }
  });

  it("still parses plain 'run skill X' with no ability (backward compatible)", () => {
    const source = `kata test.no-ability v1
  initial only

  phase only
    run skill weather
    complete
`;
    const ast = new KataParser().parse(source);
    const action = ast.phases.only.action;
    expect(action.type).toBe("run");
    if (action.type === "run") {
      expect(action.skill).toBe("weather");
      expect(action.ability).toBeUndefined();
    }
  });

  it("rejects a malformed ability clause missing its name", () => {
    const source = `kata test.malformed v1
  initial only

  phase only
    run skill weather ability
    complete
`;
    expect(() => new KataParser().parse(source)).toThrow();
  });
});
