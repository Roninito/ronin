import type { Plugin } from "../src/plugins/base.js";
import { readdir } from "fs/promises";

interface SayResponse {
  spoken: string;
  wav: string;
  voice: string;
  source: string;
}

/**
 * agent-voice Plugin
 *
 * Client for a running `agent-voice serve` instance
 * (https://github.com/rodaddy/agent-voice) — a small HTTP server that speaks
 * one in-character line through a cloned/persona voice via an OmniVoice TTS
 * backend. This plugin only talks HTTP to an already-running agent-voice
 * server; it does not install, start, or manage agent-voice or OmniVoice
 * themselves.
 *
 * Configuration: AGENT_VOICE_URL (default http://127.0.0.1:7161) and
 * AGENT_VOICE_VOICE, both settable via config.speech.tts.agentVoiceUrl /
 * agentVoiceVoice (see duties/voice-config.ts for a settings UI), or the
 * matching env vars directly.
 */
const agentVoicePlugin: Plugin = {
  name: "agent-voice",
  description: "Speak text aloud using a cloned/persona voice via a running agent-voice server",

  methods: {
    /**
     * Speak text through agent-voice's /say endpoint.
     * @param text Text to speak (agent-voice extracts/condenses the spoken line itself)
     * @param options Optional { voice, baseUrl } overrides
     */
    speak: async (...args: unknown[]): Promise<SayResponse | { spoken: null }> => {
      const text = args[0] as string;
      const options = (args[1] || {}) as { voice?: string; baseUrl?: string };

      const baseUrl = options.baseUrl ?? process.env.AGENT_VOICE_URL ?? "http://127.0.0.1:7161";
      const voice = options.voice ?? process.env.AGENT_VOICE_VOICE;

      const body: Record<string, string> = { text };
      if (voice) body.voice = voice;

      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}/say`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw new Error(
          `Failed to reach agent-voice server at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}. Is \`agent-voice serve\` running?`,
        );
      }

      if (response.status === 204) {
        return { spoken: null };
      }
      if (response.status === 404) {
        throw new Error(`agent-voice: unknown voice "${voice}"`);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`agent-voice request failed (${response.status})${detail ? `: ${detail}` : ""}`);
      }

      return (await response.json()) as SayResponse;
    },

    /**
     * Best-effort local listing of configured voices — reads the agent-voice
     * voices directory on disk (only meaningful when agent-voice runs on the
     * same machine as Ronin, which is the expected personal-Mac setup).
     * Returns an empty array if the directory can't be read rather than
     * throwing, since this is a convenience for a settings UI, not a
     * capability check.
     */
    listVoices: async (...args: unknown[]): Promise<string[]> => {
      const voicesDir = (args[0] as string) ?? process.env.AGENT_VOICE_VOICES_DIR ?? "voices";
      try {
        const entries = await readdir(voicesDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    },

    /**
     * Best-effort reachability check for the configured agent-voice server.
     * Not authoritative — a 2xx/4xx response just means something is
     * listening on that port, not that TTS itself will succeed.
     */
    isAvailable: async (...args: unknown[]): Promise<boolean> => {
      const baseUrl = (args[0] as string) ?? process.env.AGENT_VOICE_URL ?? "http://127.0.0.1:7161";
      try {
        const response = await fetch(baseUrl.replace(/\/$/, ""), { method: "GET" });
        return response.status < 500;
      } catch {
        return false;
      }
    },
  },
};

export default agentVoicePlugin;
