import type { Plugin } from "../src/plugins/base.js";
import { spawn } from "child_process";
import { stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export interface ScreenshotResult {
  path: string;
  format: "png";
  capturedAt: number;
}

export function defaultOutputPath(dir?: string): string {
  const filename = `screenshot-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  return join(dir ?? tmpdir(), filename);
}

/**
 * Confirms a screencapture invocation actually produced an image, rather than
 * exiting 0 on a user-cancelled interactive capture (-i/-w). Exported
 * separately so this check is testable without spawning a real process or
 * having a display available.
 */
export async function verifyCaptureOutput(outputPath: string): Promise<ScreenshotResult> {
  let size = 0;
  try {
    size = (await stat(outputPath)).size;
  } catch {
    // File doesn't exist at all.
  }

  if (size === 0) {
    throw new Error("Screenshot cancelled or failed — no image was captured.");
  }

  return { path: outputPath, format: "png", capturedAt: Date.now() };
}

async function runScreencapture(args: string[], outputPath: string): Promise<ScreenshotResult> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("screencapture", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`screencapture exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run screencapture: ${err.message}. Is this macOS?`));
    });
  });

  return verifyCaptureOutput(outputPath);
}

/**
 * Screenshot Plugin (macOS only)
 *
 * Captures the screen via the built-in `screencapture` CLI. Every capture
 * method verifies the output file actually exists and is non-empty before
 * returning — screencapture's interactive modes (-i, -w) exit 0 even when
 * the user cancels with Escape, which would otherwise look like success.
 */
const screenshotPlugin: Plugin = {
  name: "screenshot",
  description: "Capture the macOS screen (full screen, a display, an interactively-selected region, or window)",

  methods: {
    captureFullScreen: async (...args: unknown[]): Promise<ScreenshotResult> => {
      const outputPath = (args[0] as string) || defaultOutputPath();
      return runScreencapture(["-x", outputPath], outputPath);
    },

    captureDisplay: async (...args: unknown[]): Promise<ScreenshotResult> => {
      const displayId = args[0] as number;
      const outputPath = (args[1] as string) || defaultOutputPath();
      return runScreencapture(["-x", "-D", String(displayId), outputPath], outputPath);
    },

    captureInteractiveRegion: async (...args: unknown[]): Promise<ScreenshotResult> => {
      const outputPath = (args[0] as string) || defaultOutputPath();
      return runScreencapture(["-x", "-i", outputPath], outputPath);
    },

    captureInteractiveWindow: async (...args: unknown[]): Promise<ScreenshotResult> => {
      const outputPath = (args[0] as string) || defaultOutputPath();
      return runScreencapture(["-x", "-i", "-w", outputPath], outputPath);
    },
  },
};

export default screenshotPlugin;
