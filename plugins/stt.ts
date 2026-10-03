import type { Plugin } from "../src/plugins/base.js";
import type { EventsAPI } from "../src/api/events.js";
import { spawn } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { join, basename } from "path";
import { tmpdir } from "os";

let eventsAPI: EventsAPI | null = null;

/**
 * Speech-to-Text Plugin
 *
 * Cross-platform STT with multiple backends:
 * - macOS: Built-in speech recognition via Shortcuts/AppleScript
 * - All platforms: Whisper (local), Deepgram (cloud), or ElevenLabs (cloud, Scribe)
 *
 * Listens for event "transcribe.text": when any agent emits it, the plugin
 * records (or transcribes the given file) and emits "stt.transcribed" with { text }.
 *
 * Environment Variables:
 * - STT_BACKEND: "whisper", "deepgram", "elevenlabs", or "apple" (auto-detected on macOS)
 * - WHISPER_MODEL_PATH: Path to whisper.cpp model (for whisper backend)
 * - WHISPER_BINARY: Path to whisper.cpp binary
 * - DEEPGRAM_API_KEY: API key for Deepgram
 * - ELEVENLABS_API_KEY: API key for ElevenLabs (Scribe STT)
 */
// `satisfies` (not `: Plugin`) preserves concrete per-method signatures so the
// self-reference below (`sttPlugin.methods.transcribe`) resolves to a real,
// always-defined method instead of an optional index-signature hit.
const sttPlugin = {
  name: "stt",
  description: "Speech-to-text with cross-platform support",

  methods: {
    /**
     * Called by Ronin API to wire the event bus. Registers listener for "transcribe.text".
     */
    setEventsAPI: (api: unknown): void => {
      if (eventsAPI) return;
      eventsAPI = api as EventsAPI;
      eventsAPI.on("transcribe.text", async (data: unknown) => {
        const payload = (data && typeof data === "object" ? data as Record<string, unknown> : {}) as {
          audioPath?: string;
          duration?: number;
          source?: string;
          language?: string;
        };
        const requestSource = payload.source ?? "unknown";
        try {
          let text: string;
          if (payload.audioPath) {
            const result = await sttPlugin.methods.transcribe!(payload.audioPath, { language: payload.language }) as { text: string };
            text = result.text;
          } else {
            const duration = typeof payload.duration === "number" ? payload.duration : 5;
            const result = await sttPlugin.methods.recordAndTranscribe!(duration, { language: payload.language }) as { text: string };
            text = result.text;
          }
          eventsAPI?.emit("stt.transcribed", { text, requestSource }, "stt");
        } catch (err) {
          eventsAPI?.emit("stt.transcribed", {
            text: "",
            requestSource,
            error: err instanceof Error ? err.message : String(err),
          }, "stt");
        }
      });
    },

    /**
     * Transcribe audio file to text
     * @param audioPath Path to audio file (wav, mp3, etc.)
     * @param options Optional configuration
     * @returns Transcribed text
     */
    transcribe: async (...args: unknown[]): Promise<{ text: string; confidence?: number }> => {
      const audioPath = args[0] as string;
      const options = (args[1] || {}) as { language?: string; backend?: string };
      
      const backend = options.backend || process.env.STT_BACKEND || detectDefaultBackend();
      
      switch (backend) {
        case "apple":
          return transcribeApple(audioPath, options);
        case "whisper":
          return transcribeWhisper(audioPath, options);
        case "deepgram":
          return transcribeDeepgram(audioPath, options);
        case "elevenlabs":
          return transcribeElevenlabs(audioPath, options);
        default:
          throw new Error(`Unknown STT backend: ${backend}`);
      }
    },

    /**
     * Record audio from the microphone and transcribe.
     * Recording is ffmpeg-first (avfoundation/pulse/alsa/dshow input per platform)
     * with a sox fallback — either recorder works, neither is macOS-only.
     * @param duration Recording duration in seconds
     * @returns Transcribed text plus the recording path
     */
    recordAndTranscribe: async (...args: unknown[]): Promise<{ text: string; audioPath: string }> => {
      const duration = (args[0] as number) || 5;
      const options = (args[1] || {}) as { language?: string };

      const audioPath = join(tmpdir(), `recording-${Date.now()}.wav`);

      await recordWithFfmpegOrSox(audioPath, duration);

      // Transcribe the recorded audio
      const result = await sttPlugin.methods.transcribe(audioPath, options) as { text: string };

      return { text: result.text, audioPath };
    },

    /**
     * List available STT backends
     */
    listBackends: async (): Promise<string[]> => {
      const backends: string[] = [];
      
      if (process.platform === "darwin") {
        backends.push("apple (macOS native)");
      }
      
      // Check if whisper is available
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(process.env.WHISPER_BINARY || "whisper", ["--help"], { stdio: "ignore" });
          proc.on("close", (code) => code === 0 ? resolve() : reject());
          proc.on("error", reject);
        });
        backends.push("whisper (local)");
      } catch {
        // Not available
      }
      
      if (process.env.DEEPGRAM_API_KEY) {
        backends.push("deepgram (cloud)");
      }

      if (process.env.ELEVENLABS_API_KEY) {
        backends.push("elevenlabs (cloud)");
      }

      return backends;
    }
  }
} satisfies Plugin;

