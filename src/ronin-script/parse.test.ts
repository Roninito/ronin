import { describe, test, expect } from "bun:test";
import { parse } from "./parse.js";

describe("parse", () => {
  test("parses type definitions", () => {
    const script = `# Type Definitions
account: name, balance, currency
relationship: subject, relation, object`;
    const ast = parse(script);
    expect(ast.typeDefs).toEqual([
      { typeName: "account", fields: ["name", "balance", "currency"] },
      { typeName: "relationship", fields: ["subject", "relation", "object"] },
    ]);
    expect(ast.entities).toEqual([]);
    expect(ast.relationships ?? []).toEqual([]);
  });

  test("parses entities", () => {
    const script = `# Entities
account Chase Checking 2450.32 USD checking
alert Chase Checking low_balance -100.00 2026-02-19`;
    const ast = parse(script);
    expect(ast.entities).toHaveLength(2);
    expect(ast.entities[0]).toEqual({
      type: "account",
      values: ["Chase", "Checking", "2450.32", "USD", "checking"],
      labels: undefined,
      nested: undefined,
    });
    expect(ast.entities[1].type).toBe("alert");
    expect(ast.entities[1].values).toContain("low_balance");
  });

  test("parses labeled properties", () => {
    const script = `# Entities
account Chase Checking 2450.32 USD
tags: bank, active
tool_input: monitor_balance`;
    const ast = parse(script);
    expect(ast.entities).toHaveLength(1);
    expect(ast.entities[0].labels).toEqual({
      tags: ["bank", "active"],
      tool_input: ["monitor_balance"],
    });
  });

  test("parses relationships", () => {
    const script = `# Relationships
Chase Checking owns Visa
Netflix paid_by Chase Checking`;
    const ast = parse(script);
    expect(ast.relationships).toEqual([
      { subject: "Chase Checking", relation: "owns", object: "Visa" },
      { subject: "Netflix", relation: "paid_by", object: "Chase Checking" },
    ]);
  });

  test("parses comma-separated objects in relationships", () => {
    const script = `# Relationships
Chase Checking owns Visa, DebitCard`;
    const ast = parse(script);
    expect(ast.relationships).toEqual([
      { subject: "Chase Checking", relation: "owns", object: "Visa" },
      { subject: "Chase Checking", relation: "owns", object: "DebitCard" },
    ]);
  });

  test("full snapshot round-trip structure", () => {
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
    expect(ast.typeDefs).toHaveLength(3);
    expect(ast.entities).toHaveLength(2);
    expect(ast.entities[0].labels?.tags).toEqual(["bank", "active"]);
    expect(ast.relationships).toHaveLength(2);
  });

  test("relationship line with exactly 3 tokens", () => {
    const script = `# Relationships
A owns B`;
    const ast = parse(script);
    expect(ast.relationships).toEqual([
      { subject: "A", relation: "owns", object: "B" },
    ]);
  });
});
