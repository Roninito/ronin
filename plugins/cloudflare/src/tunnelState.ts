/**
 * File-based tunnel state for CLI and agent
 * Persists to ~/.ronin/cloudflare.tunnels.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { TunnelConfig } from "./types.js";

const TUNNELS_PATH = join(homedir(), ".ronin", "cloudflare.tunnels.json");

export function loadTunnelState(): TunnelConfig[] {
  if (!existsSync(TUNNELS_PATH)) {
    return [];
  }
  try {
    const content = readFileSync(TUNNELS_PATH, "utf-8");
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveTunnelState(tunnels: TunnelConfig[]): void {
  const dir = join(homedir(), ".ronin");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(TUNNELS_PATH, JSON.stringify(tunnels, null, 2));
}

export function getTunnelByName(name: string): TunnelConfig | undefined {
  return loadTunnelState().find((t) => t.name === name);
}

export function updateTunnel(name: string, updates: Partial<TunnelConfig>): void {
  const tunnels = loadTunnelState();
  const idx = tunnels.findIndex((t) => t.name === name);
  if (idx === -1) return;
  tunnels[idx] = { ...tunnels[idx], ...updates };
  saveTunnelState(tunnels);
}

export function addTunnel(config: TunnelConfig): void {
  const tunnels = loadTunnelState();
  const idx = tunnels.findIndex((t) => t.name === config.name);
  if (idx >= 0) {
    tunnels[idx] = config;
  } else {
    tunnels.push(config);
  }
  saveTunnelState(tunnels);
}

export function removeTunnel(name: string): void {
  saveTunnelState(loadTunnelState().filter((t) => t.name !== name));
}
