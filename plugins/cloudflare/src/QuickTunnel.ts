/**
 * QuickTunnel — real cloudflared quick tunnels (`cloudflared tunnel --url`).
 *
 * Anonymous, no Cloudflare account or DNS setup needed: cloudflared assigns a
 * random *.trycloudflare.com hostname and prints it to its own stderr the
 * moment the tunnel is up. This is the real source of the URL that
 * `tunnel temp` used to fabricate (see index.ts's tunnelTemp for history) —
 * unlike named `wrangler tunnel` tunnels, which require an authenticated
 * account and a DNS route the CLI never actually sets up.
 */

import { execSync, spawn, type ChildProcess } from "child_process";

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** Pure helper: pull the assigned quick-tunnel URL out of cloudflared's stderr output, if present. */
export function extractTunnelUrl(text: string): string | null {
  return text.match(TUNNEL_URL_PATTERN)?.[0] ?? null;
}

export interface QuickTunnelHandle {
  url: string;
  pid: number;
}

export class QuickTunnel {
  /** Binary + base args, overridable for tests (spawn a fake stand-in instead of real cloudflared). */
  constructor(
    private readonly binary: string = "cloudflared",
    private readonly baseArgs: string[] = ["tunnel", "--url"]
  ) {}

  async isInstalled(): Promise<boolean> {
    try {
      execSync(`which ${this.binary}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start a detached `cloudflared tunnel --url http://localhost:<port>`,
   * capture the real assigned URL from its stderr, then let it keep running
   * independently in the background (the CLI process that called this can
   * exit immediately after). Returns the PID so it can be stopped later —
   * that's the only handle that survives across separate CLI invocations.
   */
  async start(localPort: number, timeoutMs: number = 15000): Promise<QuickTunnelHandle> {
    if (!(await this.isInstalled())) {
      throw new Error(
        "cloudflared is not installed. Install it: macOS `brew install cloudflared`, " +
        "Linux (see setup-env.sh for distro-specific steps), or " +
        "https://github.com/cloudflare/cloudflared/releases"
      );
    }

    const proc: ChildProcess = spawn(
      this.binary,
      [...this.baseArgs, `http://localhost:${localPort}`],
      { detached: true, stdio: ["ignore", "ignore", "pipe"] }
    );

    const url = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* already gone */ }
        reject(new Error("Timed out waiting for cloudflared to report a tunnel URL"));
      }, timeoutMs);

      proc.stderr?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const found = extractTunnelUrl(buffer);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        }
      });

      proc.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.once("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`cloudflared exited early with code ${code}`));
        }
      });
    });

    if (!proc.pid) {
      try { proc.kill(); } catch { /* already gone */ }
      throw new Error("cloudflared started but reported no PID");
    }

    proc.unref(); // let the CLI process exit without waiting on this background tunnel
    return { url, pid: proc.pid };
  }

  /** Stop a previously started quick tunnel by PID (persisted via tunnelState). */
  stop(pid: number): boolean {
    try {
      process.kill(pid);
      return true;
    } catch {
      return false; // already gone
    }
  }
}
