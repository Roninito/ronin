import { describe, it, expect } from "bun:test";
import { getProviderVisual, renderProviderIconSvg, PROVIDER_LABELS } from "../src/utils/providerIcons.js";

describe("getProviderVisual", () => {
  it("returns a known visual for each real provider type", () => {
    for (const provider of ["ollama", "openai", "anthropic", "gemini", "grok", "lmstudio", "opencode"]) {
      const v = getProviderVisual(provider);
      expect(v.label).toBeTruthy();
      expect(v.color).toMatch(/^#/);
      expect(v.initial.length).toBeGreaterThan(0);
    }
  });

  it("falls back gracefully for an unknown provider string", () => {
    const v = getProviderVisual("some-future-provider");
    expect(v.label).toBe("some-future-provider");
    expect(v.initial).toBe("S");
  });

  it("falls back gracefully for undefined/null/empty input instead of throwing", () => {
    expect(() => getProviderVisual(undefined)).not.toThrow();
    expect(() => getProviderVisual(null)).not.toThrow();
    expect(() => getProviderVisual("")).not.toThrow();
    expect(getProviderVisual(undefined).label).toBe("Unknown");
  });
});

describe("renderProviderIconSvg", () => {
  it("renders a valid svg element for a real provider", () => {
    const svg = renderProviderIconSvg("openai", 20);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain('width="20"');
  });

  it("never throws for undefined input (defensive — chat header renders this server-side)", () => {
    expect(() => renderProviderIconSvg(undefined)).not.toThrow();
  });
});

describe("PROVIDER_LABELS", () => {
  it("has a label for every AIProviderType", () => {
    for (const provider of ["ollama", "openai", "anthropic", "gemini", "grok", "lmstudio", "opencode"] as const) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });
});
