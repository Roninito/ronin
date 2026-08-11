import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RouteGuard } from "../plugins/cloudflare/src/RouteGuard.js";
import type { RoutePolicy } from "../plugins/cloudflare/src/types.js";

function makePolicy(overrides: Partial<RoutePolicy> = {}): RoutePolicy {
  return {
    version: "1.0",
    mode: "strict",
    routes: [],
    blockedPaths: ["/disk/**", "/admin/**", "/internal/**", "/api/os-bridge/**", "/.ronin/**"],
    projections: {},
    ...overrides,
  };
}

describe("RouteGuard", () => {
  let dir: string;
  let policyPath: string;
  let auditPath: string;
  let guard: RouteGuard;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ronin-routeguard-test-"));
    policyPath = join(dir, "cloudflare.routes.json");
    auditPath = join(dir, "cloudflare.audit.log");
    guard = new RouteGuard(policyPath, auditPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePolicy(policy: RoutePolicy) {
    writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  }

  it("hasPolicy() is false and handle() 403s everything when no policy file exists — fails closed", async () => {
    expect(await guard.hasPolicy()).toBe(false);
    const res = await guard.handle(new Request("http://localhost/anything"), "default");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("blocks a default-blocked path even if it's also whitelisted", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/disk/report", methods: ["GET"], auth: "none", expires: null }] }));
    const res = await guard.handle(new Request("http://localhost/disk/report"), "default");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("blocks a path that isn't in the whitelist", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/chat", methods: ["GET"], auth: "none", expires: null }] }));
    const res = await guard.handle(new Request("http://localhost/api/os-bridge/exec"), "default");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows a whitelisted GET path (returns null)", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/chat", methods: ["GET", "POST"], auth: "none", expires: null }] }));
    const res = await guard.handle(new Request("http://localhost/chat"), "default");
    expect(res).toBeNull();
  });

  it("405s a whitelisted path called with a disallowed method", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/chat", methods: ["GET"], auth: "none", expires: null }] }));
    const res = await guard.handle(new Request("http://localhost/chat", { method: "DELETE" }), "default");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(405);
  });

  it("supports /* wildcard matching", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/api/chats/*", methods: ["GET"], auth: "none", expires: null }] }));
    const res = await guard.handle(new Request("http://localhost/api/chats/abc123"), "default");
    expect(res).toBeNull();
  });

  it("supports prefix matching (route path matches path + '/...')", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/chat", methods: ["GET"], auth: "none", expires: null }] }));
    const res = await guard.handle(new Request("http://localhost/chat/sw.js"), "default");
    expect(res).toBeNull();
  });

  it("jwt auth always fails closed (not implemented, must not silently pass)", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/secret", methods: ["GET"], auth: "jwt", expires: null }] }));
    const res = await guard.handle(
      new Request("http://localhost/secret", { headers: { Authorization: "Bearer anything.at.all" } }),
      "default"
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("token auth: rejects missing/incorrect token, allows the correct one", async () => {
    const prevToken = process.env.CLOUDFLARE_ROUTE_TOKEN;
    process.env.CLOUDFLARE_ROUTE_TOKEN = "correct-token";
    try {
      writePolicy(makePolicy({ routes: [{ path: "/secret", methods: ["GET"], auth: "token", expires: null }] }));

      const noAuth = await guard.handle(new Request("http://localhost/secret"), "default");
      expect(noAuth!.status).toBe(401);

      const wrongToken = await guard.handle(
        new Request("http://localhost/secret", { headers: { Authorization: "Bearer wrong" } }),
        "default"
      );
      expect(wrongToken!.status).toBe(401);

      const rightToken = await guard.handle(
        new Request("http://localhost/secret", { headers: { Authorization: "Bearer correct-token" } }),
        "default"
      );
      expect(rightToken).toBeNull();
    } finally {
      if (prevToken === undefined) delete process.env.CLOUDFLARE_ROUTE_TOKEN;
      else process.env.CLOUDFLARE_ROUTE_TOKEN = prevToken;
    }
  });

  it("blocks an expired route", async () => {
    writePolicy(makePolicy({
      routes: [{ path: "/temp", methods: ["GET"], auth: "none", expires: new Date(Date.now() - 1000).toISOString() }],
    }));
    const res = await guard.handle(new Request("http://localhost/temp"), "default");
    expect(res!.status).toBe(403);
  });

  it("logs both allowed and blocked decisions to the audit log", async () => {
    writePolicy(makePolicy({ routes: [{ path: "/chat", methods: ["GET"], auth: "none", expires: null }] }));
    await guard.handle(new Request("http://localhost/chat"), "default");
    await guard.handle(new Request("http://localhost/nope"), "default");

    const logs = await guard.getAuditLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].allowed).toBe(true);
    expect(logs[1].allowed).toBe(false);
  });
});
