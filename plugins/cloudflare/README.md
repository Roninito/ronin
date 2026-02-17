# @ronin/plugin-cloudflare

Secure Cloudflare integration for Ronin with zero-trust tunnel management.

## Features

- **Secure Tunnels**: Create Cloudflare tunnels with strict route-level security
- **Zero-Trust Model**: Nothing exposed by default - explicit whitelist required
- **RouteGuard**: Multi-layer security middleware (paths, methods, auth, time restrictions)
- **EventGuard**: Prevents dangerous internal events from remote execution
- **Circuit Breaker**: Auto-blocks suspicious activity with notifications
- **Temporary Tunnels**: Auto-expiring tunnels (max 24 hours)
- **Audit Logging**: All access logged to file for security review

## Installation

```bash
# Install plugin
cd plugins/cloudflare
bun install

# Or from Ronin root
bun run ronin plugins install cloudflare
```

## Quick Start

```bash
# 1. Authenticate with Cloudflare
ronin cloudflare login

# 2. Initialize route policy (REQUIRED before creating tunnels)
ronin cloudflare route init

# 3. Add routes you want to expose
ronin cloudflare route add /dashboard

# 4. Create tunnel
ronin cloudflare tunnel create my-tunnel

# Or create temporary tunnel (auto-expires)
ronin cloudflare tunnel temp 3600  # 1 hour
```

## Security Model

### Default Deny

**CRITICAL**: By default, NOTHING is accessible through the tunnel. You must explicitly whitelist routes.

```json
// ~/.ronin/cloudflare.routes.json
{
  "version": "1.0",
  "mode": "strict",
  "routes": [
    {
      "path": "/dashboard",
      "methods": ["GET"],
      "auth": "token"
    }
  ],
  "blockedPaths": [
    "/disk/**",
    "/admin/**",
    "/internal/**"
  ]
}
```

### Defense in Depth

Every request goes through multiple security layers:

1. **Circuit Breaker** - Blocks IPs with too many failures
2. **RouteGuard** - Validates against whitelist
3. **EventGuard** - Filters dangerous events
4. **Projection Layer** - Sanitizes data output

### Blocked by Default

These paths are automatically blocked:
- `/disk/**` - Disk/file system access
- `/admin/**` - Admin interfaces
- `/internal/**` - Internal APIs
- `/api/os-bridge/**` - OS integration
- `~/.ronin/**` - Configuration files

## Route Policy Configuration

### Route Options

```json
{
  "path": "/api/tasks",
  "methods": ["GET", "POST"],
  "auth": "jwt",  // "none", "token", or "jwt"
  "expires": "2026-02-15T00:00:00Z",
  "availableBetween": {
    "start": "09:00",
    "end": "17:00"
  },
  "allowedEvents": ["task.list", "task.view"]
}
```

### Authentication Types

- **none**: No authentication (for public HTML pages)
- **token**: Simple bearer token
- **jwt**: JWT validation

### Time Restrictions

- **expires**: ISO date when route becomes unavailable
- **availableBetween**: Office hours (e.g., 09:00 to 17:00)

## CLI Commands

### Authentication
```bash
ronin cloudflare login              # Authenticate
ronin cloudflare logout             # Remove credentials
ronin cloudflare status             # Show status
```

### Tunnel Management
```bash
ronin cloudflare tunnel create NAME     # Create tunnel
ronin cloudflare tunnel temp [TTL]      # Temporary tunnel (max 86400s)
ronin cloudflare tunnel start NAME      # Start existing
ronin cloudflare tunnel stop NAME       # Stop tunnel
ronin cloudflare tunnel delete NAME     # Delete permanently
ronin cloudflare tunnel list            # List all tunnels
```

### Route Management
```bash
ronin cloudflare route init             # Create policy file
ronin cloudflare route add PATH         # Add route
ronin cloudflare route remove PATH      # Remove route
ronin cloudflare route list             # List routes
ronin cloudflare route validate         # Validate policy
```

### Deployment
```bash
ronin cloudflare pages deploy DIR PROJECT  # Deploy to Pages
```

### Security
```bash
ronin cloudflare security audit         # Run security audit
```

## Events

### Emitted Events

Agents can listen to these events:

```typescript
// Tunnel lifecycle
api.events.on('cloudflare.tunnel.active', (data) => {
  console.log(`Tunnel active: ${data.url}`);
});

// Security events
api.events.on('cloudflare.route.blocked', (data) => {
  console.log(`Blocked: ${data.path} - ${data.reason}`);
});

api.events.on('cloudflare.circuitbreaker.triggered', (data) => {
  console.warn(`Circuit breaker: ${data.reason}`);
});
```

### Triggering Events

```typescript
// Create tunnel programmatically
api.events.emit('cloudflare.tunnel.create', {
  name: 'demo-tunnel',
  temporary: true,
  ttl: 3600
});
```

## Architecture

```
Internet Request
    ↓
Cloudflare Tunnel (TLS)
    ↓
Circuit Breaker (rate limiting)
    ↓
RouteGuard (whitelist validation)
    ↓
EventGuard (event filtering)
    ↓
Projection Layer (data sanitization)
    ↓
Ronin Agent Logic
```

## Audit Logs

All access attempts are logged to:
```
~/.ronin/cloudflare.audit.log
```

Format:
```json
{"timestamp":1234567890,"method":"GET","path":"/dashboard","sourceIP":"unknown","allowed":true,"tunnelName":"my-tunnel"}
```

View logs:
```bash
tail -f ~/.ronin/cloudflare.audit.log
```

## Circuit Breaker

Automatically blocks IPs that:
- Make too many failed requests (default: 10/minute)
- Attempt access to blocked paths repeatedly
- Trigger other suspicious patterns

Block duration: 15 minutes

## Security Best Practices

1. **Always use strict mode** - No wildcards
2. **Set expiration** - Routes should expire
3. **Use authentication** - Even for "public" pages
4. **Limit methods** - Only allow necessary HTTP methods
5. **Define projections** - Never expose internal data structures
6. **Review audit logs** - Check regularly for attacks
7. **Temporary tunnels** - Use for demos/sharing

## Configuration Files

```
~/.ronin/
├── cloudflare.json              # Auth tokens
├── cloudflare.routes.json       # Route policy (CRITICAL)
├── cloudflare.state.json        # Tunnel state
└── cloudflare.audit.log         # Access logs
```

## Troubleshooting

### Tunnel creation fails
```bash
# Check if policy exists
ronin cloudflare route validate

# Check if authenticated
ronin cloudflare status

# Check Wrangler installation
which wrangler
```

### 403 Forbidden
- Route not in whitelist
- Path in blocked list
- Route expired
- Outside allowed hours
- Authentication failed

### 401 Unauthorized
- Missing Authorization header
- Invalid token/JWT

## License

MIT © Ronin
