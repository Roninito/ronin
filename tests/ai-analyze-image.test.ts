import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AIConfig } from "../src/config/types.js";
import { AIAPI } from "../src/api/ai.js";

function baseAIConfig(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    provider: "ollama",
    temperature: 0.7,
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "test-model",
    ollamaTimeoutMs: 5000,
    ollamaEmbeddingModel: "test-embed",
    models: { default: "test-model", fast: "test-model", smart: "test-model", embedding: "test-embed" },
    fallback: { enabled: false, chain: [] },
    openai: { apiKey: "", baseUrl: "", model: "" },
    ...overrides,
  } as AIConfig;
}

describe("AIAPI.analyzeImage", () => {
  let scratchDir: string;
  let imagePath: string;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-analyze-image-"));
    imagePath = join(scratchDir, "shot.png");
    writeFileSync(imagePath, "fake png bytes");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  it("POSTs to Ollama's /api/generate with the image base64-encoded in an images array", async () => {
    let capturedUrl = "";
    let capturedBody: any;

    globalThis.fetch = (async (url: string, init: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ response: "a screenshot of a terminal" }), { status: 200 });
    }) as typeof fetch;

    const ai = new AIAPI(
      "http://localhost:11434",
      "test-model",
      5000,
      baseAIConfig({ models: { default: "test-model", fast: "test-model", smart: "test-model", embedding: "test-embed", vision: "llava" } }),
    );

    const answer = await ai.analyzeImage(imagePath, "what's in this image?");

    expect(answer).toBe("a screenshot of a terminal");
    expect(capturedUrl).toBe("http://localhost:11434/api/generate");
    expect(capturedBody.model).toBe("llava");
    expect(capturedBody.prompt).toBe("what's in this image?");
    expect(Array.isArray(capturedBody.images)).toBe(true);
    expect(capturedBody.images[0]).toBe(Buffer.from("fake png bytes").toString("base64"));
  });

  it("throws a clear error when no vision model is configured", async () => {
    const ai = new AIAPI("http://localhost:11434", "test-model", 5000, baseAIConfig());

    await expect(ai.analyzeImage(imagePath, "what's this?")).rejects.toThrow(
      "No vision-capable model configured",
    );
  });

  it("respects an explicit options.model override even when config.models.vision is set", async () => {
    let capturedBody: any;
    globalThis.fetch = (async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ response: "ok" }), { status: 200 });
    }) as typeof fetch;

    const ai = new AIAPI(
      "http://localhost:11434",
      "test-model",
      5000,
      baseAIConfig({ models: { default: "test-model", fast: "test-model", smart: "test-model", embedding: "test-embed", vision: "llava" } }),
    );

    await ai.analyzeImage(imagePath, "describe", { model: "bakllava" });
    expect(capturedBody.model).toBe("bakllava");
  });
});
