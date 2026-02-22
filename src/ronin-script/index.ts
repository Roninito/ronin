/**
 * Ronin Script: token-efficient, AI-native context language.
 * See docs/RONIN_SCRIPT.md for the full specification.
 */

export { parse } from "./parse.js";
export { serialize } from "./serialize.js";
export { toJson, fromJson, fromJsonToScript } from "./json.js";
export { ingestRoninScriptToOntology, exportOntologyToRoninScript } from "./ontology.js";
export type {
  ParsedRoninScript,
  ParsedEntity,
  TypeDef,
  Relationship,
  Section,
} from "./types.js";
export type { RoninScriptJson } from "./json.js";
