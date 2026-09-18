/**
 * Dojo Agent: User-gated Contract Proposals & Realms Integration
 *
 * When a capability is missing or requested:
 * 1. Search realms for a matching automation
 * 2. Propose to user (pending approval)
 * 3. Wait for user decision
 * 4. Register approved contracts
 *
 * "Dojo" = training ground where new automations are vetted before activation.
 *
 * As of 2026-09-17 this drafts/installs Contracts (inline phase graphs)
 * instead of Kata DSL + KataRegistry — Kata was removed. This flow is
 * dormant today (nothing in the current duty set emits `capability.missing`),
 * so there's no live behavior this had to preserve exactly; the realm-search
 * → AI-draft → approval shape is kept, retargeted at the new model. Renamed
 * every `kata.*` event this emits/listens for to `dojo.*` to avoid colliding
 * with the unrelated `contract.proposal_approved`/`contract.task_*` events
 * the chatty-tool proposal flow and the task engine already use.
 */

import { randomUUID } from "crypto";
import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { parsePhaseBlocks } from "../src/contract/parser-v2.js";
import { validateContractPhases } from "../src/contract/phase-compiler.js";
import { CONTRACT_PHASE_GRAMMAR } from "../src/contract/phase-grammar.js";
import { describePhaseChain } from "../src/contract/phase-format.js";
import { ContractStorageV2 } from "../src/contract/storage-v2.js";
import type { ContractPhase } from "../src/types/shared.js";

interface DraftedContract {
  name: string;
  initialPhase: string;
  phases: Record<string, ContractPhase>;
  phasesDsl: string;
  tags?: string[];
  complexity?: string;
}

export default class DojoAgent extends BaseDuty {
  constructor(api: DutyAPI) {
    super(api);

    // Listen for capability.missing events
    this.api.events.on("capability.missing", async (payload: any) => {
      await this.handleMissingCapability(payload);
    });

    // Listen for dojo.contract_approved events (renamed from kata.user_approved)
    this.api.events.on("dojo.contract_approved", async (payload: any) => {
      await this.handleApprovedContract(payload);
    });

    console.log("🥋 Dojo Agent ready. Listening for capability.missing and dojo.contract_approved");
  }

  async execute(): Promise<void> {
    // Event-driven — all handlers registered in constructor
  }

  private async handleMissingCapability(payload: {
    intent: string;
    context?: string;
  }): Promise<void> {
    try {
      // Search realms for a matching automation
      const results = await this.api.ai.complete(
        `Search for existing automations that match this intent: ${payload.intent}

        Return JSON with structure:
        {
          "search_query": "...",
          "reasoning": "...",
          "expected_skills": ["skill1", "skill2"]
        }`
      );

      const parsed = JSON.parse(results);

      // Query realms via api.realms
      if (!(this.api as any).realms) {
        console.warn("Realms plugin not available");
        return;
      }

      const discovered = (this.api as any).realms.discover(parsed.search_query);

      if (discovered.length === 0) {
        // Nothing found - propose creating a new contract
        await this.proposeNewContract(payload.intent);
        return;
      }

      // Found candidates - propose best match
      const proposal = discovered[0]; // TODO: better ranking
      await this.proposeContractInstall(proposal);
    } catch (error) {
      console.error("Dojo error:", error);
      this.api.events.emit("dojo.error", { error: String(error) }, "dojo");
    }
  }

