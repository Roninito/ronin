# Remote Access — using Ronin from your phone (or any other device)

Ronin's dashboard (`/chat` and friends) is a normal web page. The practical way
to reach it from an Android phone, an iPhone, or a second computer is to point
a browser at a Cloudflare Tunnel — not to install Ronin's engine on that
device.

## Why not install Ronin itself on Android

Bun (Ronin's runtime) has [no official Android
support](https://github.com/oven-sh/bun/issues/8685). Community workarounds
exist (glibc-runner shims that patch around Bun being a glibc binary on
Android's bionic libc) but they're third-party-maintained, not something
Ronin can depend on staying working.

Even if the binary ran, Android aggressively kills backgrounded processes.
Ronin needs to stay running continuously — cron ticks every 60s, a Discord
bot connection, a webhook server — which doesn't survive well on a phone
unless you fight the OS with wake locks and battery-optimization exemptions.

The dashboard-over-a-tunnel approach sidesteps both problems: Ronin keeps
running on a real always-on machine (this Mac, a home server, a small VPS),
and the phone is just a thin client.

## Prerequisite: this depends on the route whitelist actually being enforced

Cloudflare Tunnels expose whatever they're pointed at to the public internet.
Ronin has a route whitelist (`RouteGuard`) built specifically to control that
exposure — **as of this doc, it's wired into the real server and enforced.**
Do not follow this guide against an older build where that fix hasn't
landed; a tunnel would expose every route, including `/disk` and
`/admin`, with no protection at all.

**Important — this changes local access too.** The moment a route policy
exists (see Setup below), *every* request to Ronin's HTTP server is gated by
it — not just tunneled traffic. Your own local dashboard access goes through
the same whitelist. If you forget to whitelist the routes you use locally,
you lock yourself out of your own dashboard, not just remote visitors.

## Setup

```bash
# 1. Create a route policy (opts you into the whitelist — do this once)
ronin cloudflare route init

# 2. Whitelist the dashboard routes you actually use — both what you'll
#    tunnel AND anything you still want to reach locally. Whitelisting /chat
#    also covers /chat/manifest.json, /chat/sw.js, /chat/icon.svg for free
#    (RouteGuard matches by prefix), but /connect is a separate top-level
#    path and needs its own entry if you want to load it locally too.
ronin cloudflare route add /chat --methods GET,POST
ronin cloudflare route add /api/chat --methods GET,POST
ronin cloudflare route add /api/chats --methods GET,POST
ronin cloudflare route add "/api/chats/*" --methods GET,POST
ronin cloudflare route add /connect --methods GET

# 3. (Recommended) require a bearer token so a leaked tunnel URL alone
#    isn't enough to reach your dashboard. Pick any long random string.
export CLOUDFLARE_ROUTE_TOKEN="<a long random string>"
ronin cloudflare route add /chat --methods GET,POST --auth token
ronin cloudflare route add /api/chat --methods GET,POST --auth token
ronin cloudflare route add /api/chats --methods GET,POST --auth token
ronin cloudflare route add "/api/chats/*" --methods GET,POST --auth token

# 4. Start a tunnel
ronin cloudflare tunnel temp            # quick, anonymous, expires in 1h by default
ronin cloudflare tunnel temp 7200       # custom TTL in seconds
```

`tunnel temp` requires nothing but `cloudflared` installed locally (no
Cloudflare account, no DNS setup) — it prints a real `https://*.trycloudflare.com`
URL the moment the tunnel is up.

> **A freshly issued tunnel URL can take a little while to become fully
> reachable** — `cloudflared` itself warns "may take some time to be
> reachable" right in its own output. If the first request 404s, wait a
> few seconds and try again before assuming something's wrong.

If you'd rather use a permanent, named tunnel on a domain you own in
Cloudflare instead of an ephemeral `tunnel temp` session, use
`ronin cloudflare tunnel create <name>` plus Cloudflare's own
`wrangler tunnel route dns` to map a real hostname — out of scope for this
quick-start doc.

## Using it from Android (or iPhone, or any browser)

1. Scan the QR code Ronin prints (see below) or type/paste the tunnel URL.
2. If you set up token auth, the browser will need the token — the simplest
   way is to append it once as `?token=<...>` the first time (Ronin's route
   auth reads the `Authorization` header, so a bookmarklet or a simple
   browser extension that sets the header is the more correct long-term
   approach than passing tokens in the URL).
3. **Install it as an app**: once you have `/chat` open, use your browser's
   "Add to Home Screen" / install prompt — Ronin's `/chat` page ships a web
   app manifest and service worker specifically so this works, so after the
   first visit you get a real home-screen icon that launches straight into
   the chat UI, no URL bar involved.

## QR code

Two ways to get a scannable code for the current tunnel:
- Right after `ronin cloudflare tunnel temp` succeeds, an ASCII QR code is
  printed directly in your terminal.
- Load `/connect` on the dashboard (locally, or through the tunnel once
  whitelisted) for an on-screen QR code of whichever tunnel is currently
  active.

Both encode the exact URL `cloudflared` issued — nothing is sent to a
third-party QR-rendering service; the code is generated locally.

## Optional extra hardening: Cloudflare Access

Ronin's own `token` auth (above) is a real check, but it's simple — a single
shared secret. For anything more sensitive, put
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(their own login wall — supports real SSO, free for small use) in front of
the tunnel at the Cloudflare dashboard level. This is independent of
anything in Ronin's own code, so it works as a second layer even if a route
policy is ever misconfigured. Not required — Ronin's native whitelist +
token auth is a real, working boundary on its own — but worth it if you're
exposing this to more than just yourself.

## Troubleshooting

- **Everything returns 403, including local access** — you ran
  `route init` but haven't whitelisted the routes you're using yet. See
  Setup step 2.
- **A whitelisted route returns 401** — you set `--auth token` on it but
  aren't sending the right `Authorization: Bearer <token>` header (or
  `$CLOUDFLARE_ROUTE_TOKEN` isn't set in the environment Ronin is running in).
- **A fresh tunnel URL 404s** — give it a few seconds; see the propagation
  note in Setup.
- **A route returns 403 no matter what you whitelist** — check it isn't
  matching one of the always-blocked paths (`/disk/**`, `/admin/**`,
  `/internal/**`, `/api/os-bridge/**`, `/.ronin/**`, any `.env`/`config.json`)
  — those are blocked unconditionally, before the whitelist is even checked.
