import { describe, test, expect } from "bun:test";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";
import type { ParsedRoninScript } from "./types.js";

describe("serialize", () => {
  test("round-trips full snapshot", () => {
    const script = `# Type Definitions
account: name, balance, currency, account_type, due
alert: entity, type, value, date
relationship: subject, relation, object

# Entities
account Chase Checking 2450.32 USD checking due 2026-03-01
tags: bank, active
tool_input: monitor_balance

alert Chase Checking low_balance -100.00 2026-02-19

# Relationships
Chase Checking owns Visa
Netflix paid_by Chase Checking`;
    const ast = parse(script);
    const out = serialize(ast);
    const ast2 = parse(out);
    expect(ast2.typeDefs).toEqual(ast.typeDefs);
    expect(ast2.entities.length).toBe(ast.entities.length);
    expect(ast2.entities[0].type).toBe(ast.entities[0].type);
    expect(ast2.entities[0].values).toEqual(ast.entities[0].values);
    expect(ast2.entities[0].labels).toEqual(ast.entities[0].labels);
    expect(ast2.relationships).toEqual(ast.relationships);
  });

  test("serializes then parses back to equivalent AST", () => {
    const ast: ParsedRoninScript = {
      typeDefs: [{ typeName: "account", fields: ["name", "balance"] }],
      entities: [
        { type: "account", values: ["Chase", "2450.32"], labels: { tags: ["bank"] } },
      ],
      relationships: [{ subject: "Chase", relation: "owns", object: "Visa" }],
    };
    const script = serialize(ast);
    expect(script).toContain("# Type Definitions");
    expect(script).toContain("account: name, balance");
    expect(script).toContain("account Chase 2450.32");
    expect(script).toContain("tags: bank");
    expect(script).toContain("Chase owns Visa");
    const back = parse(script);
    expect(back.typeDefs).toEqual(ast.typeDefs);
    expect(back.relationships).toEqual(ast.relationships);
  });
});
