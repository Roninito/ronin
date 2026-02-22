/**
 * Round-trip between Ronin Script and JSON for APIs and persistence.
 */

import { parse } from "./parse.js";
import { serialize } from "./serialize.js";
import type { ParsedRoninScript } from "./types.js";

export interface RoninScriptJson {
  typeDefs?: Array<{ typeName: string; fields: string[] }>;
  entities: Array<{
    type: string;
    values: string[];
    labels?: Record<string, string[]>;
    nested?: RoninScriptJson["entities"];
  }>;
  relationships?: Array<{ subject: string; relation: string; object: string }>;
}

/**
 * Convert Ronin Script (string or parsed AST) to JSON.
 */
export function toJson(script: string | ParsedRoninScript): RoninScriptJson {
  const ast = typeof script === "string" ? parse(script) : script;
  return {
    typeDefs: ast.typeDefs,
    entities: ast.entities.map((e) => ({
      type: e.type,
      values: e.values,
      labels: e.labels,
      nested: e.nested?.map((n) => ({
        type: n.type,
        values: n.values,
        labels: n.labels,
        nested: n.nested?.map((nn) => ({
          type: nn.type,
          values: nn.values,
          labels: nn.labels,
        })),
      })),
    })),
    relationships: ast.relationships,
  };
}

/**
 * Convert JSON to ParsedRoninScript. Optionally serialize to Ronin Script string via serialize(fromJson(json)).
 */
export function fromJson(json: RoninScriptJson): ParsedRoninScript {
  return {
    typeDefs: json.typeDefs,
    entities: json.entities.map((e) => ({
      type: e.type,
      values: e.values,
      labels: e.labels,
      nested: e.nested?.map((n) => ({
        type: n.type,
        values: n.values,
        labels: n.labels,
        nested: n.nested?.map((nn) => ({
          type: nn.type,
          values: nn.values,
          labels: nn.labels,
        })),
      })),
    })),
    relationships: json.relationships,
  };
}

/**
 * Convert JSON to Ronin Script string.
 */
export function fromJsonToScript(json: RoninScriptJson): string {
  return serialize(fromJson(json));
}
