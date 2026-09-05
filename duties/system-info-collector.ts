/**
 * System Info Collector Agent
 *
 * Runs every 6 hours to gather and update system information.
 * Collects: OS, CPU, memory, GPU, runtime info
 * Stores: memory/notes/system-current.md (overwritten each run)
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { cpus, freemem, totalmem, platform, arch, release, hostname } from "os";

interface SystemInfoMetadata {
  collected_at: string;
  expires_at: string;
  source_agent: string;
  os: { platform: "darwin" | "linux" | "win32"; arch: string; version: string; hostname: string };
  memory: { total_bytes: number; free_bytes: number; used_bytes: number; percent_used: number };
  cpu: { cores: number; model: string };
  gpu: { available: boolean };
  runtime: { node_version: string; bun_version: string };
  environment: Record<string, string>;
}

export default class SystemInfoCollectorAgent extends BaseDuty {
  // Run every 6 hours
  static schedule = "0 */6 * * *";

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      console.log("[system-info-collector] Starting system information collection...");

      // Gather system info
      const systemInfo = await this.gatherSystemInfo();

      await this.api.memory.store("system-current", systemInfo);
      console.log("[system-info-collector] ✅ System information stored in memory/notes/system-current.md");

      // Log summary
      this.logSystemSummary(systemInfo);
    } catch (error) {
      console.error("[system-info-collector] ❌ Error collecting system info:", error);
    }
  }

  private async gatherSystemInfo(): Promise<SystemInfoMetadata> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 6 * 3600000); // 6 hours from now

    // CPU info
    const cpuList = cpus();
    const cpuCount = cpuList.length;
    const cpuModel = cpuList[0]?.model || "unknown";

    // Memory info (in bytes)
    const totalMemory = totalmem();
    const freeMemory = freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryPercent = (usedMemory / totalMemory) * 100;

    // OS info
    const osType = platform() as "darwin" | "linux" | "win32";
    const osArch = arch();
    const osVersion = release();
    const osHostname = hostname();

    // Runtime info
    const nodeVersion = process.version;

    // GPU check (simplified - check environment variables or common indicators)
    const gpuAvailable = await this.checkGpuAvailability();

    // Environment variables (only non-sensitive ones)
    const environment = this.getPublicEnvironmentVariables();

    const metadata: SystemInfoMetadata = {
      collected_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      source_agent: "system-info-collector",

      os: {
        platform: osType,
        arch: osArch,
        version: osVersion,
        hostname: osHostname,
      },

      memory: {
        total_bytes: totalMemory,
        free_bytes: freeMemory,
        used_bytes: usedMemory,
        percent_used: memoryPercent,
      },

      cpu: {
        cores: cpuCount,
        model: cpuModel,
      },

      gpu: {
        available: gpuAvailable,
      },

      runtime: {
        node_version: nodeVersion,
        bun_version: process.env.BUN_VERSION || "unknown",
      },

      environment,
    };

    return metadata;
  }

  private async checkGpuAvailability(): Promise<boolean> {
    try {
      // Check for CUDA
      if (process.env.CUDA_VISIBLE_DEVICES) return true;
      if (process.env.CUDA_HOME) return true;

      // Check for Metal (macOS)
      if (process.platform === "darwin") {
        // Metal is available on Apple Silicon and Intel Macs with GPU
        return true; // Assume available on macOS for now
      }

      return false;
    } catch {
      return false;
    }
  }

  private getPublicEnvironmentVariables(): Record<string, string> {
    const publicVars: Record<string, string> = {};

    const publicEnvNames = [
      "NODE_ENV",
      "HOME",
      "USER",
      "SHELL",
      "LANG",
      "PATH",
      "BUN_VERSION",
      "PWD",
      "OS", // Custom: operating system
      "ARCH", // Custom: architecture
    ];

    for (const varName of publicEnvNames) {
      const value = process.env[varName];
      if (value && !this.isSensitive(varName)) {
        // Truncate long paths for safety
        publicVars[varName] = value.length > 200 ? value.substring(0, 200) + "..." : value;
      }
    }

    return publicVars;
  }

  private isSensitive(varName: string): boolean {
    const sensitivePatterns = [
      "KEY",
      "SECRET",
      "PASSWORD",
      "TOKEN",
      "AUTH",
      "CREDENTIAL",
      "API_KEY",
      "AWS",
      "AZURE",
      "GITHUB",
      "OPENAI",
      "DATABASE",
      "MONGO",
      "SQL",
      "PRIVATE",
    ];

    const upper = varName.toUpperCase();
    return sensitivePatterns.some((pattern) => upper.includes(pattern));
  }

  private logSystemSummary(info: SystemInfoMetadata): void {
    const memGB = (info.memory.total_bytes / 1e9).toFixed(1);
    const memUsedPercent = info.memory.percent_used.toFixed(1);

    console.log(`
[system-info-collector] 📊 System Summary:
  OS: ${info.os.platform} ${info.os.version} (${info.os.arch})
  Hostname: ${info.os.hostname}
  CPU: ${info.cpu.cores} cores (${info.cpu.model})
  Memory: ${memGB}GB total, ${memUsedPercent}% used
  GPU: ${info.gpu?.available ? "✅ Available" : "❌ Not detected"}
  Runtime: Node ${info.runtime.node_version}
  Collected: ${new Date(info.collected_at).toLocaleString()}
  Expires: ${new Date(info.expires_at).toLocaleString()}
    `);
  }
}
