import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getOrCreateRouteToken, hasValidRouteToken, isLocalRequest } from "../plugins/cloudflare/src/routeToken.js";

describe("getOrCreateRouteToken", () => {
  let scratchDir: string;
  const originalEnv = process.env.CLOUDFLARE_ROUTE_TOKEN;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.CLOUDFLARE_ROUTE_TOKEN;
    else process.env.CLOUDFLARE_ROUTE_TOKEN = originalEnv;
  });

  it("prefers CLOUDFLARE_ROUTE_TOKEN env var over the persisted file", () => {
    process.env.CLOUDFLARE_ROUTE_TOKEN = "env-token-value";
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-route-token-"));
    const tokenPath = join(scratchDir, "cloudflare.token");
    writeFileSync(tokenPath, "file-token-value");

    expect(getOrCreateRouteToken(tokenPath)).toBe("env-token-value");
  });

  it("generates and persists a fresh token when neither env nor file exist", () => {
    delete process.env.CLOUDFLARE_ROUTE_TOKEN;
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-route-token-"));
    const tokenPath = join(scratchDir, "cloudflare.token");

    const token = getOrCreateRouteToken(tokenPath);
    expect(token.length).toBeGreaterThan(20);
    expect(existsSync(tokenPath)).toBe(true);

    // Second call reuses the same persisted token rather than generating a new one.
    const second = getOrCreateRouteToken(tokenPath);
    expect(second).toBe(token);
  });
});

describe("hasValidRouteToken", () => {
  const TOKEN = "the-correct-token";

  it("accepts a matching Authorization: Bearer header", () => {
    const req = new Request("http://x/y", { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(hasValidRouteToken(req, TOKEN)).toBe(true);
  });

  it("accepts a matching ?token= query param", () => {
    const req = new Request(`http://x/y?token=${TOKEN}`);
    expect(hasValidRouteToken(req, TOKEN)).toBe(true);
  });

  it("rejects a wrong token in either form", () => {
    expect(hasValidRouteToken(new Request("http://x/y", { headers: { Authorization: "Bearer wrong" } }), TOKEN)).toBe(false);
    expect(hasValidRouteToken(new Request("http://x/y?token=wrong"), TOKEN)).toBe(false);
  });

  it("rejects a request with neither", () => {
    expect(hasValidRouteToken(new Request("http://x/y"), TOKEN)).toBe(false);
  });
});

describe("isLocalRequest", () => {
  it("is true for a request whose Host header is localhost (with or without a port)", () => {
    expect(isLocalRequest(new Request("http://x/y", { headers: { Host: "localhost" } }))).toBe(true);
    expect(isLocalRequest(new Request("http://x/y", { headers: { Host: "localhost:3000" } }))).toBe(true);
    expect(isLocalRequest(new Request("http://x/y", { headers: { Host: "127.0.0.1:3000" } }))).toBe(true);
  });

  it("is false for a request whose Host header is a real (e.g. tunnel) hostname", () => {
    expect(isLocalRequest(new Request("http://x/y", { headers: { Host: "random-words.trycloudflare.com" } }))).toBe(false);
    expect(isLocalRequest(new Request("http://x/y", { headers: { Host: "192.168.1.50:3000" } }))).toBe(false);
  });

  it("defaults to false when there's no Host header at all (fail closed)", () => {
    expect(isLocalRequest(new Request("http://x/y"))).toBe(false);
  });
});