  private async proposeContractInstall(proposal: any): Promise<void> {
    const proposalId = randomUUID();

    await this.api.memory.store(`contract_proposal_${proposalId}`, {
      type: "install",
      proposal,
      createdAt: Date.now(),
    });

    // Emit event for UI to show approval dialog
    this.api.events.emit(
      "dojo.install_proposed",
      {
        proposalId,
        contractName: proposal.name,
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

  private async proposeNewContract(intent: string): Promise<void> {
    const proposalId = randomUUID();

    // Have the AI draft the phases-block DSL directly (same approach as
    // src/contract/propose.ts), rather than a structured phase-description
    // array we'd then have to hand-convert.
    const raw = await this.api.ai.complete(
      `Create an automation proposal for this intent: ${intent}

      Return JSON with structure:
      {
        "name": "example.intent",
        "phasesDsl": "<phases-block DSL text — see grammar below>",
        "tags": ["automation"],
        "complexity": "simple"
      }

      ${CONTRACT_PHASE_GRAMMAR}`
    );

    let parsed: { name: string; phasesDsl: string; tags?: string[]; complexity?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[dojo] AI proposal was not valid JSON");
      return;
    }

    const { initialPhase, phases } = parsePhaseBlocks(parsed.phasesDsl.split("\n"), 0);
    const validation = validateContractPhases(initialPhase, phases);
    if (!validation.valid) {
      console.error(`[dojo] AI-drafted phases failed validation: ${validation.errors.map((e) => e.message).join("; ")}`);
      return;
    }

    const draft: DraftedContract = {
      name: parsed.name,
      initialPhase,
      phases,
      phasesDsl: parsed.phasesDsl,
      tags: parsed.tags,
      complexity: parsed.complexity,
    };

    await this.api.memory.store(`contract_proposal_${proposalId}`, {
      type: "create",
      proposal: draft,
      originalIntent: intent,
      createdAt: Date.now(),
    });

    // Emit event for UI to show proposal dialog
    this.api.events.emit(
      "dojo.creation_proposed",
      {
        proposalId,
        contractName: draft.name,
        chain: describePhaseChain(draft.initialPhase, draft.phases),
        phasesDsl: draft.phasesDsl,
        tags: draft.tags,
        complexity: draft.complexity,
      },
      "dojo"
    );
  }

  private async handleApprovedContract(payload: {
    proposalId: string;
    approvedBy: string;
  }): Promise<void> {
    const proposal = await this.api.memory.retrieve(
      `contract_proposal_${payload.proposalId}`
    ) as { type: "install" | "create"; proposal: any } | undefined;

    if (!proposal) {
      console.warn("Proposal not found:", payload.proposalId);
      return;
    }

    if (proposal.type === "install") {
      await this.installFromRealm(proposal.proposal, payload.approvedBy);
    } else if (proposal.type === "create") {
      await this.registerNewContract(proposal.proposal as DraftedContract, payload.approvedBy);
    }
  }

  private async installFromRealm(proposal: any, approvedBy: string) {
    if (!(this.api as any).realms) return;

    const requestId = (this.api as any).realms.requestInstall(
      proposal.name,
      proposal.versions[0].version, // Install latest
      proposal.fromRealm
    );

    (this.api as any).realms.approveInstall(requestId.id, approvedBy);

    // Get phases DSL source from the realm discovery result and register it
    // as a manual-trigger contract locally — a realm-installed automation
    // has no schedule/event of its own; the user wires one up afterward via
    // the dashboard.
    const source = proposal.versions[0].source;
    if (source) {
      try {
        const { initialPhase, phases } = parsePhaseBlocks(String(source).split("\n"), 0);
        const validation = validateContractPhases(initialPhase, phases);
        if (!validation.valid) {
          throw new Error(validation.errors.map((e) => e.message).join("; "));
        }

        const storage = new ContractStorageV2(this.api);
        await storage.init();
        await storage.create({
          name: proposal.name,
          version: proposal.versions[0].version ?? "v1",
          initialPhase,
          phases,
          parameters: {},
          triggerType: "manual",
          triggerConfig: { type: "manual" },
          onFailureAction: "ignore",
          enabled: true,
        });
        console.log(
          `[dojo] Installed contract '${proposal.name}' from realm '${proposal.fromRealm}' (manual trigger — set a schedule/event in the dashboard)`
        );
      } catch (error) {
        console.error(`[dojo] Failed to parse/register contract from realm: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.api.events.emit(
      "dojo.installed",
      {
        contractName: proposal.name,
        contractVersion: proposal.versions[0].version,
        fromRealm: proposal.fromRealm,
      },
      "dojo"
    );
  }

  private async registerNewContract(proposal: DraftedContract, approvedBy: string) {
    try {
      const storage = new ContractStorageV2(this.api);
      await storage.init();
      await storage.create({
        name: proposal.name,
        version: "v1",
        initialPhase: proposal.initialPhase,
        phases: proposal.phases,
        parameters: {},
        triggerType: "manual",
        triggerConfig: { type: "manual" },
        onFailureAction: "ignore",
        enabled: true,
      });
      console.log(`[dojo] Created and registered contract '${proposal.name}' (${Object.keys(proposal.phases).length} phases)`);
    } catch (error) {
      console.error(`[dojo] Failed to register new contract: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.api.events.emit(
      "dojo.created",
      {
        contractName: proposal.name,
        createdBy: approvedBy,
        phases: Object.keys(proposal.phases),
      },
      "dojo"
    );
  }
}
