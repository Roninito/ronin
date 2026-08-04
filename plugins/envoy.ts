import type { Plugin } from "../src/plugins/base.js";
import { getConfigService } from "../src/config/ConfigService.js";

/**
 * Client for ENVOY's /api/v1 REST API (Phase 1 read + Phase 4 agent-drafting,
 * per envoy-integration-spec.md). Ronin's issued Service Principal is scoped
 * to items:draft, items:read, contacts:read, analytics:read — calls outside
 * that scope will 403 at ENVOY's own auth layer, by design.
 */

export interface EnvoyConfig {
  baseUrl: string;
  apiKey: string;
}

export interface EnvoyItem {
  id: string;
  projectId: string;
  state: string;
  source: "ai" | "manual" | "hybrid";
  sourceRef?: string;
  copy?: string;
  [key: string]: unknown;
}

function getEnvoyConfig(): EnvoyConfig {
  const cs = getConfigService();
  return {
    baseUrl: (cs.get("envoy.baseUrl") as string) || "",
    apiKey: (cs.get("envoy.apiKey") as string) || "",
  };
}

async function envoyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const cfg = getEnvoyConfig();
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new Error("ENVOY not configured — set envoy.baseUrl and envoy.apiKey (see /settings/api-keys in ENVOY)");
  }
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ENVOY API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const envoyPlugin: Plugin = {
  name: "envoy",
  description: "ENVOY /api/v1 client — read stage board/ledger/contacts, draft and submit Items for review",
  methods: {
    getConfig(): { connected: boolean; baseUrl: string } {
      const cfg = getEnvoyConfig();
      return { connected: !!(cfg.baseUrl && cfg.apiKey), baseUrl: cfg.baseUrl };
    },

    async setConfig(updates: Partial<EnvoyConfig>): Promise<void> {
      const cs = getConfigService();
      for (const [k, v] of Object.entries(updates)) {
        await cs.set(`envoy.${k}`, v);
      }
    },

    async listItems(projectId: string, state?: string): Promise<EnvoyItem[]> {
      const qs = state ? `?state=${encodeURIComponent(state)}` : "";
      const raw = await envoyFetch<{ items: EnvoyItem[] }>(`/api/v1/projects/${projectId}/items${qs}`);
      return raw.items;
    },

    async getItem(projectId: string, itemId: string): Promise<EnvoyItem> {
      return envoyFetch<EnvoyItem>(`/api/v1/projects/${projectId}/items/${itemId}`);
    },

    /** Always creates at draft, authored by this agent (spec §5) — never a state parameter. */
    async createDraftItem(
      projectId: string,
      input: { copy: string; channel: string; audience: unknown; assetRefs?: string[]; sourceRef?: string },
    ): Promise<{ id: string; state: string; authoredBy: string; sourceRef?: string }> {
      return envoyFetch(`/api/v1/projects/${projectId}/items`, {
        method: "POST",
        headers: { "Idempotency-Key": input.sourceRef ?? crypto.randomUUID() },
        body: JSON.stringify(input),
      });
    },

    /** Only while draft/adapted — ENVOY rejects (409) once an item has moved past that. */
    async patchItem(projectId: string, itemId: string, patch: { copy?: string; audience?: unknown }): Promise<EnvoyItem> {
      return envoyFetch(`/api/v1/projects/${projectId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(patch) });
    },

    /** Moves draft/adapted -> pending_review. Agent-authored items always land in review (spec Q4) regardless of the project's gate. */
    async submitItem(projectId: string, itemId: string): Promise<EnvoyItem> {
      return envoyFetch(`/api/v1/projects/${projectId}/items/${itemId}/submit`, { method: "POST" });
    },

    async listContacts(projectId: string, stage?: string): Promise<Array<Record<string, unknown>>> {
      const qs = stage ? `?stage=${encodeURIComponent(stage)}` : "";
      const raw = await envoyFetch<{ contacts: Array<Record<string, unknown>> }>(`/api/v1/projects/${projectId}/contacts${qs}`);
      return raw.contacts;
    },

    async getStages(projectId: string): Promise<Record<string, number>> {
      const raw = await envoyFetch<{ stageCounts: Record<string, number> }>(`/api/v1/projects/${projectId}/analytics/stages`);
      return raw.stageCounts;
    },

    async getLedger(projectId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
      const raw = await envoyFetch<{ entries: Array<Record<string, unknown>> }>(`/api/v1/projects/${projectId}/ledger?limit=${limit}`);
      return raw.entries;
    },

    async getConnections(projectId: string): Promise<Array<Record<string, unknown>>> {
      const raw = await envoyFetch<{ connections: Array<Record<string, unknown>> }>(`/api/v1/projects/${projectId}/connections`);
      return raw.connections;
    },
  },
};

export default envoyPlugin;
