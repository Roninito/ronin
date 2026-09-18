/**
 * Provider iconography — no provider logos/icons exist anywhere else in
 * Ronin. Rather than hand-drawing trademarked logos from memory (risk of
 * being wrong or misleading), each provider gets a simple colored monogram
 * badge: consistent style, no external asset/CDN dependency, easy to swap
 * for real logos later if wanted.
 */

import type { AIProviderType } from "../config/types.js";

interface ProviderVisual {
  label: string;
  color: string;
  initial: string;
}

const PROVIDER_VISUALS: Record<AIProviderType, ProviderVisual> = {
  ollama: { label: "Ollama", color: "#1a1a1a", initial: "O" },
  openai: { label: "OpenAI", color: "#10A37F", initial: "AI" },
  anthropic: { label: "Anthropic", color: "#D97757", initial: "A" },
  gemini: { label: "Gemini", color: "#4285F4", initial: "G" },
  grok: { label: "Grok", color: "#000000", initial: "X" },
  lmstudio: { label: "LM Studio", color: "#6366F1", initial: "L" },
};

function fallbackVisual(provider: string): ProviderVisual {
  const label = provider || "Unknown";
  return { label, color: "#6b7280", initial: label.slice(0, 1).toUpperCase() || "?" };
}

export function getProviderVisual(provider: string | undefined | null): ProviderVisual {
  if (!provider) return fallbackVisual("");
  return PROVIDER_VISUALS[provider as AIProviderType] ?? fallbackVisual(provider);
}

/** Small circular monogram badge as inline SVG markup. */
export function renderProviderIconSvg(provider: string | undefined | null, size = 20): string {
  const v = getProviderVisual(provider);
  const fontSize = v.initial.length > 1 ? size * 0.4 : size * 0.5;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${v.label}"><circle cx="12" cy="12" r="12" fill="${v.color}"/><text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="600" fill="#fff">${v.initial}</text></svg>`;
}

export const PROVIDER_LABELS: Record<AIProviderType, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  grok: "Grok",
  lmstudio: "LM Studio",
};
