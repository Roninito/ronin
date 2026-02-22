/**
 * Parse Ronin Script text into a structured AST.
 * Rules: type value… → entity; label: value → labeled property; indentation → nesting; relationships section → triples.
 */

import type { TypeDef, ParsedEntity, Relationship, ParsedRoninScript, Section } from "./types.js";

const SECTION_HEADERS: Record<string, Section> = {
  "type definitions": "type_definitions",
  "entities": "entities",
  "relationships": "relationships",
  "tool outputs": "entities",
};

export function parse(script: string): ParsedRoninScript {
  const typeDefs: TypeDef[] = [];
  const entities: ParsedEntity[] = [];
  const relationships: Relationship[] = [];
  let section: Section = null;
  let currentEntity: ParsedEntity | null = null;
  const lines = script.split(/\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimEnd();
    if (trimmed === "") continue;

    const indent = raw.length - raw.trimStart().length;
    const content = trimmed.trim();
    if (content === "") continue;

    // Section header: # Type Definitions, # Entities, # Relationships
    if (content.startsWith("#")) {
      const rest = content.slice(1).trim().toLowerCase();
      section = SECTION_HEADERS[rest] ?? null;
      currentEntity = null;
      continue;
    }

    // Type definition: type_name: field1, field2
    if (section === "type_definitions" && !content.startsWith(" ") && content.includes(":")) {
      const colonIdx = content.indexOf(":");
      const typeName = content.slice(0, colonIdx).trim();
      const fieldList = content.slice(colonIdx + 1).trim();
      const fields = fieldList ? fieldList.split(",").map((f) => f.trim()).filter(Boolean) : [];
      if (typeName) typeDefs.push({ typeName, fields });
      continue;
    }

    // Labeled property: label: value1, value2 (for current entity)
    if (content.includes(":") && !content.startsWith(" ")) {
      const colonIdx = content.indexOf(":");
      const label = content.slice(0, colonIdx).trim();
      const valueList = content.slice(colonIdx + 1).trim();
      const values = valueList ? valueList.split(",").map((v) => v.trim()).filter(Boolean) : [];
      if (label && currentEntity) {
        if (!currentEntity.labels) currentEntity.labels = {};
        currentEntity.labels[label] = values;
      }
      continue;
    }

    // Relationship line: subject relation object (relation = one token; object = rest, may contain commas)
    if (section === "relationships" && indent === 0) {
      const tokens = content.split(/\s+/);
      if (tokens.length >= 3) {
        let relationIdx = tokens.length === 3 ? 1 : 2;
        // If third token looks like a proper noun (e.g. "Chase"), relation is likely second token (e.g. "paid_by")
        if (tokens.length >= 4 && tokens[2].length > 0 && tokens[2][0] === tokens[2][0].toUpperCase()) {
          relationIdx = 1;
        }
        const subject = tokens.slice(0, relationIdx).join(" ");
        const relation = tokens[relationIdx];
        const objectPart = tokens.slice(relationIdx + 1).join(" ");
        const objects = objectPart.includes(",")
          ? objectPart.split(",").map((o) => o.trim()).filter(Boolean)
          : [objectPart];
        for (const obj of objects) {
          if (obj) relationships.push({ subject, relation, object: obj });
        }
      }
      continue;
    }

    // Nested block (indented)
    if (indent > 0 && currentEntity) {
      const nested = parseEntityLine(content);
      if (nested) {
        if (!currentEntity.nested) currentEntity.nested = [];
        currentEntity.nested.push(nested);
      }
      continue;
    }

    // Entity line: type value1 value2 ...
    const entity = parseEntityLine(content);
    if (entity) {
      entities.push(entity);
      currentEntity = entity;
    }
  }

  return {
    typeDefs: typeDefs.length ? typeDefs : undefined,
    entities,
    relationships: relationships.length ? relationships : undefined,
  };
}

function parseEntityLine(line: string): ParsedEntity | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const type = tokens[0];
  const values = tokens.slice(1);
  return { type, values };
}
