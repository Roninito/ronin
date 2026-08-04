import type { Plugin } from "../src/plugins/base.js";
import { getConfigService } from "../src/config/ConfigService.js";

/**
 * MNGR here means the EXTERNAL orchestrator app at ~/Desktop/Bun Apps/mngr —
 * not Ronin's own internal "MNGR" Duty concept (see ARCHITECTURE.md §4/§8).
 * This plugin is the one-shot registration handshake: Ronin calls MNGR's
 * bootstrap-secret-gated POST /api/v1/workers/register to hand over its own
 * endpoint + an inbound token, so MNGR's existing ExecuteAgentTasks leaf can
 * dispatch tasks to Ronin exactly as it already does for sar-coder. Everything
 * after registration (task push, status poll) is MNGR calling Ronin, not the
 * reverse — see duties/mngr-worker.ts for the receiving side.
 */

export interface MngrConfig {
  baseUrl: string;
  registrationSecret: string;
  /** The secret Ronin itself generates and hands to MNGR — MNGR sends this back as Bearer auth on every dispatch call. */
  inboundToken: string;
}

function getMngrConfig(): MngrConfig {
  const cs = getConfigService();
  return {
    baseUrl: (cs.get("mngr.baseUrl") as string) || "",
    registrationSecret: (cs.get("mngr.registrationSecret") as string) || "",
    inboundToken: (cs.get("mngr.inboundToken") as string) || "",
  };
}

const mngrPlugin: Plugin = {
  name: "mngr",
  description: "Registration handshake with the external MNGR orchestrator — hands over Ronin's endpoint + inbound token",
  methods: {
    /** Connected/configured status only — never returns the secrets themselves. */
    getConfig(): { configured: boolean; baseUrl: string } {
      const cfg = getMngrConfig();
      return { configured: !!(cfg.baseUrl && cfg.registrationSecret && cfg.inboundToken), baseUrl: cfg.baseUrl };
    },

    async setConfig(updates: Partial<MngrConfig>): Promise<void> {
      const cs = getConfigService();
      for (const [k, v] of Object.entries(updates)) {
        await cs.set(`mngr.${k}`, v);
      }
    },

    /**
     * Registers (or re-registers) this Ronin instance with MNGR. Idempotent —
     * safe to call on a schedule as a heartbeat; MNGR upserts by worker name.
     */
    async register(name: string, endpointUrl: string): Promise<{ ok: boolean; status: number; body?: unknown; error?: string }> {
      const cfg = getMngrConfig();
      if (!cfg.baseUrl || !cfg.registrationSecret || !cfg.inboundToken) {
        return { ok: false, status: 0, error: "mngr plugin not configured — set mngr.baseUrl, mngr.registrationSecret, mngr.inboundToken" };
      }
      try {
        const res = await fetch(`${cfg.baseUrl}/api/v1/workers/register`, {
          method: "POST",
          headers: { "content-type": "application/json", "X-Registration-Secret": cfg.registrationSecret },
          body: JSON.stringify({ name, endpoint_url: endpointUrl, agent_token: cfg.inboundToken }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = await res.json().catch(() => undefined);
        return { ok: res.ok, status: res.status, body };
      } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
};

export default mngrPlugin;
