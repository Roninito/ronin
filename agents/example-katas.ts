/**
 * Example Finance Audit Kata
 *
 * Demonstrates multi-phase workflow:
 * 1. gather - collect financial data
 * 2. analyze - analyze trends
 * 3. alert - notify user of findings
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { KataRegistry } from "../src/kata/registry.js";

const FINANCE_AUDIT_DSL = `
kata finance.audit v1
  requires skill mail.search
  requires skill finance.extract
  requires skill notify.user

  initial gather

  phase gather
    run skill mail.search
    next analyze

  phase analyze
    run skill finance.extract
    next alert

  phase alert
    run skill notify.user
    complete
`;

export default class ExampleKatasAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    // Register example katas immediately — event-driven agent, execute() is not called at startup
    const registry = new KataRegistry(api);
    registry.registerOrSkip(FINANCE_AUDIT_DSL)
      .then((kata) => console.log(`⚔️  Example katas ready. Registered: ${kata.name} v${kata.version}`))
      .catch((error) => console.error(`[example-katas] Failed to register example katas: ${error instanceof Error ? error.message : String(error)}`));
  }

  async execute(): Promise<void> {
    // Event-driven — katas registered in constructor
  }
}
