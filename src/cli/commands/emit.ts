/**
 * Emit command: send an event to a running Ronin instance via HTTP.
 * Useful for Shortcuts, scripts, and testing.
 */

export interface EmitOptions {
  event: string;
  data?: string;
  port?: number;
}

async function emitToServer(event: string, data: unknown, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api/events/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data: data ?? {} }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Server responded with:", (err as { error?: string }).error ?? response.statusText);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Request failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

function parseData(raw: string | undefined): unknown {
  if (raw === undefined || raw === "") return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    console.error("Invalid JSON for data. Use a JSON object string, e.g. '{\"audioPath\":\"/path/to/file.wav\"}'");
    process.exit(1);
  }
}

export async function emitCommand(options: EmitOptions): Promise<void> {
  const { event, data: dataRaw, port: portOpt } = options;
  const port = portOpt ?? (process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) : 3000);
  const data = parseData(dataRaw);

  const ok = await emitToServer(event, data, port);
  if (ok) {
    console.log("✅ Event emitted:", event);
  } else {
    console.error("❌ Could not emit event. Is Ronin running? Try: ronin start");
    process.exit(1);
  }
}
