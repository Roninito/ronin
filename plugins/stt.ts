import type { Plugin } from "../src/plugins/base.js";
import type { EventsAPI } from "../src/api/events.js";
import { spawn } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let eventsAPI: EventsAPI | null = null;

/**
 * Speech-to-Text Plugin
 *
 * Cross-platform STT with multiple backends:
 * - macOS: Built-in speech recognition via Shortcuts/AppleScript
 * - All platforms: Whisper (local) or Deepgram (cloud)
 *
 * Listens for event "transcribe.text": when any agent emits it, the plugin
 * records (or transcribes the given file) and emits "stt.transcribed" with { text }.
 *
 * Environment Variables:
 * - STT_BACKEND: "whisper", "deepgram", or "apple" (auto-detected on macOS)
 * - WHISPER_MODEL_PATH: Path to whisper.cpp model (for whisper backend)
 * - WHISPER_BINARY: Path to whisper.cpp binary
 * - DEEPGRAM_API_KEY: API key for Deepgram
 */
const sttPlugin: Plugin = {
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
        default:
          throw new Error(`Unknown STT backend: ${backend}`);
      }
    },

    /**
     * Record audio from microphone and transcribe (macOS only via AppleScript)
     * @param duration Recording duration in seconds
     * @returns Transcribed text
     */
    recordAndTranscribe: async (...args: unknown[]): Promise<{ text: string; audioPath: string }> => {
      const duration = (args[0] as number) || 5;
      const options = (args[1] || {}) as { language?: string };
      
      if (process.platform !== "darwin") {
        throw new Error("recordAndTranscribe is only supported on macOS. Use transcribe() with a pre-recorded file on other platforms.");
      }
      
      // Record using sox or similar
      const audioPath = join(tmpdir(), `recording-${Date.now()}.wav`);
      
      // Try to use sox (brew install sox)
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("sox", [
          "-d",  // Default audio device
          "-r", "16000",  // 16kHz
          "-c", "1",  // Mono
          "-b", "16",  // 16-bit
          audioPath,
          "trim", "0", String(duration)
        ], { stdio: "ignore" });
        
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Recording failed with code ${code}. Is sox installed? (brew install sox)`));
          }
        });
        
        proc.on("error", () => {
          reject(new Error("Failed to run sox. Install with: brew install sox"));
        });
      });
      
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
      
      return backends;
    }
  }
};

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
  throw new Error("No STT backend available. Set WHISPER_MODEL_PATH, DEEPGRAM_API_KEY, or run on macOS.");
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

export default sttPlugin;
