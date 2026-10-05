import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { loadContracts, cronMatches } from "../src/tasker/contracts.js";

/**
 * Schedule Sensor — emit-only sensing duty (never decides, only reports).
 *
 * Ticks every minute via `static schedule`. Each tick re-reads
 * ~/.ronin/contracts/*.md and emits `tasker.wake { contract }` for every
 * cron contract whose expression matches the current minute. Event and
 * manual contracts are tasker's own business (it subscribes to their bus
 * events directly) — this duty only watches the clock.
 */
export default class ScheduleSensor extends BaseDuty {
  static schedule = "* * * * *";

  /** contract name -> "YYYY-M-D-H-m" of the last emitted wake (same-minute dedupe). */
  private lastWoke = new Map<string, string>();

  constructor(api: DutyAPI) {
    super(api);
    console.log("⏰ Schedule sensor ready. Watching ~/.ronin/contracts/*.md");
  }

  async execute(): Promise<void> {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    for (const contract of loadContracts()) {
      if (contract.trigger !== "cron" || !contract.cron) continue;
      let due = false;
      try {
        due = cronMatches(contract.cron, now);
      } catch {
        console.warn(`[schedule-sensor] Bad cron in ${contract.file}, skipping`);
        continue;
      }
      if (!due) continue;
      if (this.lastWoke.get(contract.name) === stamp) continue;
      this.lastWoke.set(contract.name, stamp);
      console.log(`[schedule-sensor] Waking tasker for "${contract.name}"`);
      this.api.events.emit("tasker.wake", { contract: contract.name }, "schedule-sensor");
    }
  }
}
