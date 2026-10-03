import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { CrewClient } from "../src/dispatcher/crew.js";
import { WAKE_TOOL, NEEDS_HUMAN_TOOL, buildSweepPrompt } from "../src/dispatcher/tools.js";

const SOURCE = "crew-dispatcher";

/** Env kill-switch (announcer shape): set to "true" to skip every run. */
const KILL_SWITCH_ENV = "RONIN_CREW_DISPATCHER_DISABLED";

const MEMORY_KEY_LAST_RUN = "crewDispatcher.lastRun";
const MEMORY_KEY_WAKES = "crewDispatcher.wakes";
const MEMORY_KEY_RUNNING = "crewDispatcher.running";
/** A run holding the guard longer than this is presumed dead. */
const RUN_GUARD_STALE_MS = 10 * 60 * 1000;

interface WakeDecision {
  project: string;
  agent: string;
  task?: string;
  reason: string;
}

interface NeedsHumanDecision {
  project: string;
  summary: string;
  item?: string;
}

/**
 * Crew Dispatcher Duty (scheduled brain)
 *
 * Hourly sweep of every registered crew project: sense via the crew machine
 * service's GET /dispatcher rollup, reason via api.ai.callTools against the
 * fixed sweep policy, act via POST /cmd wake. Emits dispatcher.sweep every
 * run, dispatcher.woke per wake, dispatcher.needs_human per escalation.
 *
 * Shape follows duties/announcer.ts: static schedule, env kill-switch,
 * api.memory cooldowns, failure-tolerant (sense failures emit and return,
 * never throw out of execute).
 */
export default class CrewDispatcherDuty extends BaseDuty {
  static schedule = "0 * * * *"; // Every hour

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    if (process.env[KILL_SWITCH_ENV] === "true") {
      console.log(`[${SOURCE}] Skipped: ${KILL_SWITCH_ENV}=true`);
      return;
    }

    const cfg = this.api.config.getAll?.()?.dispatcher?.crew ?? {};
    const enabled = cfg.enabled ?? true;
    const maxWakesPerRun = cfg.maxWakesPerRun ?? 3;
    const cooldownMinutes = cfg.cooldownMinutes ?? 60;
    const dryRun = cfg.dryRun ?? false;

    if (!enabled) {
      console.log(`[${SOURCE}] Skipped: dispatcher.crew.enabled is false`);
      return;
    }

    // Single-run guard: hourly runs should never overlap, but a wedged run
    // must not block later ones either — treat a stale guard as dead.
    const runningSince = await this.api.memory.retrieve(MEMORY_KEY_RUNNING);
    if (typeof runningSince === "number" && Date.now() - runningSince < RUN_GUARD_STALE_MS) {
      console.log(`[${SOURCE}] Skipped: another sweep is already running`);
      return;
    }
    await this.api.memory.store(MEMORY_KEY_RUNNING, Date.now());

    const startedAt = Date.now();
    try {
      await this.sweep({ maxWakesPerRun, cooldownMinutes, dryRun });
    } finally {
      await this.api.memory.store(MEMORY_KEY_RUNNING, 0);
      await this.api.memory.store(MEMORY_KEY_LAST_RUN, startedAt);
    }
  }

  private async sweep(options: { maxWakesPerRun: number; cooldownMinutes: number; dryRun: boolean }): Promise<void> {
    const { maxWakesPerRun, cooldownMinutes, dryRun } = options;
    const startedAt = Date.now();

    let client: CrewClient;
    try {
      client = new CrewClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${SOURCE}] No crew client: ${message}`);
      this.api.events.emit("dispatcher.sweep", { error: message, woke: 0 }, SOURCE);
      return;
    }

    let rollupJson: string;
    let viaFallback = false;
    try {
      const sensed = await client.dispatcherWithFallback();
      rollupJson = JSON.stringify(sensed.rollup);
      viaFallback = sensed.viaFallback;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${SOURCE}] Sense failed: ${message}`);
      this.api.events.emit("dispatcher.sweep", { error: message, woke: 0 }, SOURCE);
      return;
    }

    const wakes = await this.api.memory.retrieve(MEMORY_KEY_WAKES);
    const lastWakeByAgent: Record<string, number> =
      wakes && typeof wakes === "object" ? (wakes as Record<string, number>) : {};
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const cooledDown = Object.entries(lastWakeByAgent)
      .filter(([, ts]) => typeof ts === "number" && Date.now() - ts < cooldownMs)
      .map(([key]) => key);

    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    let digest = "";
    try {
      const response = await this.api.ai.callTools(
        buildSweepPrompt(rollupJson, { maxWakes: maxWakesPerRun, cooledDown, dryRun }),
        [WAKE_TOOL, NEEDS_HUMAN_TOOL],
        { temperature: 0.3 },
      );
      toolCalls = response.toolCalls ?? [];
      digest = response.message?.content ?? "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${SOURCE}] Reason failed: ${message}`);
      this.api.events.emit("dispatcher.sweep", { error: message, woke: 0 }, SOURCE);
      return;
    }

    const wakeDecisions = toolCalls
      .filter((c) => c.name === "crew_wake")
      .map((c) => c.arguments as unknown as WakeDecision)
      .filter((d) => typeof d?.project === "string" && typeof d?.agent === "string");
    const humanFlags = toolCalls
      .filter((c) => c.name === "flag_needs_human")
      .map((c) => c.arguments as unknown as NeedsHumanDecision)
      .filter((d) => typeof d?.summary === "string");

    let woke = 0;
    let skippedCooldown = 0;
    const capped = wakeDecisions.slice(0, Math.max(0, maxWakesPerRun));
    for (const decision of capped) {
      const key = `${decision.project}/${decision.agent}`;
      const lastWake = lastWakeByAgent[key];
      if (typeof lastWake === "number" && Date.now() - lastWake < cooldownMs) {
        skippedCooldown++;
        continue;
      }
      if (dryRun) {
        console.log(`[${SOURCE}] dry-run wake ${key}: ${decision.reason}`);
        continue;
      }
      try {
        const result = await client.wake(decision.project, decision.agent, {
          task: decision.task,
          reason: `dispatcher: ${decision.reason}`.slice(0, 500),
        });
        lastWakeByAgent[key] = Date.now();
        woke++;
        this.api.events.emit(
          "dispatcher.woke",
          { project: decision.project, agent: decision.agent, task: decision.task ?? null, reason: decision.reason, out: result.out },
          SOURCE,
        );
      } catch (err) {
        console.error(`[${SOURCE}] Wake ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (wakeDecisions.length > capped.length) {
      console.log(`[${SOURCE}] Capped wakes at ${maxWakesPerRun} (model proposed ${wakeDecisions.length})`);
    }
    await this.api.memory.store(MEMORY_KEY_WAKES, lastWakeByAgent);

    for (const flag of humanFlags) {
      this.api.events.emit(
        "dispatcher.needs_human",
        { project: flag.project ?? "", summary: flag.summary, item: flag.item ?? null },
        SOURCE,
      );
    }

    this.api.events.emit(
      "dispatcher.sweep",
      {
        woke,
        skippedCooldown,
        capped: wakeDecisions.length - capped.length,
        needsHuman: humanFlags.length,
        dryRun,
        viaFallback,
        digest: digest.slice(0, 2000),
        durationMs: Date.now() - startedAt,
      },
      SOURCE,
    );
    console.log(`[${SOURCE}] Sweep done: woke=${woke} skippedCooldown=${skippedCooldown} needsHuman=${humanFlags.length}`);
  }
}
