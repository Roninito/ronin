import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

/**
 * Example agent that runs every minute
 */
export default class ExampleAgent extends BaseDuty {
  // Schedule: Run every minute
  static schedule = "0 7 * * *";

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    console.log("🤖 Example agent executing...");
    
    // Example: Use AI API
    try {
      const response = await this.api.ai.complete("Say hello in a friendly way!");
      console.log("AI Response:", response);
      
      // Store in memory
      await this.api.memory.store("lastGreeting", response);
    } catch (error) {
      console.error("Error calling AI:", error);
    }

    // Example: Read a file
    try {
      const content = await this.api.files.read("./package.json");
      console.log("Package.json size:", content.length, "bytes");
    } catch (error) {
      console.log("Could not read package.json (this is okay)");
    }

    console.log("✅ Example agent completed");
  }
}

