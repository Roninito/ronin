import { describe, it, expect } from "bun:test";
import gitPlugin from "../plugins/git.js";

// git diff/git show weren't available as chat tools at all — only clone,
// status, add, commit, push, pull, branch, log, checkout existed. These run
// the real git binary against this repo's own history (read-only commands,
// safe to run for real rather than mocking Bun.spawn).
describe("git plugin — diff/show", () => {
  it("registers diff and show in both methods and toolMetadata", () => {
    expect(typeof gitPlugin.methods.diff).toBe("function");
    expect(typeof gitPlugin.methods.show).toBe("function");
    expect(gitPlugin.toolMetadata?.diff).toBeDefined();
    expect(gitPlugin.toolMetadata?.show).toBeDefined();
  });

  it("diff() with no args returns a string diff (possibly empty) of the real working tree", async () => {
    const result = await gitPlugin.methods.diff();
    expect(typeof result.diff).toBe("string");
  });

  it("diff(ref) returns a diff against a real ref (HEAD)", async () => {
    const result = await gitPlugin.methods.diff("HEAD");
    expect(typeof result.diff).toBe("string");
  });

  it("show(ref) returns the full patch for a real commit", async () => {
    const log = await gitPlugin.methods.log(1);
    expect(log.commits.length).toBeGreaterThan(0);
    const hash = log.commits[0].fullHash;

    const result = await gitPlugin.methods.show(hash);
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain(log.commits[0].hash);
  });

  it("show(ref, path) returns a single file's content at that ref", async () => {
    const log = await gitPlugin.methods.log(1);
    const hash = log.commits[0].fullHash;

    const result = await gitPlugin.methods.show(hash, "package.json");
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain('"name"');
  });

  it("show() throws with a clear error for a bogus ref", async () => {
    await expect(gitPlugin.methods.show("not-a-real-ref-xyz")).rejects.toThrow(/Git show failed/);
  });
});
