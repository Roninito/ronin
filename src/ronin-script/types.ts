/**
 * AST types for Ronin Script.
 * See docs/RONIN_SCRIPT.md for the language spec.
 */

export interface TypeDef {
  typeName: string;
  fields: string[];
}

export interface ParsedEntity {
  type: string;
  values: string[];
  labels?: Record<string, string[]>;
  nested?: ParsedEntity[];
}

export interface Relationship {
  subject: string;
  relation: string;
  object: string;
}

export interface ParsedRoninScript {
  typeDefs?: TypeDef[];
  entities: ParsedEntity[];
  relationships?: Relationship[];
}

export type Section = "type_definitions" | "entities" | "relationships" | null;
