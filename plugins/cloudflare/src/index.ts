/**
 * Cloudflare Plugin Entry Point
 * Real methods for CLI and agent; uses WranglerWrapper, RouteGuard, tunnel state file
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { WranglerWrapper } from "./WranglerWrapper.js";
import { QuickTunnel } from "./QuickTunnel.js";
import { RouteGuard } from "./RouteGuard.js";
import { renderQrAscii } from "./qr.js";
import { PolicyValidator } from "./config/validator.js";
import { DEFAULT_POLICY } from "./config/validator.js";
import * as tunnelState from "./tunnelState.js";
import type { RoutePolicy, TunnelConfig } from "./types.js";

const POLICY_PATH = join(homedir(), ".ronin", "cloudflare.routes.json");
const DEFAULT_LOCAL_PORT = 3000;
const MAX_TEMP_TTL = 86400;

let _wrangler: WranglerWrapper | null = null;
let _routeGuard: RouteGuard | null = null;
let _quickTunnel: QuickTunnel | null = null;

function getWrangler(): WranglerWrapper {
  if (!_wrangler) _wrangler = new WranglerWrapper();
  return _wrangler;
}

function getRouteGuard(): RouteGuard {
  if (!_routeGuard) _routeGuard = new RouteGuard();
  return _routeGuard;
}

function getQuickTunnel(): QuickTunnel {
  if (!_quickTunnel) _quickTunnel = new QuickTunnel();
  return _quickTunnel;
}

async function login(): Promise<void> {
  const wrangler = getWrangler();
  if (!(await wrangler.ensureInstalled())) {
    console.error("[Cloudflare] Wrangler CLI not available. Install with: npm install -g wrangler");
    return;
  }
  const token = await wrangler.login();
  if (token) {
    console.log("[Cloudflare] Authenticated as", token.email);
  }
}

async function logout(): Promise<void> {
  const wrangler = getWrangler();
  const tunnels = tunnelState.loadTunnelState();
  for (const t of tunnels) {
    if (t.status === "active") {
      await wrangler.stopTunnel(t.name);
    }
  }
  tunnelState.saveTunnelState([]);
  try {
    execSync("wrangler logout", { stdio: "ignore" });
  } catch {
    // continue
  }
  console.log("[Cloudflare] Logged out.");
}

async function status(): Promise<void> {
  const wrangler = getWrangler();
  const isAuth = await wrangler.isAuthenticated();
  const tunnels = tunnelState.loadTunnelState();
  const guard = getRouteGuard();
  const hasPolicy = await guard.hasPolicy();

  console.log("Cloudflare Status:");
  console.log("  Authenticated:", isAuth ? "Yes" : "No");
  console.log("  Route policy:", hasPolicy ? "Yes" : "No (run 'ronin cloudflare route init')");
  console.log("  Active Tunnels:", tunnels.length);
  for (const t of tunnels) {
    const expiry = t.expires ? ` (expires: ${new Date(t.expires).toLocaleString()})` : "";
    console.log(`    - ${t.name}: ${t.status}${expiry}`);
  }
}

function writePolicy(policy: RoutePolicy): void {
  writeFileSync(POLICY_PATH, JSON.stringify(policy, null, 2));
}

async function routeInit(): Promise<void> {
  if (existsSync(POLICY_PATH)) {
    console.log("[Cloudflare] Policy file already exists:", POLICY_PATH);
    return;
  }
  const dir = join(homedir(), ".ronin");
  if (!existsSync(dir)) {
    const { mkdirSync } = await import("fs");
    mkdirSync(dir, { recursive: true });
  }
  writePolicy(DEFAULT_POLICY);
  console.log("[Cloudflare] Created default policy:", POLICY_PATH);
}

function loadPolicyFromFile(): RoutePolicy | null {
  if (!existsSync(POLICY_PATH)) return null;
  try {
    const content = readFileSync(POLICY_PATH, "utf-8");
    const policy = JSON.parse(content) as RoutePolicy;
    const validator = new PolicyValidator();
    return validator.validate(policy).valid ? policy : null;
  } catch {
    return null;
  }
}

async function routeAdd(
  path: string,
  methods?: string[],
  auth?: "none" | "token"
): Promise<void> {
  if (!path) {
    console.error("[Cloudflare] Path is required");
    return;
  }
  const policy = loadPolicyFromFile();
  if (!policy) {
    console.error("[Cloudflare] No policy file found. Run 'ronin cloudflare route init' first.");
    return;
  }
  if (policy.routes.some((r) => r.path === path)) {
    console.log("[Cloudflare] Route already exists:", path);
    return;
  }
  policy.routes.push({
    path,
    methods: methods && methods.length > 0 ? methods : ["GET", "POST"],
    auth: auth ?? "none",
    expires: null
  });
  writePolicy(policy);
  console.log(
    "[Cloudflare] Added route:", path,
    `(methods: ${(methods && methods.length > 0 ? methods : ["GET", "POST"]).join(",")}, auth: ${auth ?? "none"})`
  );
}

async function routeRemove(path: string): Promise<void> {
  if (!path) {
    console.error("[Cloudflare] Path is required");
    return;
  }
  const policy = loadPolicyFromFile();
  if (!policy) {
    console.error("[Cloudflare] No policy file found.");
    return;
  }
  const len = policy.routes.length;
  policy.routes = policy.routes.filter((r) => r.path !== path);
  if (policy.routes.length < len) {
    writePolicy(policy);
    console.log("[Cloudflare] Removed route:", path);
  } else {
    console.log("[Cloudflare] Route not found:", path);
  }
}

async function routeList(): Promise<void> {
  const guard = getRouteGuard();
  const policy = await guard.loadPolicy();
  if (!policy) {
    console.log("[Cloudflare] No policy file found. Run 'ronin cloudflare route init' first.");
    return;
  }
  console.log("Allowed Routes:");
  if (policy.routes.length === 0) {
    console.log("  No routes defined");
    return;
  }
  for (const r of policy.routes) {
    console.log(`  - ${r.path}: ${r.methods.join(", ")} (auth: ${r.auth})`);
  }
}

async function routeValidate(): Promise<void> {
  const guard = getRouteGuard();
  const policy = await guard.loadPolicy();
  if (!policy) {
    console.log("[Cloudflare] No policy file found.");
    return;
  }
  const validator = new PolicyValidator();
  const result = validator.validate(policy);
  if (result.valid) {
    console.log("[Cloudflare] Policy is valid.");
  } else {
    console.log("[Cloudflare] Policy validation errors:");
    for (const err of result.errors) {
      console.log("  -", err);
    }
  }
}

async function tunnelCreate(name: string): Promise<void> {
  if (!name) {
    console.error("[Cloudflare] Tunnel name is required");
    return;
  }
  const guard = getRouteGuard();
  if (!(await guard.hasPolicy())) {
    console.error("[Cloudflare] Route policy required. Run 'ronin cloudflare route init' first.");
    return;
  }
  const wrangler = getWrangler();
  if (!(await wrangler.ensureInstalled())) {
    console.error("[Cloudflare] Wrangler CLI not available. Install with: npm install -g wrangler");
    return;
  }
  const config = await wrangler.createTunnel(name);
  if (config) {
    tunnelState.addTunnel({
      ...config,
      localPort: DEFAULT_LOCAL_PORT,
      url: "",
      status: "stopped",
      isTemporary: false
    });
    console.log("[Cloudflare] Tunnel created:", name);
  }
}

async function tunnelStart(name: string): Promise<void> {
  if (!name) {
    console.error("[Cloudflare] Tunnel name is required");
    return;
  }
  const tunnels = tunnelState.loadTunnelState();
  const tunnel = tunnels.find((t) => t.name === name);
  if (!tunnel) {
    console.error("[Cloudflare] Tunnel not found:", name);
    return;
  }
  const wrangler = getWrangler();
  const port = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) : DEFAULT_LOCAL_PORT;
  const ok = await wrangler.startTunnel(tunnel, port);
  if (ok) {
    tunnelState.updateTunnel(name, { status: "active", url: tunnel.url || "", localPort: port });
    console.log("[Cloudflare] Tunnel started:", name);
  }
}

async function tunnelStop(name: string): Promise<void> {
  if (!name) {
    console.error("[Cloudflare] Tunnel name is required");
    return;
  }
  const tunnel = tunnelState.getTunnelByName(name);
  if (tunnel?.pid) {
    // Quick tunnel (tunnel temp) — stop by PID, not a wrangler name-pattern kill.
    getQuickTunnel().stop(tunnel.pid);
  } else {
    const wrangler = getWrangler();
    await wrangler.stopTunnel(name);
  }
  tunnelState.updateTunnel(name, { status: "stopped", url: "" });
  console.log("[Cloudflare] Tunnel stopped:", name);
}

async function tunnelDelete(name: string): Promise<void> {
  if (!name) {
    console.error("[Cloudflare] Tunnel name is required");
    return;
  }
  const tunnels = tunnelState.loadTunnelState();
  const tunnel = tunnels.find((t) => t.name === name);
  if (!tunnel) {
    console.error("[Cloudflare] Tunnel not found:", name);
    return;
  }
  if (tunnel.pid) {
    // Quick tunnel — was never registered with Cloudflare via `wrangler tunnel
    // create`, so there's nothing to delete server-side; stopping the process
    // and dropping it from local state is the whole operation.
    getQuickTunnel().stop(tunnel.pid);
    tunnelState.removeTunnel(name);
    console.log("[Cloudflare] Tunnel deleted:", name);
    return;
  }
  const wrangler = getWrangler();
  await wrangler.stopTunnel(name);
  const ok = await wrangler.deleteTunnel(name, tunnel.id);
  if (ok) {
    tunnelState.removeTunnel(name);
    console.log("[Cloudflare] Tunnel deleted:", name);
  }
}

async function tunnelList(): Promise<void> {
  const tunnels = tunnelState.loadTunnelState();
  if (tunnels.length === 0) {
    console.log("No tunnels in state. Create one with: ronin cloudflare tunnel create <name>");
    return;
  }
  console.log("Tunnels:");
  for (const t of tunnels) {
    const expiry = t.expires ? ` expires: ${new Date(t.expires).toLocaleString()}` : "";
    console.log(`  - ${t.name}: ${t.status} (id: ${t.id})${expiry}`);
  }
}

async function tunnelTemp(ttl?: number): Promise<void> {
  const name = `temp-${Date.now()}`;
  const guard = getRouteGuard();
  if (!(await guard.hasPolicy())) {
    console.error("[Cloudflare] Route policy required. Run 'ronin cloudflare route init' first.");
    return;
  }
  // Real anonymous quick tunnel — no wrangler account, no DNS setup. See
  // QuickTunnel.ts for why this replaced the old wrangler-based path, which
  // fabricated a *.trycloudflare.com URL that cloudflared never actually issued.
  const quickTunnel = getQuickTunnel();
  const sec = ttl != null ? Math.min(Math.max(ttl, 300), MAX_TEMP_TTL) : 3600;
  const expires = Date.now() + sec * 1000;
  const port = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) : DEFAULT_LOCAL_PORT;

  let handle;
  try {
    handle = await quickTunnel.start(port);
  } catch (error) {
    console.error("[Cloudflare] Failed to start quick tunnel:", error instanceof Error ? error.message : error);
    return;
  }

  const tunnelConfig: TunnelConfig = {
    id: name,
    name,
    url: handle.url,
    localPort: port,
    createdAt: Date.now(),
    status: "active",
    isTemporary: true,
    expires,
    pid: handle.pid,
  };
  tunnelState.addTunnel(tunnelConfig);
  console.log("[Cloudflare] Temporary tunnel active:", handle.url, "(expires in", sec, "s)");
  console.log("");
  console.log(renderQrAscii(handle.url));
  console.log("Scan to open on your phone. (May take a few seconds to become reachable.)");
}

async function pagesDeploy(directory: string, project: string): Promise<void> {
  if (!directory || !project) {
    console.error("[Cloudflare] Directory and project name are required");
    return;
  }
  const wrangler = getWrangler();
  if (!(await wrangler.ensureInstalled())) {
    console.error("[Cloudflare] Wrangler CLI not available. Install with: npm install -g wrangler");
    return;
  }
  const result = await wrangler.deployPages(directory, project);
  if (result) {
    console.log("[Cloudflare] Deployed to:", result.url);
  }
}

async function securityAudit(): Promise<void> {
  const wrangler = getWrangler();
  const guard = getRouteGuard();
  const isAuth = await wrangler.isAuthenticated();
  const tunnels = tunnelState.loadTunnelState();
  const policy = await guard.loadPolicy();
  const auditLogs = await guard.getAuditLogs(50);
  const blocked = auditLogs.filter((l) => !l.allowed);

  console.log("[Cloudflare] Security audit:");
  console.log("  Authentication:", isAuth ? "OK" : "MISSING");
  console.log("  Active Tunnels:", tunnels.length);
  for (const t of tunnels) {
    console.log("    -", t.name, t.status);
  }
  if (policy) {
    console.log("  Defined Routes:", policy.routes.length);
    console.log("  Blocked Paths:", policy.blockedPaths.length);
  } else {
    console.log("  Policy: MISSING - Run 'ronin cloudflare route init'");
  }
  console.log("  Recent Blocked Requests:", blocked.length);
}

const plugin = {
  name: "cloudflare",
  version: "1.0.0",
  description: "Cloudflare integration with secure tunnel management",
  agents: [],
  methods: {
    login,
    logout,
    status,
    routeInit,
    routeAdd,
    routeRemove,
    routeList,
    routeValidate,
    tunnelCreate,
    tunnelStart,
    tunnelStop,
    tunnelDelete,
    tunnelList,
    tunnelTemp,
    pagesDeploy,
    securityAudit
  },
  events: [
    "cloudflare.auth.login",
    "cloudflare.auth.logout",
    "cloudflare.tunnel.created",
    "cloudflare.tunnel.active",
    "cloudflare.tunnel.stopped",
    "cloudflare.tunnel.deleted",
    "cloudflare.tunnel.expired",
    "cloudflare.route.added",
    "cloudflare.route.blocked",
    "cloudflare.pages.deployed",
    "cloudflare.circuitbreaker.triggered",
    "cloudflare.error"
  ]
};

export default plugin;
