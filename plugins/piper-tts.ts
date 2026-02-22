import type { Plugin } from "../src/plugins/base.js";
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

interface PiperConfig {
  modelPath?: string;
  piperModelPath?: string;
  piperBinary?: string;
  speakerId?: number;
  lengthScale?: number;
  noiseScale?: number;
  noiseW?: number;
}

/**
 * Piper TTS Plugin
 * 
 * Local neural text-to-speech using Piper (https://github.com/rhasspy/piper)
 * 
 * Requirements:
 * - Install Piper: https://github.com/rhasspy/piper/releases
 * - Download voice models from HuggingFace
 * 
 * Example voices:
 * - en_US-lessac-medium
 * - en_US-amy-medium  
 * - en_US-ryan-high
 * - en_GB-southern_english_female-low
 * 
 * Setup:
 * 1. Download piper binary for your platform
 * 2. Download a model: wget https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx
 * 3. Set PIPER_MODEL_PATH environment variable or pass modelPath as option
 */
const piperPlugin: Plugin = {
  name: "piper",
  description: "Local neural text-to-speech using Piper",

  methods: {
    /**
     * Synthesize speech from text
     * @param text Text to speak
     * @param options Optional configuration overrides
     * @returns Path to generated audio file
     */
    speak: async (...args: unknown[]): Promise<{ audioPath: string; duration: number }> => {
      const text = args[0] as string;
      const options = (args[1] || {}) as PiperConfig & { outputPath?: string };
      
      // Get config from options or environment
      const modelPath = options?.modelPath ?? options?.piperModelPath ?? process.env.PIPER_MODEL_PATH;
      const piperBinary = options?.piperBinary ?? process.env.PIPER_BINARY ?? "piper";
      
      if (!modelPath) {
        throw new Error("Piper model path not configured. Set piper.modelPath in config.");
      }

      // Create temp output file
      const outputPath = options?.outputPath || join(tmpdir(), `piper-${Date.now()}.wav`);
      const textPath = join(tmpdir(), `piper-text-${Date.now()}.txt`);
      
      try {
        // Write text to temp file
        await writeFile(textPath, text, "utf-8");

        // Build command arguments
        const commandArgs = [
          "-m", modelPath,
          "-f", outputPath,
          "-i", textPath,
        ];

        // Add optional parameters
        const speakerId = options?.speakerId ?? (process.env.PIPER_SPEAKER_ID ? parseInt(process.env.PIPER_SPEAKER_ID) : 0);
        if (speakerId !== 0) {
          commandArgs.push("--speaker", String(speakerId));
        }
        
        const lengthScale = options?.lengthScale ?? (process.env.PIPER_LENGTH_SCALE ? parseFloat(process.env.PIPER_LENGTH_SCALE) : 1.0);
        if (lengthScale !== 1.0) {
          commandArgs.push("--length-scale", String(lengthScale));
        }
        
        if (options?.noiseScale !== undefined) {
          commandArgs.push("--noise-scale", String(options.noiseScale));
        }
        if (options?.noiseW !== undefined) {
          commandArgs.push("--noise-w", String(options.noiseW));
        }

        // Run piper
        const startTime = Date.now();
        
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(piperBinary, commandArgs, {
            stdio: ["ignore", "pipe", "pipe"]
          });

          let stderr = "";
          proc.stderr?.on("data", (data) => {
            stderr += data.toString();
          });

          proc.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              const msg = stderr.trim() || `exit code ${code}`;
              reject(new Error(`Piper failed: ${msg}. Check PIPER_MODEL_PATH and that the .onnx.json file exists next to the .onnx model.`));
            }
          });

          proc.on("error", (err) => {
            reject(new Error(`Failed to run piper: ${err.message}. Is piper installed?`));
          });
        });

        const duration = (Date.now() - startTime) / 1000;
        
        return { audioPath: outputPath, duration };
      } finally {
        // Cleanup temp text file
        try {
          await unlink(textPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    },

    /**
     * Stream speech audio (play immediately)
     * @param text Text to speak
     * @param options Optional configuration
     */
    speakAndPlay: async (...args: unknown[]): Promise<void> => {
      const text = args[0] as string;
      const options = (args[1] || {}) as PiperConfig & { player?: string };
      
      const result = await piperPlugin.methods.speak?.(text, options) as { audioPath: string };
      const audioPath = result.audioPath;
      
      // Play audio using system player
      const platform = process.platform;
      let playCommand: string;
      let playArgs: string[];

      switch (platform) {
        case "darwin":
          playCommand = "afplay";
          playArgs = [audioPath];
          break;
        case "linux":
          // Try different players
          playCommand = options?.player || "paplay";
          playArgs = playCommand === "paplay" ? [audioPath] : [audioPath];
          break;
        case "win32":
          playCommand = "powershell";
          playArgs = ["-c", `(New-Object Media.SoundPlayer "${audioPath}").PlaySync()`];
          break;
        default:
          throw new Error(`Platform ${platform} not supported for audio playback`);
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(playCommand, playArgs, { stdio: "ignore" });
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Audio player failed with code ${code}`));
          }
        });
        proc.on("error", reject);
      });

      // Cleanup audio file after playing
      try {
        await unlink(audioPath);
      } catch {
        // Ignore cleanup errors
      }
    },

    /**
     * List available voices (models)
     * Returns info about configured voice
     */
    getVoiceInfo: async (): Promise<{
      modelPath: string;
      modelName: string;
      language: string;
    }> => {
      const modelPath = process.env.PIPER_MODEL_PATH ?? "";
      
      if (!modelPath) {
        throw new Error("No model configured. Set PIPER_MODEL_PATH environment variable.");
      }

      // Extract model name from path
      const modelName = modelPath.split("/").pop()?.replace(".onnx", "") || "unknown";
      
      // Try to detect language from model name
      const langMatch = modelName.match(/^([a-z]{2})_/);
      const language = langMatch ? langMatch[1] : "unknown";

      return {
        modelPath,
        modelName,
        language
      };
    },

    /**
     * Download a voice model
     * @param modelName Name of model to download (e.g., "en_US-lessac-medium")
     * @param outputDir Directory to save model
     */
    downloadVoice: async (...args: unknown[]): Promise<{ modelPath: string; configPath: string }> => {
      const modelName = args[0] as string;
      const outputDir = (args[1] as string) || join(tmpdir(), "piper-voices");
      
      const baseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0";
      
      // Parse model name: en_US-lessac-medium
      const parts = modelName.split("-");
      if (parts.length < 3) {
        throw new Error("Invalid model name format. Expected: lang_REGION-name-quality");
      }

      const lang = parts[0];
      const region = parts[1];
      const name = parts[2];
      const quality = parts[3] || "medium";

      const modelUrl = `${baseUrl}/${lang}/${lang}_${region}/${name}/${quality}/${modelName}.onnx`;
      const configUrl = `${baseUrl}/${lang}/${lang}_${region}/${name}/${quality}/${modelName}.onnx.json`;

      // This would need actual download implementation
      // For now, return the URLs for manual download
      console.log(`To download ${modelName}:`);
      console.log(`  Model: ${modelUrl}`);
      console.log(`  Config: ${configUrl}`);
      console.log(`\nRun:`);
      console.log(`  wget ${modelUrl} -P ${outputDir}`);
      console.log(`  wget ${configUrl} -P ${outputDir}`);

      return {
        modelPath: join(outputDir, `${modelName}.onnx`),
        configPath: join(outputDir, `${modelName}.onnx.json`)
      };
    }
  }
};

export default piperPlugin;
