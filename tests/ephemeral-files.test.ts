import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  registerEphemeralFile,
  sweepExpiredEphemeralFiles,
} from "../src/utils/ephemeralFiles.js";

describe("ephemeralFiles", () => {
  let scratchDir: string;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("registerEphemeralFile: file exists immediately, is gone after the TTL elapses", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-ephemeral-"));
    const filePath = join(scratchDir, "test.png");
    writeFileSync(filePath, "fake image bytes");

    registerEphemeralFile(filePath, 50);
    expect(existsSync(filePath)).toBe(true);

    await new Promise((r) => setTimeout(r, 150));
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(`${filePath}.expires`)).toBe(false);
  });

  it("sweepExpiredEphemeralFiles: removes a past-deadline orphan, leaves a future one untouched", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-ephemeral-sweep-"));

    const expiredFile = join(scratchDir, "expired.png");
    writeFileSync(expiredFile, "old bytes");
    writeFileSync(`${expiredFile}.expires`, String(Date.now() - 10_000));

    const freshFile = join(scratchDir, "fresh.png");
    writeFileSync(freshFile, "fresh bytes");
    writeFileSync(`${freshFile}.expires`, String(Date.now() + 60_000));

    const removed = await sweepExpiredEphemeralFiles(scratchDir);

    expect(removed).toBe(1);
    expect(existsSync(expiredFile)).toBe(false);
    expect(existsSync(`${expiredFile}.expires`)).toBe(false);
    expect(existsSync(freshFile)).toBe(true);
    expect(existsSync(`${freshFile}.expires`)).toBe(true);
  });

  it("sweepExpiredEphemeralFiles: returns 0 for a non-existent directory instead of throwing", async () => {
    const removed = await sweepExpiredEphemeralFiles(join(tmpdir(), "ronin-does-not-exist-" + Date.now()));
    expect(removed).toBe(0);
  });
});
