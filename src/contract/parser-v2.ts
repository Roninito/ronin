/**
 * Contract DSL Parser V2
 *
 * Parses .contract files:
 *
 *   contract <name> <version>
 *     description "<text>"
 *     target kata <name> <version>
 *     trigger cron "<expression>"
 *     trigger event "<eventType>"
 *     trigger webhook "<path>"
 *     parameters {
 *       key: value
 *     }
 *     on_failure {
 *       action retry|alert|ignore
 *       max_attempts 3
 *       backoff exponential
 *       initial_delay 1s
 *       max_delay 30s
 *       alert_email "email"
 *     }
 */

import type { ContractV2Definition, TriggerType, TriggerConfig, FailureAction } from "../techniques/types.js";

export class ContractParseError extends Error {
  constructor(message: string, public line?: number) {
    super(line !== undefined ? `Line ${line}: ${message}` : message);
    this.name = "ContractParseError";
  }
}

export class ContractParserV2 {
  parse(source: string): ContractV2Definition {
    const lines = source.split("\n");
    let idx = 0;

    // Find header
    function nextLine(): { text: string; lineNo: number } | null {
      while (idx < lines.length) {
        const text = lines[idx].trimEnd();
        const lineNo = idx + 1;
        idx++;
        if (text.trim() !== "" && !text.trim().startsWith("#")) return { text, lineNo };
      }
      return null;
    }

    const header = nextLine();
    if (!header) throw new ContractParseError("Empty contract file");

    const headerMatch = header.text.match(/^contract\s+(\S+)\s+(v\d+)\s*$/);
    if (!headerMatch) {
      throw new ContractParseError(`Expected "contract <name> <version>"`, header.lineNo);
    }
    const name = headerMatch[1];
    const version = headerMatch[2];

    let description: string | undefined;
    let targetKata = "";
    let targetKataVersion = "v1";
    let triggerType: TriggerType = "manual";
    let triggerConfig: TriggerConfig = { type: "manual" };
    const parameters: Record<string, unknown> = {};
    let onFailureAction: FailureAction = "ignore";
    const onFailureConfig: Record<string, unknown> = {};
    let author: string | undefined;

    while (idx < lines.length) {
      const line = nextLine();
      if (!line) break;

      const stripped = line.text.trim();

      if (stripped.startsWith("description ")) {
        description = extractQuoted(stripped.replace(/^description\s+/, ""));
      } else if (stripped.startsWith("author ")) {
        author = extractQuoted(stripped.replace(/^author\s+/, ""));
      } else if (stripped.startsWith("target kata ")) {
        const m = stripped.match(/^target kata\s+(\S+)\s+(v\d+)\s*$/);
        if (m) { targetKata = m[1]; targetKataVersion = m[2]; }
        else {
          const m2 = stripped.match(/^target kata\s+(\S+)\s*$/);
          if (m2) targetKata = m2[1];
        }
      } else if (stripped.startsWith("trigger ")) {
        const m = stripped.match(/^trigger\s+(cron|event|webhook)\s+(.*)\s*$/);
        if (m) {
          const tType = m[1] as "cron" | "event" | "webhook";
          const tValue = extractQuoted(m[2].trim());
          triggerType = tType;
          if (tType === "cron") triggerConfig = { type: "cron", expression: tValue };
          else if (tType === "event") triggerConfig = { type: "event", eventType: tValue };
          else if (tType === "webhook") triggerConfig = { type: "webhook", path: tValue };
        } else if (stripped === "trigger manual") {
          triggerType = "manual";
          triggerConfig = { type: "manual" };
        }
      } else if (stripped === "parameters {" || stripped.startsWith("parameters {")) {
        // Consume block
        while (idx < lines.length) {
          const pl = lines[idx].trimEnd();
          idx++;
          if (pl.trim() === "}") break;
          const colonIdx = pl.indexOf(":");
          if (colonIdx === -1) continue;
          const key = pl.slice(0, colonIdx).trim();
          const val = pl.slice(colonIdx + 1).trim().replace(/,$/, "");
          if (key) parameters[key] = parseScalar(val);
        }
      } else if (stripped === "on_failure {" || stripped.startsWith("on_failure {")) {
        while (idx < lines.length) {
          const fl = lines[idx].trimEnd();
          idx++;
          if (fl.trim() === "}") break;
          const t = fl.trim();
          if (t.startsWith("action ")) {
            onFailureAction = t.replace(/^action\s+/, "").trim() as FailureAction;
          } else if (t.startsWith("max_attempts ")) {
            onFailureConfig.maxAttempts = parseInt(t.replace(/^max_attempts\s+/, ""));
          } else if (t.startsWith("backoff ")) {
            onFailureConfig.backoff = t.replace(/^backoff\s+/, "").trim();
          } else if (t.startsWith("initial_delay ")) {
            const v = t.replace(/^initial_delay\s+/, "").trim();
            onFailureConfig.initialDelay = parseDuration(v);
          } else if (t.startsWith("max_delay ")) {
            const v = t.replace(/^max_delay\s+/, "").trim();
            onFailureConfig.maxDelay = parseDuration(v);
          } else if (t.startsWith("alert_email ")) {
            onFailureConfig.alertEmail = extractQuoted(t.replace(/^alert_email\s+/, ""));
          }
        }
      }
    }

    if (!targetKata) throw new ContractParseError("target kata is required");

    return {
      name,
      version,
      description,
      targetKata,
      targetKataVersion,
      parameters,
      triggerType,
      triggerConfig,
      onFailureAction,
      onFailureConfig: Object.keys(onFailureConfig).length > 0 ? onFailureConfig as any : undefined,
      enabled: true,
      author,
    };
  }
}

function extractQuoted(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (!isNaN(Number(s)) && s !== "") return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith("[")) try { return JSON.parse(s); } catch {}
  return s;
}

function parseDuration(s: string): number {
  if (s.endsWith("ms")) return parseInt(s);
  if (s.endsWith("s")) return parseInt(s) * 1000;
  if (s.endsWith("m")) return parseInt(s) * 60000;
  return parseInt(s) || 0;
}
