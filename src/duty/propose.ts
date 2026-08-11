/**
 * duty propose — AI-authoring for a new Duty from a plain-English intent,
 * reachable from chat via the duties.proposeDuty tool (duties/duty-executor.ts).
 *
 * Mirrors src/contract/propose.ts's shape: intent -> AI completion -> parse
 * -> validate -> preview. This module only drafts — it never writes to disk
 * or touches the duties directory. Nothing goes live until the caller
 * explicitly approves the returned proposal (chat: after an approval card;
 * dashboard: after a /duties/review click) — see duties/duty-executor.ts.
 */

import { join } from "path";
import { existsSync } from "fs";
import type { DutyAPI } from "../types/index.js";
import {
  buildDutyAuthoringSystemPrompt,
  extractCodeFromResponse,
  validateDutyCode,
  extractDutyName,
} from "./duty-authoring.js";
import { ensureDefaultDutyDir } from "../cli/commands/config.js";

export class DutyProposeError extends Error {}

export interface DutyProposal {
  dutyName: string;
  code: string;
  /** Plain-language line for the approval card, built from the intent
   *  itself (not the model's own words) so it's always present and always
   *  reflects what was actually asked for. */
  preview: string;
}

/**
 * Draft a duty's TypeScript from a plain-English intent. Pure drafting —
 * writes nothing to disk, registers nothing.
 */
export async function proposeDuty(intent: string, api: DutyAPI): Promise<DutyProposal> {
  if (!intent.trim()) {
    throw new DutyProposeError("Intent required");
  }

  const prompt = `${buildDutyAuthoringSystemPrompt()}

I want to create a duty that: ${intent}

Generate the complete TypeScript duty code now. Output only the code, wrapped in a markdown code block.`;

  const raw = await api.ai.complete(prompt);
  const code = extractCodeFromResponse(raw);

  const validation = validateDutyCode(code);
  if (!validation.valid) {
    throw new DutyProposeError(`Drafted duty failed validation: ${validation.errors.join("; ")}`);
  }

  let dutyName = extractDutyName(intent);
  const dutyDir = ensureDefaultDutyDir();
  if (existsSync(join(dutyDir, `${dutyName}.ts`))) {
    // Disambiguate rather than silently overwrite an existing duty on approval.
    dutyName = `${dutyName}-${Date.now().toString(36)}`;
  }

  const preview = `Creates duty '${dutyName}' — ${intent.trim()}`;

  return { dutyName, code, preview };
}
