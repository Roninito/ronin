import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

const MEMORY_KEY_LAST_ANNOUNCE = "announcer.lastBootAnnounce";
const ANNOUNCE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Announcer Agent
 *
 * Speaks short status messages via TTS (Piper), e.g. "Ronin online" when the
 * system has been up for a while. Runs on a schedule and announces at most
 * once per cooldown period.
 */
export default class AnnouncerAgent extends BaseAgent {
  static schedule = "*/30 * * * *"; // Every 30 minutes

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    if (!this.api.plugins.has("piper")) {
      return;
    }

    const last = await this.api.memory.retrieve(MEMORY_KEY_LAST_ANNOUNCE);
    const lastTime = typeof last === "number" ? last : 0;
    if (Date.now() - lastTime < ANNOUNCE_COOLDOWN_MS) {
      return;
    }

    try {
      await this.api.plugins.call("piper", "speakAndPlay", "Ronin online");
      await this.api.memory.store(MEMORY_KEY_LAST_ANNOUNCE, Date.now());
    } catch (err) {
      console.error("[announcer] TTS failed:", err);
    }
  }
}
