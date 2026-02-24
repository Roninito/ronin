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

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class DojoAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Listen for capability.missing events
    this.api.events.on("capability.missing", async (payload: any) => {
      await this.handleMissingCapability(payload);
    });

    // Listen for kata.user_approved events
    this.api.events.on("kata.user_approved", async (payload: any) => {
      await this.handleApprovedKata(payload);
    });
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
    const proposalId = crypto.randomUUID();

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
    const proposalId = crypto.randomUUID();

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

    // TODO: Download kata source and compile
    // TODO: Register kata locally

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
    // TODO: Generate kata source from proposal
    // TODO: Compile and validate
    // TODO: Register locally

    this.api.events.emit(
      "kata.created",
      {
        kataName: proposal.name,
        createdBy: approvedBy,
        phases: proposal.phases.map((p: any) => p.name),
      },
      "dojo"
    );
  }
}
