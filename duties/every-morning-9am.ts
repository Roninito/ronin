import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

export default class GoodMorningDuty extends BaseDuty {
  static schedule = "0 9 * * *";

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    console.log("☀️  Good morning, Ronin!");
    console.log(`   Today is ${dateStr}.`);
    console.log("   Have a wonderful and productive day! 🌅");
  }
}