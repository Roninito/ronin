import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import elevenlabsPlugin from "../plugins/elevenlabs.js";
import sttPlugin from "../plugins/stt.js";

describe("elevenlabs TTS plugin", () => {
  const realKey = process.env.ELEVENLABS_API_KEY;

  afterEach(() => {
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
  });

  it("is registered under the elevenlabs name with speak/speakAndPlay/listVoices", () => {
    expect(elevenlabsPlugin.name).toBe("elevenlabs");
    expect(typeof elevenlabsPlugin.methods.speak).toBe("function");
    expect(typeof elevenlabsPlugin.methods.speakAndPlay).toBe("function");
    expect(typeof elevenlabsPlugin.methods.listVoices).toBe("function");
  });

  it("speak fails with a clear message (not a stack trace) when keyless", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(elevenlabsPlugin.methods.speak!("hello")).rejects.toThrow("ELEVENLABS_API_KEY");
  });

  it("speak rejects empty text without hitting the network", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    await expect(elevenlabsPlugin.methods.speak!("  ")).rejects.toThrow("no text");
  });

  it("listVoices fails with a clear message when keyless", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(elevenlabsPlugin.methods.listVoices!()).rejects.toThrow("ELEVENLABS_API_KEY");
  });

  it("isAvailable returns false (never throws) when keyless", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(elevenlabsPlugin.methods.isAvailable!()).resolves.toBe(false);
  });
});

describe("stt elevenlabs backend", () => {
  const realKey = process.env.ELEVENLABS_API_KEY;
  const realBackend = process.env.STT_BACKEND;

  beforeEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
    if (realBackend === undefined) delete process.env.STT_BACKEND;
    else process.env.STT_BACKEND = realBackend;
  });

  it("transcribe with backend=elevenlabs fails with a clear message when keyless", async () => {
    await expect(sttPlugin.methods.transcribe!("/tmp/does-not-matter.wav", { backend: "elevenlabs" })).rejects.toThrow(
      "ELEVENLABS_API_KEY",
    );
  });

  it("listBackends includes elevenlabs only when a key is configured", async () => {
    const without = (await sttPlugin.methods.listBackends!()) as string[];
    expect(without.some((b) => b.startsWith("elevenlabs"))).toBe(false);

    process.env.ELEVENLABS_API_KEY = "test-key";
    const withKey = (await sttPlugin.methods.listBackends!()) as string[];
    expect(withKey).toContain("elevenlabs (cloud)");
  });

  it("still rejects unknown backends", async () => {
    await expect(sttPlugin.methods.transcribe!("/tmp/x.wav", { backend: "nope" })).rejects.toThrow("Unknown STT backend");
  });
});
