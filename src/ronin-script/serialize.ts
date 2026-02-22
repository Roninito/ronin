/**
 * Serialize ParsedRoninScript back to Ronin Script text.
 */

import type { ParsedRoninScript, ParsedEntity } from "./types.js";

const INDENT = "  ";

export function serialize(ast: ParsedRoninScript): string {
  const lines: string[] = [];

  if (ast.typeDefs && ast.typeDefs.length > 0) {
    lines.push("# Type Definitions");
    for (const td of ast.typeDefs) {
      const fieldList = td.fields.join(", ");
      lines.push(`${td.typeName}: ${fieldList}`);
    }
    lines.push("");
  }

  if (ast.entities.length > 0) {
    lines.push("# Entities");
    for (const entity of ast.entities) {
      appendEntity(lines, entity, "");
    }
  }

  if (ast.relationships && ast.relationships.length > 0) {
    lines.push("");
    lines.push("# Relationships");
    for (const r of ast.relationships) {
      lines.push(`${r.subject} ${r.relation} ${r.object}`);
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function appendEntity(lines: string[], entity: ParsedEntity, indent: string): void {
  const line = [entity.type, ...entity.values].join(" ");
  lines.push(indent + line);
  if (entity.labels && Object.keys(entity.labels).length > 0) {
    for (const [label, values] of Object.entries(entity.labels)) {
      lines.push(indent + `${label}: ${values.join(", ")}`);
    }
  }
  if (entity.nested && entity.nested.length > 0) {
    for (const n of entity.nested) {
      appendEntity(lines, n, indent + INDENT);
    }
  }
}
