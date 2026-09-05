import type { Plugin } from "../src/plugins/base.js";
import type { DutyAPI } from "../src/types/api.js";
import { homedir } from "os";
import { join } from "path";

type OAuthProvider = "google" | "github" | "apple";

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  userInfoUrl?: string;
}

interface PendingState {
  provider: OAuthProvider;
  createdAt: number;
  redirectUri: string;
}

interface OAuthSession {
  id: string;
  provider: OAuthProvider;
  userId: string;
  email?: string;
  name?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

const SESSION_FILE = join(homedir(), ".ronin", "oauth-sessions.json");
const DEFAULT_BASE_PATH = "/auth/oauth";
const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, PendingState>();
let apiRef: DutyAPI | null = null;
let routesRegistered = false;
let sessions = new Map<string, OAuthSession>();

function stateKey(provider: OAuthProvider, userId: string): string {
  return `${provider}:${userId}`;
}

function randomHex(bytes = 16): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}

async function loadSessions(): Promise<void> {
  try {
    const file = Bun.file(SESSION_FILE);
    if (!(await file.exists())) {
      sessions = new Map();
      return;
    }
    const parsed = JSON.parse(await file.text()) as OAuthSession[];
    sessions = new Map(parsed.map((s) => [stateKey(s.provider, s.userId), s]));
  } catch (error) {
    throw new Error(`Failed to load OAuth sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function persistSessions(): Promise<void> {
  try {
    const rows = Array.from(sessions.values());
    await Bun.write(SESSION_FILE, JSON.stringify(rows, null, 2));
  } catch (error) {
    throw new Error(`Failed to persist OAuth sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function providerConfig(provider: OAuthProvider): OAuthConfig {
  if (provider === "google") {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    };
  }
  if (provider === "github") {
    return {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
      userInfoUrl: "https://api.github.com/user",
    };
  }
  return {
    clientId: process.env.APPLE_CLIENT_ID ?? "",
    clientSecret: process.env.APPLE_CLIENT_SECRET ?? "",
    authUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    scope: "name email",
  };
}

function ensureProviderConfigured(provider: OAuthProvider): OAuthConfig {
  const cfg = providerConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(`OAuth ${provider} not configured. Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET.`);
  }
  return cfg;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) return {};
  const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  try {
    const raw = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getBaseUrl(): string {
  const explicit = process.env.OAUTH_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const webhookPort = apiRef?.config.getSystem().webhookPort ?? 3000;
  return `http://127.0.0.1:${webhookPort}`;
}

function defaultRedirectUri(provider: OAuthProvider, basePath = DEFAULT_BASE_PATH): string {
  return `${getBaseUrl()}${basePath}/${provider}/callback`;
}

async function fetchToken(provider: OAuthProvider, code: string, redirectUri: string): Promise<Record<string, unknown>> {
  const cfg = ensureProviderConfigured(provider);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token exchange failed (${provider}): HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return await res.json() as Record<string, unknown>;
}

async function fetchUserIdentity(
  provider: OAuthProvider,
  accessToken: string,
  idToken?: string
): Promise<{ userId: string; email?: string; name?: string }> {
  if (provider === "apple") {
    const claims = idToken ? decodeJwtPayload(idToken) : {};
    const sub = claims.sub ? String(claims.sub) : "";
    if (!sub) throw new Error("Apple OAuth completed but no user id (sub) found in id_token.");
    return {
      userId: sub,
      email: claims.email ? String(claims.email) : undefined,
      name: claims.name ? String(claims.name) : undefined,
    };
  }

  const cfg = ensureProviderConfigured(provider);
  if (!cfg.userInfoUrl) throw new Error(`Missing user info endpoint for ${provider}`);
  const res = await fetch(cfg.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(provider === "github" ? { "User-Agent": "ronin-oauth-plugin" } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch ${provider} user profile: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const profile = await res.json() as Record<string, unknown>;
  const userId = profile.sub ?? profile.id;
  if (!userId) throw new Error(`OAuth ${provider} profile missing user id.`);
  return {
    userId: String(userId),
    email: profile.email ? String(profile.email) : undefined,
    name: profile.name
      ? String(profile.name)
      : (profile.login ? String(profile.login) : undefined),
  };
}

async function upsertSession(
  provider: OAuthProvider,
  identity: { userId: string; email?: string; name?: string },
  tokenPayload: Record<string, unknown>
): Promise<OAuthSession> {
  const key = stateKey(provider, identity.userId);
  const existing = sessions.get(key);
  const now = Date.now();
  const expiresInRaw = tokenPayload.expires_in;
  const expiresIn = typeof expiresInRaw === "number" ? expiresInRaw : Number(expiresInRaw);
  const session: OAuthSession = {
    id: existing?.id ?? randomHex(12),
    provider,
    userId: identity.userId,
    email: identity.email,
    name: identity.name,
    accessToken: String(tokenPayload.access_token ?? ""),
    refreshToken: tokenPayload.refresh_token ? String(tokenPayload.refresh_token) : existing?.refreshToken,
    expiresAt: Number.isFinite(expiresIn) ? now + expiresIn * 1000 : existing?.expiresAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  sessions.set(key, session);
  await persistSessions();
  return session;
}

function pruneExpiredPendingStates(): void {
  const now = Date.now();
  for (const [state, entry] of pendingStates.entries()) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

async function get_auth_url(
  provider: OAuthProvider,
  options?: { redirectUri?: string; state?: string }
): Promise<{ url: string; state: string; provider: string }> {
  const cfg = ensureProviderConfigured(provider);
  pruneExpiredPendingStates();
  const state = options?.state || randomHex(18);
  const redirectUri = options?.redirectUri || defaultRedirectUri(provider);
  pendingStates.set(state, { provider, createdAt: Date.now(), redirectUri });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state,
  });
  if (provider === "apple") params.set("response_mode", "query");
  return {
    url: `${cfg.authUrl}?${params.toString()}`,
    state,
    provider,
  };
}

async function list_sessions(provider?: OAuthProvider): Promise<Array<Omit<OAuthSession, "accessToken" | "refreshToken">>> {
  await loadSessions();
  return Array.from(sessions.values())
    .filter((s) => !provider || s.provider === provider)
    .map(({ accessToken: _a, refreshToken: _r, ...rest }) => rest);
}

async function get_session(provider: OAuthProvider, userId: string): Promise<Omit<OAuthSession, "accessToken" | "refreshToken"> | null> {
  await loadSessions();
  const found = sessions.get(stateKey(provider, userId));
  if (!found) return null;
  const { accessToken: _a, refreshToken: _r, ...rest } = found;
  return rest;
}

async function clear_session(provider: OAuthProvider, userId: string): Promise<{ success: boolean }> {
  await loadSessions();
  const removed = sessions.delete(stateKey(provider, userId));
  if (removed) await persistSessions();
  return { success: removed };
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

async function callbackFromRequest(provider: OAuthProvider, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) {
    return new Response(`OAuth ${provider} callback missing state or code.`, { status: 400 });
  }
  const pending = pendingStates.get(state);
  if (!pending) {
    return new Response(`OAuth ${provider} callback state is invalid or expired.`, { status: 400 });
  }
  if (pending.provider !== provider) {
    return new Response(`OAuth callback provider mismatch for state.`, { status: 400 });
  }
  pendingStates.delete(state);
  try {
    const tokenPayload = await fetchToken(provider, code, pending.redirectUri);
    const accessToken = tokenPayload.access_token ? String(tokenPayload.access_token) : "";
    if (!accessToken) throw new Error(`No access_token returned from ${provider} token endpoint.`);
    const identity = await fetchUserIdentity(
      provider,
      accessToken,
      tokenPayload.id_token ? String(tokenPayload.id_token) : undefined
    );
    const session = await upsertSession(provider, identity, tokenPayload);
    return new Response(
      `OAuth ${provider} authenticated for ${session.email ?? session.userId}. Session stored.`,
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  } catch (error) {
    return new Response(
      `OAuth ${provider} authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

async function register_routes(basePath = DEFAULT_BASE_PATH): Promise<{ success: boolean; basePath: string }> {
  if (!apiRef) throw new Error("OAuth plugin API not set. setAPI(api) must be called first.");
  if (routesRegistered) return { success: true, basePath };

  const providers: OAuthProvider[] = ["google", "github", "apple"];
  for (const provider of providers) {
    apiRef.http.registerRoute(`${basePath}/${provider}/start`, async () => {
      const { url } = await get_auth_url(provider);
      return redirect(url);
    }, { title: `OAuth ${provider} start`, description: `Start OAuth flow for ${provider}` });

    apiRef.http.registerRoute(`${basePath}/${provider}/callback`, async (req: Request) => {
      return await callbackFromRequest(provider, req);
    }, { title: `OAuth ${provider} callback`, description: `OAuth callback endpoint for ${provider}` });
  }

  apiRef.http.registerRoute(`${basePath}/sessions`, async (req: Request) => {
    const url = new URL(req.url);
    const provider = url.searchParams.get("provider");
    if (provider && !["google", "github", "apple"].includes(provider)) {
      return new Response("Invalid provider", { status: 400 });
    }
    const rows = await list_sessions(provider as OAuthProvider | undefined);
    return new Response(JSON.stringify(rows, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }, { title: "OAuth sessions", description: "List persisted OAuth sessions (sanitized)." });

  routesRegistered = true;
  return { success: true, basePath };
}

function setAPI(api: DutyAPI): void {
  apiRef = api;
  loadSessions().catch((e) => console.error("[oauth] Failed to load sessions:", e));
  register_routes().catch((e) => console.error("[oauth] Failed to register routes:", e));
}

const oauthPlugin: Plugin = {
  name: "oauth",
  description: "Web OAuth authentication for Google, GitHub, and Apple with persisted sessions.",
  methods: {
    setAPI,
    get_auth_url,
    register_routes,
    list_sessions,
    get_session,
    clear_session,
  },
};

export default oauthPlugin;
