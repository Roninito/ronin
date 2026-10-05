import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import type { Tool } from "../src/types/api.js";
import { loadContracts, type MarkdownContract } from "../src/tasker/contracts.js";

/**
 * Tasker — runs markdown contracts from ~/.ronin/contracts/*.md.
 *
 * Woken by `tasker.wake { contract }` (schedule-sensor's cron ticks),
 * run directly via `tasker.run { contract, context? }` (chatty, CLI, other
 * duties), or — for `trigger: event` contracts — by the bus event named in
 * the contract itself. Emits `tasker.completed` / `tasker.failed`.
 *
 * Two run modes per contract:
 * - sar: bounded tool-calling loop (api.ai.callTools + api.tools.execute,
 *   max 6 rounds) over the full tool registry.
 * - opencode: hands the prompt to the opencode-cli plugin (code-shaped or
 *   long-horizon work); falls back to sar when the plugin isn't loaded.
 */
export default class Tasker extends BaseDuty {
  private running = new Set<string>();

  constructor(api: DutyAPI) {
    super(api);
    this.api.events.on("tasker.wake", (data: unknown) => {
      const payload = data as { contract?: string };
      if (payload?.contract) void this.runContract(payload.contract, { wokenBy: "schedule-sensor" });
    });
    this.api.events.on("tasker.run", (data: unknown) => {
      const payload = data as { contract?: string; context?: unknown };
      if (payload?.contract) void this.runContract(payload.contract, payload.context);
    });
    // Event-triggered contracts subscribe to their own bus event.
    for (const contract of loadContracts()) {
      if (contract.trigger !== "event" || !contract.event) continue;
      const eventName = contract.event;
      const name = contract.name;
      this.api.events.on(eventName, (data: unknown) => {
        void this.runContract(name, { event: eventName, payload: data });
      });
    }
    console.log("📋 Tasker ready. Markdown contracts in ~/.ronin/contracts/");
  }

  async execute(): Promise<void> {
    // Event-driven — all handlers registered in constructor.
  }

  private async runContract(name: string, context: unknown): Promise<void> {
    const contract = loadContracts().find((c) => c.name === name);
    if (!contract) {
      console.warn(`[tasker] Unknown contract "${name}" — ignoring`);
      return;
    }
    if (this.running.has(name)) {
      console.log(`[tasker] "${name}" already running — skipping duplicate wake`);
      return;
    }
    this.running.add(name);
    console.log(`[tasker] Running "${name}" (mode=${contract.mode})`);
    try {
      const result = await this.attempt(contract, context);
      console.log(`[tasker] "${name}" completed`);
      this.api.events.emit("tasker.completed", { contract: name, result }, "tasker");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (contract.onFailure === "retry") {
        console.log(`[tasker] "${name}" failed (${message}) — retrying once`);
        try {
          const result = await this.attempt(contract, context);
          console.log(`[tasker] "${name}" completed on retry`);
          this.api.events.emit("tasker.completed", { contract: name, result, retried: true }, "tasker");
          return;
        } catch (retryError) {
          console.error(`[tasker] "${name}" retry failed:`, retryError);
        }
      } else {
        console.error(`[tasker] "${name}" failed:`, error);
      }
      if (contract.onFailure === "notify" || contract.onFailure === "retry") {
        this.api.events.emit("tasker.failed", { contract: name, error: message }, "tasker");
      }
    } finally {
      this.running.delete(name);
    }
  }

  private async attempt(contract: MarkdownContract, context: unknown): Promise<string> {
    const prompt =
      `${contract.prompt}\n\nTrigger context (JSON):\n${JSON.stringify(context ?? null)}`;
    if (contract.mode === "opencode") {
      if (this.api.plugins.has("opencode-cli")) {
        const out = (await this.api.plugins.call("opencode-cli", "execute", prompt, {
          workspace: process.cwd(),
          ...(contract.model ? { model: contract.model } : {}),
        })) as unknown;
        return typeof out === "string" ? out : JSON.stringify(out);
      }
      console.warn(`[tasker] "${contract.name}": opencode-cli not loaded, falling back to sar`);
    }
    return this.runSarLoop(contract, prompt);
  }

  /** Bounded tool-calling loop: callTools → execute → feed back, max 6 rounds. */
  private async runSarLoop(contract: MarkdownContract, prompt: string): Promise<string> {
    const tools = this.api.tools.getSchemas() as unknown as Tool[];
    let transcript = prompt;
    let lastText = "";
    for (let round = 0; round < 6; round++) {
      const res = await this.api.ai.callTools(transcript, tools, {
        ...(contract.model ? { model: contract.model } : {}),
        timeoutMs: 120000,
      });
      lastText = res.message?.content || "";
      const calls = res.toolCalls || [];
      if (calls.length === 0) return lastText;
      transcript += `\n\nAssistant: ${lastText || "(no text)"}`;
      for (const call of calls) {
        let observation: string;
        try {
          const result = await this.api.tools.execute(call.name, call.arguments || {});
          observation = JSON.stringify(result).slice(0, 4000);
        } catch (error) {
          observation = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
        }
        transcript += `\n\nTool ${call.name}(${JSON.stringify(call.arguments || {})}) returned:\n${observation}`;
      }
    }
    return lastText || "(no result after 6 tool rounds)";
  }
}
