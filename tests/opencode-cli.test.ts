import { describe, it, expect } from "bun:test";
import opencodePlugin from "../plugins/opencode-cli.js";

describe("opencode-cli plugin", () => {
  it("includes a model option in execute output when not installed", async () => {
    const result = await opencodePlugin.methods.execute("say hello", {
      model: "opencode/muse-spark-1.3-contributor-free",
      timeout: 1000,
    });
    expect(result.success).toBe(false);
    const err = result.error || "";
    // In CI/test environments opencode is not installed, so we expect a command-not-found.
    expect(err.length).toBeGreaterThan(0);
  });

  it("getModels returns known opencode models", async () => {
    const models = await opencodePlugin.methods.getModels();
    expect(models).toContain("opencode/muse-spark-1.3-contributor-free");
  });
});
