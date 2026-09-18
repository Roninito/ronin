import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { defaultOutputPath, verifyCaptureOutput } from "../plugins/screenshot.js";

describe("screenshot plugin", () => {
  let scratchDir: string;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("defaultOutputPath: generates unique .png paths under the given directory", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-screenshot-"));
    const a = defaultOutputPath(scratchDir);
    const b = defaultOutputPath(scratchDir);

    expect(a).not.toBe(b);
    expect(a.startsWith(scratchDir)).toBe(true);
    expect(a.endsWith(".png")).toBe(true);
  });

  it("verifyCaptureOutput: resolves with path/format/capturedAt when the file exists and is non-empty", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-screenshot-"));
    const outputPath = join(scratchDir, "shot.png");
    writeFileSync(outputPath, "fake png bytes");

    const result = await verifyCaptureOutput(outputPath);
    expect(result.path).toBe(outputPath);
    expect(result.format).toBe("png");
    expect(typeof result.capturedAt).toBe("number");
  });

  it("verifyCaptureOutput: throws a clear cancellation error when the file was never written (user hit Escape)", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-screenshot-"));
    const outputPath = join(scratchDir, "never-written.png");

    await expect(verifyCaptureOutput(outputPath)).rejects.toThrow("Screenshot cancelled or failed");
  });

  it("verifyCaptureOutput: throws the same cancellation error for a zero-byte file", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-screenshot-"));
    const outputPath = join(scratchDir, "empty.png");
    writeFileSync(outputPath, "");

    await expect(verifyCaptureOutput(outputPath)).rejects.toThrow("Screenshot cancelled or failed");
  });
});
