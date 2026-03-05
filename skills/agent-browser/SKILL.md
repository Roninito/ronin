---
name: Agent Browser
description: Reference guide for agent-browser CLI installation, workflow, and full command set.
---

# Agent Browser Skill

Documentation-first skill for using the `agent-browser` CLI effectively.

## When to Use

- You need install/setup commands for `agent-browser`
- You need the command syntax for browser automation tasks
- You want quick-reference examples for snapshots, refs, waiting, tabs, network, or debugging

## Abilities

### reference
Return a structured reference for `agent-browser` CLI usage.
- Input: topic (optional string, e.g. "navigation", "snapshot", "debugging", "all")
- Output: { topic, content }
- Run: bun run scripts/reference.ts --topic={topic}

## Browser Automation with agent-browser

### Installation

#### npm (recommended)

```bash
npm install -g agent-browser
agent-browser install
agent-browser install --with-deps
```

#### From source

```bash
git clone https://github.com/vercel-labs/agent-browser
cd agent-browser
pnpm install
pnpm build
agent-browser install
```

### Quick start

```bash
agent-browser open <url>        # Navigate to page
agent-browser snapshot -i       # Get interactive elements with refs
agent-browser click @e1         # Click element by ref
agent-browser fill @e2 "text"   # Fill input by ref
agent-browser close             # Close browser
```

### Core workflow

1. Navigate: `agent-browser open <url>`
2. Snapshot: `agent-browser snapshot -i` (refs like `@e1`, `@e2`)
3. Interact using refs from snapshot
4. Re-snapshot after navigation or major DOM changes

## Command Reference

### Navigation

```bash
agent-browser open <url>
agent-browser back
agent-browser forward
agent-browser reload
agent-browser close
```

### Snapshot / page analysis

```bash
agent-browser snapshot
agent-browser snapshot -i
agent-browser snapshot -c
agent-browser snapshot -d 3
agent-browser snapshot -s "#main"
```

### Interactions (using `@ref`)

```bash
agent-browser click @e1
agent-browser dblclick @e1
agent-browser focus @e1
agent-browser fill @e2 "text"
agent-browser type @e2 "text"
agent-browser press Enter
agent-browser press Control+a
agent-browser keydown Shift
agent-browser keyup Shift
agent-browser hover @e1
agent-browser check @e1
agent-browser uncheck @e1
agent-browser select @e1 "value"
agent-browser scroll down 500
agent-browser scrollintoview @e1
agent-browser drag @e1 @e2
agent-browser upload @e1 file.pdf
```

### Get information

```bash
agent-browser get text @e1
agent-browser get html @e1
agent-browser get value @e1
agent-browser get attr @e1 href
agent-browser get title
agent-browser get url
agent-browser get count ".item"
agent-browser get box @e1
```

### Check state

```bash
agent-browser is visible @e1
agent-browser is enabled @e1
agent-browser is checked @e1
```

### Screenshots and PDF

```bash
agent-browser screenshot
agent-browser screenshot path.png
agent-browser screenshot --full
agent-browser pdf output.pdf
```

### Video recording

```bash
agent-browser record start ./demo.webm
agent-browser click @e1
agent-browser record stop
agent-browser record restart ./take2.webm
```

### Wait

```bash
agent-browser wait @e1
agent-browser wait 2000
agent-browser wait --text "Success"
agent-browser wait --url "/dashboard"
agent-browser wait --load networkidle
agent-browser wait --fn "window.ready"
```

### Mouse control

```bash
agent-browser mouse move 100 200
agent-browser mouse down left
agent-browser mouse up left
agent-browser mouse wheel 100
```

### Semantic locators

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find first ".item" click
agent-browser find nth 2 "a" text
```

### Browser settings

```bash
agent-browser set viewport 1920 1080
agent-browser set device "iPhone 14"
agent-browser set geo 37.7749 -122.4194
agent-browser set offline on
agent-browser set headers '{"X-Key":"v"}'
agent-browser set credentials user pass
agent-browser set media dark
```

### Cookies and storage

```bash
agent-browser cookies
agent-browser cookies set name value
agent-browser cookies clear
agent-browser storage local
agent-browser storage local key
agent-browser storage local set k v
agent-browser storage local clear
```

### Network

```bash
agent-browser network route <url>
agent-browser network route <url> --abort
agent-browser network route <url> --body '{}'
agent-browser network unroute [url]
agent-browser network requests
agent-browser network requests --filter api
```

### Tabs and windows

```bash
agent-browser tab
agent-browser tab new [url]
agent-browser tab 2
agent-browser tab close
agent-browser window new
```

### Frames and dialogs

```bash
agent-browser frame "#iframe"
agent-browser frame main
agent-browser dialog accept [text]
agent-browser dialog dismiss
```

### JavaScript and state

```bash
agent-browser eval "document.title"
agent-browser state save auth.json
agent-browser state load auth.json
```

### Sessions and JSON

```bash
agent-browser --session test1 open site-a.com
agent-browser --session test2 open site-b.com
agent-browser session list
agent-browser snapshot -i --json
agent-browser get text @e1 --json
```

### Debugging

```bash
agent-browser open example.com --headed
agent-browser console
agent-browser console --clear
agent-browser errors
agent-browser errors --clear
agent-browser highlight @e1
agent-browser trace start
agent-browser trace stop trace.zip
agent-browser record start ./debug.webm
agent-browser record stop
agent-browser --cdp 9222 snapshot
```

## Examples

### Form submission

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i
```

### Authentication with saved state

```bash
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "/dashboard"
agent-browser state save auth.json
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

## Troubleshooting

- If command is not found on Linux ARM64, use the full path in the bin folder
- If element is not found, run `snapshot` and use the latest ref
- If page is not loaded, add a `wait` after navigation
- Use `--headed` to see browser window while debugging

## Options

- `--session` use an isolated session
- `--json` machine-readable output
- `--full` full page screenshot
- `--headed` show browser window
- `--timeout` set command timeout in milliseconds
- `--cdp` connect via Chrome DevTools Protocol

## Notes

- Refs are stable per page load but change after navigation
- Always snapshot after navigation to refresh refs
- Prefer `fill` over `type` for inputs when you need to clear old values
