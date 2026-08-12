/**
 * On-demand source lookup for the canvas's code panel. Deliberately not part
 * of deriveGraph()'s output — including full file contents for every one of
 * 100+ nodes on every graph load would bloat the payload badly. Fetched
 * lazily, only for the one node currently selected.
 */

import { readFileSync } from "fs";
import type { DutyAPI } from "../types/index.js";
import type { GraphNode, ContractNode } from "./types.js";
import type { ContractV2Definition } from "../types/shared.js";
import { DutyProposalStorage } from "../duty/proposal-storage.js";
import { ContractProposalStorage } from "../contract/proposal-storage.js";
import { KataStorage } from "../task/storage.js";

export interface NodeSource {
  code: string;
  language: "typescript" | "dsl" | "text";
  /** True when this isn't a real file/DSL on disk — a best-effort reconstruction from stored structured fields. */
  reconstructed?: boolean;
}

function formatContractDsl(c: {
  name: string;
  version: string;
  description?: string;
  targetKata: string;
  targetKataVersion: string;
  triggerConfig: { type: string; expression?: string; eventType?: string; path?: string };
  parameters?: Record<string, unknown>;
  onFailureAction?: string;
}): string {
  const lines = [`contract ${c.name} ${c.version}`];
  if (c.description) lines.push(`  description ${c.description}`);
  lines.push(`  target kata ${c.targetKata} ${c.targetKataVersion}`);
  if (c.triggerConfig.type === "cron" && c.triggerConfig.expression) {
    lines.push(`  trigger cron "${c.triggerConfig.expression}"`);
  } else if (c.triggerConfig.type === "event" && c.triggerConfig.eventType) {
    lines.push(`  trigger event "${c.triggerConfig.eventType}"`);
  } else if (c.triggerConfig.type === "webhook" && c.triggerConfig.path) {
    lines.push(`  trigger webhook "${c.triggerConfig.path}"`);
  }
  if (c.parameters && Object.keys(c.parameters).length > 0) {
    lines.push(`  parameters { ${Object.entries(c.parameters).map(([k, v]) => `${k}: ${v}`).join(", ")} }`);
  }
  if (c.onFailureAction) lines.push(`  on_failure { action ${c.onFailureAction} }`);
  return lines.join("\n");
}

function formatContractNodeAsDsl(node: ContractNode): string {
  return formatContractDsl({
    name: node.name,
    version: node.version,
    description: node.description,
    targetKata: node.targetName,
    targetKataVersion: node.targetVersion ?? "v1",
    triggerConfig: {
      type: node.triggerType,
      expression: node.cronExpression,
      eventType: node.eventName,
      path: node.webhookPath,
    },
  });
}

export async function getNodeSource(node: GraphNode, api: DutyAPI): Promise<NodeSource | null> {
  if (node.kind === "duty") {
    if (node.ghost && node.proposalId) {
      const storage = new DutyProposalStorage(api);
      await storage.init();
      const proposal = await storage.getById(node.proposalId);
      return proposal ? { code: proposal.code, language: "typescript" } : null;
    }
    if (node.sourceRef.origin === "file" && node.sourceRef.path) {
      try {
        return { code: readFileSync(node.sourceRef.path, "utf-8"), language: "typescript" };
      } catch {
        return null;
      }
    }
    return null;
  }

  if (node.kind === "contract") {
    if (node.ghost && node.proposalId) {
      const storage = new ContractProposalStorage(api);
      await storage.init();
      const proposal = await storage.getById(node.proposalId);
      if (!proposal) return null;
      const c = proposal.contract as ContractV2Definition;
      return { code: formatContractDsl(c), language: "dsl" };
    }
    if (node.sourceRef.origin === "file" && node.sourceRef.path) {
      try {
        return { code: readFileSync(node.sourceRef.path, "utf-8"), language: "dsl" };
      } catch {
        return null;
      }
    }
    // Approved-via-proposal contracts have no backing file on disk — the DSL
    // text was never persisted past the (now-decided) proposal row. Show a
    // clearly-labeled reconstruction from stored fields instead of a dead end.
    return { code: formatContractNodeAsDsl(node), language: "dsl", reconstructed: true };
  }

  if (node.kind === "kata") {
    const storage = new KataStorage(api);
    await storage.init();
    const row = await storage.getByVersion(node.name, node.version);
    return row?.sourceCode ? { code: row.sourceCode, language: "dsl" } : null;
  }

  if (node.kind === "sensor") {
    const configLines = Object.entries(node.config).map(([k, v]) => `${k}: ${v}`).join("\n");
    return {
      code: `# Derived sensor — not a standalone file, just a rendering of\n# ${node.sourceRef.registryId ?? node.sourceRef.path ?? "its owner"}'s own schedule/watch/webhook declaration.\ntype: ${node.sensorType}\n${configLines}`,
      language: "text",
      reconstructed: true,
    };
  }

  return null;
}