/**
 * Detect default backend based on platform and available tools
 */
function detectDefaultBackend(): string {
  if (process.platform === "darwin") {
    return "apple";
  }
  if (process.env.WHISPER_MODEL_PATH) {
    return "whisper";
  }
  if (process.env.DEEPGRAM_API_KEY) {
    return "deepgram";
  }
  if (process.env.ELEVENLABS_API_KEY) {
    return "elevenlabs";
  }
  throw new Error("No STT backend available. Set WHISPER_MODEL_PATH, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY, or run on macOS.");
}

/**
 * Candidate ffmpeg input arg prefixes per platform, tried in order.
 * See https://ffmpeg.org/ffmpeg-devices.html
 */
function ffmpegInputCandidates(): string[][] {
  if (process.platform === "darwin") {
    return [["-f", "avfoundation", "-i", ":0"]];
  }
  if (process.platform === "win32") {
    return [["-f", "dshow", "-i", "audio=default"]];
  }
  // Linux and everything else: pulseaudio first, ALSA fallback.
  return [
    ["-f", "pulse", "-i", "default"],
    ["-f", "alsa", "-i", "default"],
  ];
}

function spawnCapture(cmd: string, args: string[]): Promise<{ code: number | null; stderr: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => resolve({ code, stderr }));
    proc.on("error", (err) => resolve({ code: null, stderr, spawnError: err }));
  });
}

/**
 * Record `duration` seconds of 16kHz mono audio to `outputPath`.
 * ffmpeg first (its input-device coverage is the cross-platform story), sox
 * fallback (the historical recorder). Throws one clear error when neither
 * is usable — never a bare ENOENT stack trace.
 */
