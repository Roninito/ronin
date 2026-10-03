import type { Plugin } from "../src/plugins/base.js";
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * ElevenLabs TTS Plugin
 *
 * Cloud text-to-speech via https://elevenlabs.io (docs:
 * https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
 * Pure fetch + subprocess playback — no native modules, safe for compiled builds.
 *
 * Configuration (env keeps precedence; all also settable via config, see
 * ConfigService.applySpeechConfigToEnv):
 * - ELEVENLABS_API_KEY (required) — also speech.stt/tts.elevenlabsApiKey
 * - ELEVENLABS_VOICE_ID (default Rachel) — speech.tts.elevenlabsVoiceId
 * - ELEVENLABS_MODEL_ID (default eleven_multilingual_v2) — speech.tts.elevenlabsModelId
 *
 * Keyless installs fail with a clear message, never a stack trace.
 */

const API_BASE = "https://api.elevenlabs.io/v1";
/** Rachel — ElevenLabs' documented default/example voice. */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

interface ElevenLabsOptions {
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  outputPath?: string;
  outputFormat?: string;
}

function resolveApiKey(options?: ElevenLabsOptions): string {
  const key = options?.apiKey ?? process.env.ELEVENLABS_API_KEY ?? "";
  if (!key) {
    throw new Error(
      "ElevenLabs API key not configured. Set ELEVENLABS_API_KEY (or speech.tts.elevenlabsApiKey in config / the /voice page).",
    );
  }
  return key;
}

function resolveVoiceId(options?: ElevenLabsOptions): string {
  return options?.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
}

function resolveModelId(options?: ElevenLabsOptions): string {
  return options?.modelId ?? process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;
}

const elevenlabsPlugin: Plugin = {
  name: "elevenlabs",
  description: "Cloud text-to-speech via ElevenLabs",

  methods: {
    /**
     * Synthesize speech from text via ElevenLabs TTS.
     * @param text Text to speak
     * @param options Optional { apiKey, voiceId, modelId, stability, similarityBoost, outputPath, outputFormat }
     * @returns Path to generated audio file (mp3)
     */
    speak: async (...args: unknown[]): Promise<{ audioPath: string; voiceId: string; modelId: string }> => {
      const text = args[0] as string;
      const options = (args[1] || {}) as ElevenLabsOptions;

      if (!text?.trim()) {
        throw new Error("ElevenLabs: no text to speak.");
      }
      const apiKey = resolveApiKey(options);
      const voiceId = resolveVoiceId(options);
      const modelId = resolveModelId(options);
      const outputFormat = options.outputFormat ?? "mp3_44100_128";

      let response: Response;
      try {
        response = await fetch(
          `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text,
              model_id: modelId,
              voice_settings: {
                stability: options.stability ?? 0.5,
                similarity_boost: options.similarityBoost ?? 0.75,
              },
            }),
          },
        );
      } catch (err) {
        throw new Error(
          `ElevenLabs request failed: ${err instanceof Error ? err.message : String(err)}. Check network connectivity.`,
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        if (response.status === 401) {
          throw new Error("ElevenLabs: invalid API key (401). Check ELEVENLABS_API_KEY.");
        }
        throw new Error(`ElevenLabs TTS error (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      if (audioBuffer.length === 0) {
        throw new Error("ElevenLabs returned empty audio.");
      }
      const outputPath = options.outputPath || join(tmpdir(), `elevenlabs-${Date.now()}.mp3`);
      await writeFile(outputPath, audioBuffer);
      return { audioPath: outputPath, voiceId, modelId };
    },

    /**
     * Synthesize and play immediately through the host speakers.
     * @param text Text to speak
     * @param options Same as speak, plus { player } (Linux player override)
     */
    speakAndPlay: async (...args: unknown[]): Promise<void> => {
      const text = args[0] as string;
      const options = (args[1] || {}) as ElevenLabsOptions & { player?: string };

      const result = (await elevenlabsPlugin.methods.speak!(text, options)) as { audioPath: string };
      const audioPath = result.audioPath;

      let playCommand: string;
      let playArgs: string[];
      switch (process.platform) {
        case "darwin":
          playCommand = "afplay";
          playArgs = [audioPath];
          break;
        case "linux":
          playCommand = options.player || "paplay";
          playArgs = [audioPath];
          break;
        case "win32":
          playCommand = "powershell";
          playArgs = ["-c", `(New-Object Media.SoundPlayer "${audioPath}").PlaySync()`];
          break;
        default:
          throw new Error(`Platform ${process.platform} not supported for audio playback`);
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(playCommand, playArgs, { stdio: ["ignore", "pipe", "pipe"] });
          const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error("Audio playback timed out after 30 seconds"));
          }, 30000);
          let stderr = "";
          proc.stderr?.on("data", (data) => {
            stderr += data.toString();
          });
          proc.on("close", (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else reject(new Error(`Audio player (${playCommand}) failed with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
          });
          proc.on("error", (err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to spawn ${playCommand}: ${err.message}`));
          });
        });
      } finally {
        await unlink(audioPath).catch(() => {});
      }
    },

    /**
     * List voices on the ElevenLabs account (GET /v1/voices).
     * Used by the /voice settings page to populate the voice picker.
     */
    listVoices: async (...args: unknown[]): Promise<Array<{ id: string; name: string }>> => {
      const options = (args[0] || {}) as ElevenLabsOptions;
      const apiKey = resolveApiKey(options);

      let response: Response;
      try {
        response = await fetch(`${API_BASE}/voices`, {
          headers: { "xi-api-key": apiKey },
        });
      } catch (err) {
        throw new Error(
          `ElevenLabs request failed: ${err instanceof Error ? err.message : String(err)}. Check network connectivity.`,
        );
      }
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("ElevenLabs: invalid API key (401). Check ELEVENLABS_API_KEY.");
        }
        const detail = await response.text().catch(() => "");
        throw new Error(`ElevenLabs voices error (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }
      const data = (await response.json()) as { voices?: Array<{ voice_id: string; name: string }> };
      return (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }));
    },

    /**
     * Best-effort availability check: a key is configured AND the account endpoint answers.
     * Returns false (never throws) when keyless or unreachable — for settings UIs, not gating.
     */
    isAvailable: async (): Promise<boolean> => {
      if (!process.env.ELEVENLABS_API_KEY) return false;
      try {
        const response = await fetch(`${API_BASE}/user`, {
          headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  },
};

export default elevenlabsPlugin;
