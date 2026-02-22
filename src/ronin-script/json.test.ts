import { describe, test, expect } from "bun:test";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";
import { toJson, fromJson, fromJsonToScript } from "./json.js";

describe("toJson / fromJson", () => {
  test("toJson(script) produces JSON and fromJson round-trips", () => {
    const script = `# Type Definitions
account: name, balance

# Entities
account Chase 2450.32
tags: bank

# Relationships
Chase owns Visa`;
    const json = toJson(script);
    expect(json.typeDefs).toBeDefined();
    expect(json.entities).toHaveLength(1);
    expect(json.relationships).toHaveLength(1);
    const ast = fromJson(json);
    expect(ast.typeDefs).toEqual(json.typeDefs);
    expect(ast.entities[0].type).toBe("account");
    expect(ast.relationships).toEqual(json.relationships);
  });

  test("fromJsonToScript produces valid Ronin Script", () => {
    const json = {
      typeDefs: [{ typeName: "account", fields: ["name", "balance"] }],
      entities: [{ type: "account", values: ["Chase", "2450.32"] }],
      relationships: [{ subject: "Chase", relation: "owns", object: "Visa" }],
    };
    const script = fromJsonToScript(json);
    const ast = parse(script);
    expect(ast.entities).toHaveLength(1);
    expect(ast.relationships).toHaveLength(1);
  });

  test("toJson(ast) same as toJson(parse(script))", () => {
    const script = `# Entities
account A 100`;
    const ast = parse(script);
    const jsonFromScript = toJson(script);
    const jsonFromAst = toJson(ast);
    expect(jsonFromAst.entities).toEqual(jsonFromScript.entities);
  });
});