async function recordWithFfmpegOrSox(outputPath: string, duration: number): Promise<void> {
  const failures: string[] = [];

  for (const inputArgs of ffmpegInputCandidates()) {
    const result = await spawnCapture("ffmpeg", [
      "-y",
      "-loglevel", "error",
      ...inputArgs,
      "-t", String(duration),
      "-ar", "16000",
      "-ac", "1",
      outputPath,
    ]);
    if (result.code === 0) return;
    if (result.spawnError && (result.spawnError as NodeJS.ErrnoException).code === "ENOENT") {
      failures.push("ffmpeg is not installed");
      break; // No point trying other inputs when the binary itself is missing.
    }
    failures.push(`ffmpeg (${inputArgs.join(" ")}) failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
  }

  // sox fallback (macOS/Linux): `sox -d` records from the default device.
  if (process.platform !== "win32") {
    const sox = await spawnCapture("sox", [
      "-d",
      "-r", "16000",
      "-c", "1",
      "-b", "16",
      outputPath,
      "trim", "0", String(duration),
    ]);
    if (sox.code === 0) return;
    if (!(sox.spawnError && (sox.spawnError as NodeJS.ErrnoException).code === "ENOENT")) {
      failures.push(`sox failed: ${sox.stderr.trim() || `exit code ${sox.code}`}`);
    }
  }

  throw new Error(
    `Could not record audio (${failures.join("; ") || "no recorder available"}). ` +
      `Install ffmpeg (brew install ffmpeg) for microphone recording.`,
  );
}

/**
 * Transcribe using macOS Shortcuts app.
 * Requires a Shortcut named "Transcribe Audio" that accepts an audio file and outputs text.
 * See docs/STT_APPLE_SHORTCUT.md for how to create it.
 */
async function transcribeApple(
  audioPath: string,
  _options: { language?: string }
): Promise<{ text: string; confidence?: number }> {
  if (process.platform !== "darwin") {
    throw new Error("Apple STT backend is only available on macOS");
  }

  const outputPath = join(tmpdir(), `apple-stt-${Date.now()}.txt`);

  return new Promise((resolve, reject) => {
    const proc = spawn("shortcuts", [
      "run",
      "Transcribe Audio",
      "-i", audioPath,
      "-o", outputPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", async (code) => {
      try {
        if (code === 0) {
          const text = await readFile(outputPath, "utf-8");
          await unlink(outputPath).catch(() => {});
          resolve({ text: text.trim() });
        } else {
          await unlink(outputPath).catch(() => {});
          reject(new Error(`Shortcut failed (exit ${code}): ${stderr || "see Shortcuts app"}. Create "Transcribe Audio" per docs/STT_APPLE_SHORTCUT.md`));
        }
      } catch (err) {
        reject(new Error(`Apple STT failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run 'shortcuts' command: ${err.message}. Ensure the Shortcut "Transcribe Audio" exists (see docs/STT_APPLE_SHORTCUT.md).`));
    });
  });
}

/**
 * Transcribe using whisper.cpp (local)
 */
async function transcribeWhisper(
  audioPath: string,
  options: { language?: string }
): Promise<{ text: string; confidence?: number }> {
  const modelPath = process.env.WHISPER_MODEL_PATH;
  const whisperBinary = process.env.WHISPER_BINARY || "whisper-cli";
  
  if (!modelPath) {
    throw new Error("WHISPER_MODEL_PATH not set. Download a model from https://huggingface.co/ggerganov/whisper.cpp");
  }

  const outputPath = join(tmpdir(), `whisper-${Date.now()}.txt`);
  
  const args = [
    "-m", modelPath,
    "-f", audioPath,
    "-otxt",
    "-of", outputPath.replace(".txt", ""),
  ];
  
  if (options.language) {
    args.push("-l", options.language);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(whisperBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    
    proc.on("close", async (code) => {
      try {
        if (code === 0) {
          const text = await readFile(outputPath, "utf-8");
          await unlink(outputPath);
          resolve({ text: text.trim() });
        } else {
          reject(new Error(`Whisper failed with code ${code}: ${stderr}`));
        }
      } catch (err) {
        reject(new Error(`Failed to read whisper output: ${err}`));
      }
    });
    
    proc.on("error", (err) => {
      reject(new Error(`Failed to run whisper: ${err.message}. Is whisper.cpp installed?`));
    });
  });
}

/**
 * Transcribe using Deepgram API (cloud)
 */
async function transcribeDeepgram(
  audioPath: string,
  options: { language?: string }
): Promise<{ text: string; confidence: number }> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY not set");
  }

  // Read audio file
  const audioBuffer = await readFile(audioPath);
  
  // Call Deepgram API
  const response = await fetch("https://api.deepgram.com/v1/listen", {
    method: "POST",
    headers: {
      "Authorization": `Token ${apiKey}`,
      "Content-Type": "audio/wav",
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Deepgram API error: ${error}`);
  }

  const data = await response.json();
  const transcript = data.results?.channels[0]?.alternatives[0];

  return {
    text: transcript?.transcript || "",
    confidence: transcript?.confidence || 0,
  };
}

/**
 * Transcribe using ElevenLabs Scribe (cloud).
 * See https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
async function transcribeElevenlabs(
  audioPath: string,
  options: { language?: string }
): Promise<{ text: string; confidence?: number }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY not set. Set it (or speech.stt.elevenlabsApiKey in config / the /voice page) to use ElevenLabs STT."
    );
  }

  const audioBuffer = await readFile(audioPath);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audioBuffer)]), basename(audioPath) || "audio.wav");
  form.append("model_id", "scribe_v2");
  if (options.language) {
    form.append("language_code", options.language);
  }

  let response: Response;
  try {
    response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });
  } catch (err) {
    throw new Error(`ElevenLabs STT request failed: ${err instanceof Error ? err.message : String(err)}. Check network connectivity.`);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("ElevenLabs: invalid API key (401). Check ELEVENLABS_API_KEY.");
    }
    const error = await response.text().catch(() => "");
    throw new Error(`ElevenLabs STT error (${response.status})${error ? `: ${error.slice(0, 300)}` : ""}`);
  }

  const data = (await response.json()) as { text?: string };
  return { text: data.text ?? "" };
}

export default sttPlugin;
