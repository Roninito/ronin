/**
 * ronin config set <path> <value>
 *
 * Sets a single configuration value by dot-path notation and persists it.
 * Automatically coerces types based on the value string:
 *   - "true"/"false" -> boolean
 *   - numeric strings -> number
 *   - JSON arrays/objects -> parsed
 *   - everything else -> string
 */

import { getConfigService } from "../../config/ConfigService.js";

function coerceValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;

  // Try number
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") return num;

  // Try JSON (arrays, objects)
  if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }

  return raw;
}

export async function configSetCommand(path: string, rawValue: string): Promise<void> {
  const configService = getConfigService();
  await configService.load();

  const value = coerceValue(rawValue);

  // Mask sensitive values in output
  const sensitive = ["apiKey", "password", "token", "secret"];
  const isSensitive = sensitive.some(s => path.toLowerCase().includes(s.toLowerCase()));
  const display = isSensitive && typeof value === "string" && value.length > 4
    ? value.slice(0, 4) + "..." + value.slice(-2)
    : JSON.stringify(value);

  await configService.set(path, value);

  console.log(`✅ Set ${path} = ${display}`);
  console.log(`   Saved to ${configService.getConfigPath()}`);
}
