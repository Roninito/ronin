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

    /**
     * List MNGR's tasks ("duties" in the sense a user usually means when asking Ronin
     * what MNGR has going on — distinct from Ronin's own internal Duty concept).
     * GET /api/v1/tasks is unauthenticated on MNGR's side (only mutating verbs are
     * gated), so this only needs baseUrl — no registration secret/token required.
     * Positional args, not an options object — the generic plugin-tool dispatcher
     * (src/api/index.ts) flattens whatever the model sends into a positional array
     * before calling the plugin method, same reason plugins/git.ts's log() takes a
     * plain number rather than { limit }.
     */
    async listTasks(
      projectId?: string,
      assignedTo?: string,
      status?: string
    ): Promise<{ ok: boolean; status: number; tasks?: unknown[]; error?: string }> {
      const cfg = getMngrConfig();
      if (!cfg.baseUrl) {
        return { ok: false, status: 0, error: "mngr plugin not configured — set mngr.baseUrl" };
      }
      try {
        const params = new URLSearchParams();
        if (projectId) params.set("project_id", projectId);
        if (assignedTo) params.set("assigned_to", assignedTo);
        if (status) params.set("status", status);
        const qs = params.toString();
        const res = await fetch(`${cfg.baseUrl}/api/v1/tasks${qs ? `?${qs}` : ""}`, {
          signal: AbortSignal.timeout(10_000),
        });
        const body = await res.json().catch(() => undefined);
        if (!res.ok) {
          const errMsg =
            body && typeof body === "object" && "error" in body
              ? String((body as { error: unknown }).error)
              : `HTTP ${res.status}`;
          return { ok: false, status: res.status, error: errMsg };
        }
        return { ok: true, status: res.status, tasks: Array.isArray(body) ? body : [] };
      } catch (e) {
        return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  toolMetadata: {
    getConfig: {
      description:
        "Check whether Ronin is configured to talk to MNGR (the external task orchestrator) and what its base URL is. Never returns secrets.",
    },
    register: {
      description:
        "Register (or re-register) this Ronin instance with MNGR so MNGR can dispatch tasks to it. Idempotent — safe to call repeatedly.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Worker name to register as" },
          endpointUrl: { type: "string", description: "URL MNGR should call to dispatch tasks to this Ronin instance" },
        },
        required: ["name", "endpointUrl"],
      },
    },
    listTasks: {
      description:
        "List MNGR's tasks — what a user usually means by \"tasks\" or \"duties\" in MNGR specifically, distinct from Ronin's own internal duties. Optionally filter by project, assignee, or status.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Filter to tasks in this MNGR project ID" },
          assignedTo: { type: "string", description: "Filter to tasks assigned to this MNGR worker ID" },
          status: { type: "string", description: "Filter by status, e.g. open, in_progress, blocked, done, cancelled" },
        },
        required: [],
      },
    },
  },
};

export default mngrPlugin;
