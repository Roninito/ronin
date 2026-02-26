/**
 * Dojo Agent: User-gated Kata Proposals & Realms Integration
 *
 * When a capability is missing or requested:
 * 1. Search realms for matching katas
 * 2. Propose to user (pending approval)
 * 3. Wait for user decision
 * 4. Install approved katas
 *
 * "Dojo" = training ground where new katas are vetting before activation
 */

import { randomUUID } from "crypto";
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { KataRegistry } from "../src/kata/registry.js";

export default class DojoAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);

    // Listen for capability.missing events
    this.api.events.on("capability.missing", async (payload: any) => {
      await this.handleMissingCapability(payload);
    });

    // Listen for kata.user_approved events
    this.api.events.on("kata.user_approved", async (payload: any) => {
      await this.handleApprovedKata(payload);
    });

    console.log("🥋 Dojo Agent ready. Listening for capability.missing and kata.user_approved");
  }

  async execute(): Promise<void> {
    // Event-driven — all handlers registered in constructor
  }

  private async handleMissingCapability(payload: {
    intent: string;
    context?: string;
  }): Promise<void> {
    try {
      // Search realms for matching katas
      const results = await this.api.ai.complete(
        `Search for katas that match this intent: ${payload.intent}

        Return JSON with structure:
        {
          "search_query": "...",
          "reasoning": "...",
          "expected_skills": ["skill1", "skill2"]
        }`
      );

      const parsed = JSON.parse(results);

      // Query realms via api.realms
      if (!this.api.realms) {
        console.warn("Realms plugin not available");
        return;
      }

      const discovered = this.api.realms.discover(parsed.search_query);

      if (discovered.length === 0) {
        // No kata found - propose creation
        await this.proposeNewKata(payload.intent);
        return;
      }

      // Found katas - propose best match
      const proposal = discovered[0]; // TODO: better ranking
      await this.proposeKataInstall(proposal);
    } catch (error) {
      console.error("Dojo error:", error);
      this.api.events.emit("dojo.error", { error: String(error) }, "dojo");
    }
  }

  private async proposeKataInstall(proposal: any): Promise<void> {
    const proposalId = randomUUID();

    await this.api.memory.store(`kata_proposal_${proposalId}`, {
      type: "install",
      proposal,
      createdAt: Date.now(),
    });

    // Emit event for UI to show approval dialog
    this.api.events.emit(
      "kata.install_proposed",
      {
        proposalId,
        kataName: proposal.name,
        versions: proposal.versions.map((v: any) => ({
          version: v.version,
          complexity: v.complexity,
          tags: v.tags,
          description: v.description,
        })),
        fromRealm: proposal.fromRealm,
      },
      "dojo"
    );
  }

  private async proposeNewKata(intent: string): Promise<void> {
    const proposalId = randomUUID();

    // Use AI to generate kata proposal
    const proposal = await this.api.ai.complete(
      `Create a kata proposal for this intent: ${intent}

      Return JSON with structure:
      {
        "name": "example.intent",
        "phases": [
          { "name": "phase1", "description": "..." }
        ],
        "required_skills": ["skill1"],
        "tags": ["automation"],
        "complexity": "simple"
      }`
    );

    const parsed = JSON.parse(proposal);

    await this.api.memory.store(`kata_proposal_${proposalId}`, {
      type: "create",
      proposal: parsed,
      originalIntent: intent,
      createdAt: Date.now(),
    });

    // Emit event for UI to show proposal dialog
    this.api.events.emit(
      "kata.creation_proposed",
      {
        proposalId,
        kataName: parsed.name,
        phases: parsed.phases,
        requiredSkills: parsed.required_skills,
        tags: parsed.tags,
        complexity: parsed.complexity,
      },
      "dojo"
    );
  }

  private async handleApprovedKata(payload: {
    proposalId: string;
    approvedBy: string;
  }): Promise<void> {
    const proposal = await this.api.memory.retrieve(
      `kata_proposal_${payload.proposalId}`
    );

    if (!proposal) {
      console.warn("Proposal not found:", payload.proposalId);
      return;
    }

    if (proposal.type === "install") {
      // Install from realm
      await this.installFromRealm(proposal.proposal, payload.approvedBy);
    } else if (proposal.type === "create") {
      // Create new kata
      await this.createNewKata(proposal.proposal, payload.approvedBy);
    }
  }

  private async installFromRealm(proposal: any, approvedBy: string) {
    if (!this.api.realms) return;

    const requestId = this.api.realms.requestInstall(
      proposal.name,
      proposal.versions[0].version, // Install latest
      proposal.fromRealm
    );

    this.api.realms.approveInstall(requestId.id, approvedBy);

    // Get DSL source from realm discovery result and register locally
    const source = proposal.versions[0].source;
    if (source) {
      try {
        const registry = new KataRegistry(this.api);
        await registry.register(source);
        console.log(`[dojo] Installed kata '${proposal.name}' from realm '${proposal.fromRealm}'`);
      } catch (error) {
        console.error(`[dojo] Failed to compile/register kata from realm: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.api.events.emit(
      "kata.installed",
      {
        kataName: proposal.name,
        kataVersion: proposal.versions[0].version,
        fromRealm: proposal.fromRealm,
      },
      "dojo"
    );
  }

  private async createNewKata(proposal: any, approvedBy: string) {
    // Build DSL source from the AI-generated proposal structure
    const lines: string[] = [];

    // Header
    lines.push(`kata ${proposal.name} v1`);

    // Required skills
    const skills: string[] = proposal.required_skills ?? [];
    for (const skill of skills) {
      lines.push(`  requires skill ${skill}`);
    }

    // Initial phase
    const phases: Array<{ name: string; description?: string }> = proposal.phases ?? [];
    if (phases.length > 0) {
      lines.push(`  initial ${phases[0].name}`);
    }
    lines.push("");

    // Phase blocks — each phase runs its corresponding skill (or first skill as fallback)
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const skill = skills[i] ?? skills[0] ?? "noop";
      lines.push(`  phase ${phase.name}`);
      lines.push(`    run skill ${skill}`);
      if (i < phases.length - 1) {
        lines.push(`    next ${phases[i + 1].name}`);
      } else {
        lines.push(`    complete`);
      }
      lines.push("");
    }

    const source = lines.join("\n").trim();

    // Compile, validate, and register
    try {
      const registry = new KataRegistry(this.api);
      const compiled = await registry.register(source);
      console.log(`[dojo] Created and registered kata '${compiled.name}' v${compiled.version} (${phases.length} phases)`);
    } catch (error) {
      console.error(`[dojo] Failed to compile/register new kata: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.api.events.emit(
      "kata.created",
      {
        kataName: proposal.name,
        createdBy: approvedBy,
        phases: phases.map((p) => p.name),
      },
      "dojo"
    );
  }
}
