/**
 * Static source scanner for a duty's event/tool topology.
 *
 * Heuristic and best-effort by design (see design plan §2.2, §4) — this is
 * the `scanned` derivation tier, a fallback for duties that haven't declared
 * `static events`/`static beams`/`static queries` yet. It regex-matches
 * string-literal calls; anything built dynamically (template strings with
 * variables, computed property names) will be missed. That's an accepted,
 * documented limitation, not a bug — `declared` is always preferred when
 * present (see src/graph/derive.ts).
 */

import type { ScannedDutyTopology } from "./types.js";

const QUOTE = `["'\`]`;
const STR = `${QUOTE}([^"'\`]+)${QUOTE}`;

function matchAllGroups(source: string, re: RegExp, groupIndex = 1): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(re)) {
    const g = m[groupIndex];
    if (g) out.push(g);
  }
  return out;
}

function matchAllPairs(source: string, re: RegExp): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of source.matchAll(re)) {
    if (m[1] && m[2]) out.push([m[1], m[2]]);
  }
  return out;
}

/**
 * Scan a duty's raw TypeScript source for imperative event/tool/skill usage.
 * `dutyName` is the duty's own file-derived name, used to attribute
 * `target:${dutyName}:queryType` handler registrations as "served" queries.
 */
export function scanDutySource(source: string, dutyName: string): ScannedDutyTopology {
  const eventsOut = matchAllGroups(source, new RegExp(`\\.events\\.emit\\(\\s*${STR}`, "g"));

  const onEvents = matchAllGroups(source, new RegExp(`\\.events\\.on\\(\\s*${STR}`, "g"));
  const eventsIn = onEvents.filter((e) => !e.startsWith("target:") && !e.startsWith("response:"));

  const servedPrefix = `target:${dutyName}:`;
  const queriesServed = onEvents
    .filter((e) => e.startsWith(servedPrefix))
    .map((e) => e.slice(servedPrefix.length));

  const beamPairs = matchAllPairs(source, new RegExp(`\\.beam\\(\\s*${STR}\\s*,\\s*${STR}`, "g"));
  const beamsOut = beamPairs.map(([target, eventType]) => ({ target, eventType }));

  const queryPairs = matchAllPairs(source, new RegExp(`\\.events\\.query\\(\\s*${STR}\\s*,\\s*${STR}`, "g"));
  const queriesOut = queryPairs.map(([target, queryType]) => ({ target, queryType }));

  const tools = matchAllGroups(
    source,
    new RegExp(`tools\\.register\\(\\s*\\{[^}]*?name:\\s*${STR}`, "gs")
  );

  const skillsCalled = matchAllGroups(source, new RegExp(`plugins\\.call\\(\\s*${STR}`, "g"));
  const skillsRun = matchAllGroups(source, new RegExp(`skills\\.run\\(\\s*${STR}`, "g"));
  const skills = Array.from(new Set([...skillsCalled, ...skillsRun]));

  return {
    eventsIn: Array.from(new Set(eventsIn)),
    eventsOut: Array.from(new Set(eventsOut)),
    beamsOut,
    queriesOut,
    queriesServed: Array.from(new Set(queriesServed)),
    tools: Array.from(new Set(tools)),
    skills,
  };
}
