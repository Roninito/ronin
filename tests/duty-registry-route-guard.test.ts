import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DutyRegistry } from "../src/duty/DutyRegistry.js";
import { FilesAPI } from "../src/api/files.js";
import { HTTPAPI } from "../src/api/http.js";
import { RouteGuard } from "../plugins/cloudflare/src/RouteGuard.js";

// End-to-end check of the actual wiring in DutyRegistry.ts's fetch handler —
// not just RouteGuard in isolation. Deliberately avoids the real ~/.ronin
// paths (this machine already has a real, empty-whitelist cloudflare.routes.json
// — testing against it live would either no-op or lock out real traffic) and
// never calls registerAll()/loads any duty, so nothing here touches Discord,
// trading integrations, or any other live external service — only the HTTP
// routing layer is exercised, on a scratch port with zero registered duties.
const PORT = 48213;
const dir = mkdtempSync(join(tmpdir(), "ronin-dutyregistry-routeguard-test-"));
const policyPath = join(dir, "cloudflare.routes.json");
const auditPath = join(dir, "cloudflare.audit.log");

let registry: DutyRegistry;
const prevPort = process.env.WEBHOOK_PORT;

function writePolicy(routes: Array<{ path: string; methods: string[]; auth: "none" | "token" | "jwt" }>) {
  writeFileSync(policyPath, JSON.stringify({
    version: "1.0",
    mode: "strict",
    routes,
    blockedPaths: ["/disk/**", "/admin/**"],
    projections: {},
  }, null, 2));
}

describe("DutyRegistry + RouteGuard wiring (real fetch handler, isolated paths, no duties loaded)", () => {
  // Swap in a fresh, isolated RouteGuard (pointed at scratch paths instead of
  // the real ~/.ronin/cloudflare.routes.json this machine already has) before
  // each test — RouteGuard caches the loaded policy in-memory for 5s, so
  // reusing one instance across tests that rewrite the policy file within
  // that window would read stale state, not a bug in the wiring being tested.
  function freshGuard() {
    (registry as any).routeGuard = new RouteGuard(policyPath, auditPath);
  }

  beforeAll(() => {
    process.env.WEBHOOK_PORT = String(PORT);
    registry = new DutyRegistry({ files: new FilesAPI(), http: new HTTPAPI(), webhookHost: "127.0.0.1" });
    freshGuard();
    registry.startWebhookServerIfNeeded();
  });

  afterAll(() => {
    (registry as any).webhookServer?.stop(true);
    if (prevPort === undefined) delete process.env.WEBHOOK_PORT;
    else process.env.WEBHOOK_PORT = prevPort;
    rmSync(dir, { recursive: true, force: true });
  });

  it("behaves exactly as before this fix when no policy file exists — dashboard reachable, ungated", async () => {
    expect(existsSync(policyPath)).toBe(false);
    const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
    expect(res.status).toBe(200);
  });

  it("once a policy exists, an unlisted route is blocked — including a built-in dashboard route", async () => {
    freshGuard();
    writePolicy([]); // opted in, but nothing whitelisted yet — this is literally this
                      // machine's real current ~/.ronin state (routes: []), reproduced
                      // in isolation on purpose.
    const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
    expect(res.status).toBe(403);
    unlinkSync(policyPath); // reset for subsequent tests
  });

  it("whitelisting a route makes it reachable again through the real handler", async () => {
    freshGuard();
    writePolicy([{ path: "/api/status", methods: ["GET"], auth: "none" }]);
    const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
    expect(res.status).toBe(200);

    const stillBlocked = await fetch(`http://127.0.0.1:${PORT}/api/routes`);
    expect(stillBlocked.status).toBe(403);
    unlinkSync(policyPath);
  });
});
