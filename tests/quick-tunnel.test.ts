import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { QuickTunnel, extractTunnelUrl } from "../plugins/cloudflare/src/QuickTunnel.js";

describe("extractTunnelUrl", () => {
  it("finds a *.trycloudflare.com URL embedded in arbitrary cloudflared log text", () => {
    const log = `2026-08-09T00:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-08-09T00:00:01Z INF |  https://random-words-here.trycloudflare.com  |
2026-08-09T00:00:01Z INF Cannot determine default origin certificate path`;
    expect(extractTunnelUrl(log)).toBe("https://random-words-here.trycloudflare.com");
  });

  it("returns null when no URL is present yet (partial output)", () => {
    expect(extractTunnelUrl("2026-08-09T00:00:00Z INF Starting tunnel...")).toBeNull();
  });
});

describe("QuickTunnel — real spawn/capture flow against a fake cloudflared", () => {
  let dir: string;
  const spawned: number[] = [];

  afterEach(() => {
    for (const pid of spawned.splice(0)) {
      try { process.kill(pid); } catch { /* already gone */ }
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function fakeCloudflared(script: string): string {
    dir = mkdtempSync(join(tmpdir(), "ronin-quicktunnel-test-"));
    const path = join(dir, "fake-cloudflared");
    writeFileSync(path, `#!/bin/bash\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  it("captures the real URL a (fake) cloudflared process prints to stderr, and returns its PID", async () => {
    const bin = fakeCloudflared(`
      echo "starting..." >&2
      sleep 0.05
      echo "|  https://fake-words-here.trycloudflare.com  |" >&2
      sleep 5
    `);
    const tunnel = new QuickTunnel(bin, []);
    const handle = await tunnel.start(3000, 3000);
    spawned.push(handle.pid);

    expect(handle.url).toBe("https://fake-words-here.trycloudflare.com");
    expect(handle.pid).toBeGreaterThan(0);

    // stop() actually works against the captured PID
    expect(tunnel.stop(handle.pid)).toBe(true);
  });

  it("rejects with a clear error if the process exits before printing a URL", async () => {
    const bin = fakeCloudflared(`echo "boom" >&2; exit 1`);
    const tunnel = new QuickTunnel(bin, []);
    await expect(tunnel.start(3000, 3000)).rejects.toThrow(/exited early/);
  });

  it("times out if no URL is ever printed", async () => {
    const bin = fakeCloudflared(`sleep 5`);
    const tunnel = new QuickTunnel(bin, []);
    await expect(tunnel.start(3000, 200)).rejects.toThrow(/Timed out/);
  });

  it("isInstalled() reflects whether the configured binary actually resolves", async () => {
    const bin = fakeCloudflared(`exit 0`);
    expect(await new QuickTunnel(bin, []).isInstalled()).toBe(true);
    expect(await new QuickTunnel("definitely-not-a-real-binary-xyz", []).isInstalled()).toBe(false);
  });
});
