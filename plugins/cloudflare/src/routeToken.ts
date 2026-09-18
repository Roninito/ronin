/**
 * A single, self-generated shared secret gating remote (non-loopback) access
 * to /connect and /chat once a tunnel is exposed to the public internet — see
 * docs/REMOTE_ACCESS.md's "pairing" flow (duties/cloudflare-connect.ts and
 * duties/chatty.ts). Deliberately not the heavier RouteGuard/route-policy
 * system: creating a route policy at all gates every route on the server, not
 * just the ones added to it, which would silently 403 every other existing
 * dashboard page — far more than this feature needs. This is just one secret,
 * checked directly by the handful of routes that need it, only for requests
 * that aren't from this machine itself (see DutyRegistry.ts's isLocalRequest
 * stamp).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";

const TOKEN_PATH = join(homedir(), ".ronin", "cloudflare.token");

/** Returns the existing token (env var takes precedence, then the persisted file), generating and persisting a fresh one if neither exists. */
export function getOrCreateRouteToken(tokenPath: string = TOKEN_PATH): string {
  if (process.env.CLOUDFLARE_ROUTE_TOKEN) {
    return process.env.CLOUDFLARE_ROUTE_TOKEN;
  }

  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, "utf-8").trim();
    if (existing) return existing;
  }

  const token = randomBytes(24).toString("hex");
  const dir = join(homedir(), ".ronin");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(tokenPath, token);
  return token;
}

/** True if `req` carries the correct token, either as `Authorization: Bearer <token>` or a `?token=` query param (used the first time, before client JS has stored it). */
export function hasValidRouteToken(req: Request, expectedToken: string): boolean {
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const provided = authHeader.replace(/^Bearer /i, "").replace(/^Token /i, "");
    if (provided === expectedToken) return true;
  }

  const url = new URL(req.url);
  return url.searchParams.get("token") === expectedToken;
}

/**
 * True if `req` should be let through without a token — genuinely local
 * traffic. Deliberately checks the `Host` header, not the TCP socket's peer
 * address: `cloudflared tunnel --url` forwards tunnel traffic to
 * `http://localhost:<port>` over a local connection, so EVERY tunneled
 * request arrives at Ronin's server with a loopback source address — socket
 * IP cannot tell "reached via the public tunnel" apart from "genuinely local"
 * for this topology. cloudflared does preserve the original public Host
 * header when forwarding (confirmed: it does not rewrite it for quick
 * tunnels), so a request whose Host is the tunnel's own `*.trycloudflare.com`
 * hostname is reliably distinguishable from one addressed to `localhost`.
 * Known, accepted limitation: an attacker already on the same LAN could
 * forge a `Host: localhost` header while hitting this Mac's real LAN IP
 * directly — a much narrower threat than "anyone who finds the public tunnel
 * URL," which is what this guards against.
 */
export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  return host === "localhost" || host.startsWith("localhost:") || host === "127.0.0.1" || host.startsWith("127.0.0.1:") || host === "[::1]" || host.startsWith("[::1]:");
}
