/**
 * ronin doctor
 *
 * Health-check command that validates the Ronin installation:
 *   - Ollama connectivity
 *   - Configured model availability
 *   - API keys for cloud providers
 *   - Config file syntax and location
 *   - Source of each value (env / file / default)
 */

import { existsSync } from "fs";
import { getConfigService } from "../../config/ConfigService.js";
import type { AIProviderType } from "../../config/types.js";

interface CheckResult {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export async function doctorCommand(): Promise<void> {
  console.log("\nRonin Doctor\n");

  const configService = getConfigService();
  await configService.load();
  const config = configService.getAll();
  const results: CheckResult[] = [];

  // ── 1. Config file ───────────────────────────────────────────────────
  const configPath = configService.getConfigPath();
  if (existsSync(configPath)) {
    results.push({ label: "Config file", status: "ok", detail: configPath });
  } else {
    results.push({ label: "Config file", status: "warn", detail: `Not found at ${configPath} (using defaults)` });
  }

  // ── 2. AI provider ──────────────────────────────────────────────────
  const provider = config.ai.provider;
  const providerSource = configService.isFromEnv("ai.provider") ? "env" : "config/default";
  results.push({
    label: "AI provider",
    status: "ok",
    detail: `${provider} (source: ${providerSource})`,
  });

  // ── 3. Ollama connectivity ──────────────────────────────────────────
  if (provider === "ollama" || config.ai.fallback?.chain?.includes("ollama")) {
    const ollamaUrl = config.ai.ollamaUrl;
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const modelCount = (data.models || []).length;
        results.push({ label: "Ollama connection", status: "ok", detail: `${ollamaUrl} (${modelCount} models available)` });

        // Check if configured model exists
        const targetModel = config.ai.ollamaModel;
        const models = (data.models || []).map((m: { name: string }) => m.name);
        const found = models.some((m: string) => m === targetModel || m.startsWith(`${targetModel}:`));
        if (found) {
          results.push({ label: "Default model", status: "ok", detail: targetModel });
        } else {
          results.push({
            label: "Default model",
            status: "fail",
            detail: `"${targetModel}" not found. Run: ollama pull ${targetModel}`,
          });
        }

        // Check model tier slots
        if (config.ai.models) {
          for (const [tier, modelName] of Object.entries(config.ai.models)) {
            if (tier === "embedding") continue;
            const tierFound = models.some((m: string) => m === modelName || m.startsWith(`${modelName}:`));
            if (!tierFound) {
              results.push({
                label: `Model tier "${tier}"`,
                status: "warn",
                detail: `"${modelName}" not found locally. Run: ollama pull ${modelName}`,
              });
            }
          }
        }
      } else {
        results.push({ label: "Ollama connection", status: "fail", detail: `${ollamaUrl} returned ${res.status}` });
      }
    } catch (err) {
      results.push({
        label: "Ollama connection",
        status: "fail",
        detail: `Cannot reach ${ollamaUrl} — ${(err as Error).message}`,
      });
    }
  }

  // ── 4. Cloud provider API keys ──────────────────────────────────────
  const cloudChecks: Array<{ name: AIProviderType; key: string; source: string }> = [
    { name: "openai", key: config.ai.openai?.apiKey || "", source: "ai.openai.apiKey" },
    { name: "gemini", key: config.gemini?.apiKey || "", source: "gemini.apiKey" },
    { name: "grok", key: config.grok?.apiKey || "", source: "grok.apiKey" },
  ];

  for (const check of cloudChecks) {
    const isActive = provider === check.name || config.ai.fallback?.chain?.includes(check.name);
    if (isActive) {
      if (check.key) {
        const masked = check.key.slice(0, 4) + "..." + check.key.slice(-2);
        results.push({ label: `${check.name} API key`, status: "ok", detail: `Set (${masked})` });
      } else {
        results.push({
          label: `${check.name} API key`,
          status: "fail",
          detail: `Missing! Set via: ronin config set ${check.source} <key>`,
        });
      }
    } else if (check.key) {
      results.push({ label: `${check.name} API key`, status: "ok", detail: "Configured (not active provider)" });
    }
  }

  // ── 5. Fallback chain ───────────────────────────────────────────────
  if (config.ai.fallback?.enabled) {
    const chain = config.ai.fallback.chain;
    results.push({
      label: "Fallback chain",
      status: chain.length > 0 ? "ok" : "warn",
      detail: chain.length > 0 ? chain.join(" -> ") : "Enabled but empty",
    });
  }

  // ── 6. Temperature & timeout ────────────────────────────────────────
  results.push({
    label: "Temperature",
    status: "ok",
    detail: `${config.ai.temperature}`,
  });

  results.push({
    label: "Timeout",
    status: "ok",
    detail: `${config.ai.ollamaTimeoutMs}ms (${(config.ai.ollamaTimeoutMs / 1000).toFixed(0)}s)`,
  });

  // ── 7. Plugin directory ─────────────────────────────────────────────
  const pluginDir = config.system.userPluginDir;
  if (existsSync(pluginDir)) {
    results.push({ label: "Plugin directory", status: "ok", detail: pluginDir });
  } else {
    results.push({ label: "Plugin directory", status: "warn", detail: `${pluginDir} (does not exist yet)` });
  }

  // ── Output ──────────────────────────────────────────────────────────
  const statusIcons = { ok: "✅", warn: "⚠️ ", fail: "❌" };
  let failCount = 0;
  let warnCount = 0;

  for (const r of results) {
    console.log(`  ${statusIcons[r.status]} ${r.label}: ${r.detail}`);
    if (r.status === "fail") failCount++;
    if (r.status === "warn") warnCount++;
  }

  console.log("");
  if (failCount > 0) {
    console.log(`${failCount} issue(s) found. Fix them and run "ronin doctor" again.`);
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`All good with ${warnCount} warning(s).`);
  } else {
    console.log("Everything looks good!");
  }
}
