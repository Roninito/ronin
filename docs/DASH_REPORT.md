# Dash – A Minimal Ronin Agent

**Authoritative report on Dash: a lighter, highly secure desktop agent with a great chat interface, task management, and agent feed.**

---

## 1. Executive Summary

**What is Dash?** A minimal Ronin agent – a lighter, highly secure desktop app with a great chat interface, task/schedule manager, and agent feed. Dash is designed to be the safest agent on the market while remaining simple to configure from the UI.

**Core value:**
- Bring your own AI (LMStudio, Ollama, or remote)
- File-based everything (logs, memory, tasks, artifacts)
- MCP server for agent integration
- Simple to configure from UI; CLI powerful but out of the way

**Tech stack:** Bun.js, ElectroBun as primary front end (not optional), React Native (mobile)

**Execution model:** SAR (Sense-Act-Respond) engine for agent loops; terminal/shell for chaining and scripting OS commands

**Data model:** Markdown-centric – conversations, skills, tasks, and memory live as `.md` files

**Desktop experience:** Runs in background with system tray icon; animations and sounds for polish

---

## 2. Architecture Overview

```mermaid
flowchart TB
    subgraph Client [ElectroBun Client]
        Sidebar[Sidebar: Home, Chat, Tasks, Config]
        Homepage[Homepage]
        Chat[Chat Interface]
        Tasks[Tasks UI]
        Feed[Agent Feed Grid]
    end

    subgraph Backend [Bun Server]
        AgentRegistry[AgentRegistry]
        SAR[SAR Engine]
        HomeFeed[home-feed Listener]
        ChatAPI[/api/chat]
        TasksAPI[/api/tasks]
    end

    subgraph Storage [File-Based Storage]
        Logs[~/.dash/logs/]
        Memory[short-term-memory.md\nlong-term-memory.md]
        TaskFiles[.task.md]
        Vault[vault.enc]
    end

    Sidebar --> Homepage
    Homepage --> Chat
    Homepage --> Tasks
    Homepage --> Feed
    Chat --> ChatAPI
    Tasks --> TasksAPI
    Feed --> HomeFeed
    AgentRegistry --> HomeFeed
    SAR --> ChatAPI
    HomeFeed --> Memory
    ChatAPI --> Memory
    TasksAPI --> TaskFiles
```

**Homepage** (`/`) – Three top sections:
1. **Chat** – Great chat interface (primary)
2. **Tasks** – Manage tasks (now, later, recurring)
3. **Agent Feed** – Grid cards from `home-feed` events

**Event flow:** Agents → `home-feed` events → grid cards in feed section

**Data flow:** File-based logs, memory, tasks, artifacts under `~/.dash/`

**Reference:** `src/agent/AgentRegistry.ts` – `home-feed` listener, `getDashboardHTML()`, `getHomeFeedItems()`; `docs/CLI.md` – `POST /api/events/emit`, `GET /api/home-feed`

---

## 3. Homepage – Three Top Sections

The homepage is organized into three primary sections (in order of prominence):

### 3.1 Chat (Primary)
Great chat interface; one of the top 3 sections. Primary way to interact with the agent. Context-aware, supports tool calling, streaming, conversation history.

### 3.2 Tasks
Manage tasks (now, later, recurring). Quick add, list, complete. Lighter than Ronin's Kanban.

### 3.3 Agent Feed
Grid of cards from `home-feed` events (like Ronin). Payload: `{ agent, html, title?, priority?, updatedAt? }`; latest-per-agent.

**API:** `GET /api/home-feed`, `DELETE /api/home-feed/:agent`

**Secondary routes:** Config UI, Settings, minimal dashboard nav. Dash keeps it lighter – no agents/plugins management in the main UI.

---

## 4. Tech Stack

| Component | Dash | Ronin Reference |
|-----------|------|-----------------|
| Runtime | Bun.js | `bun run ronin start` |
| Desktop Front End | ElectroBun (primary, not optional) | `desktop/electrobun/`, `ronin client` |
| UI Framework | ElectroBun + DRAM theme (lighter Ronin-style) | Vanilla HTML/CSS in iframe |
| AI | LMStudio, Ollama, remote | `src/api/providers.ts` (`createProvider`), `plugins/model-selector.ts` |
| Mobile | React Native | N/A |

---

## 5. Feature Sections

### 5.1 Chat Interface (Top 3 Homepage Section)

- **Great chat interface** – One of the three primary sections on the homepage. Designed for daily use.
- **Features:** Context-aware of Dash (tasks, memory, skills); tool calling; streaming responses; conversation history; markdown rendering.
- **UX:** Animations (message appear, typing indicator); optional sounds (new message, completion); keyboard shortcuts.
- **Reference:** `agents/chatty.ts` – `/chat`, `/api/chat`. Dash elevates chat to homepage prominence.

### 5.2 Tasks + Schedules

- **Tasks:** Now, later, recurring (every N time units)
- **Schedules:** Cron-based (e.g. `0 */6 * * *`)
- **Reference:** `agents/schedule-manager.ts`, `agents/tasking.ts`, `agents/todo.ts`. Dash simplifies to "now / later / recurring" without full Kanban.

### 5.3 MCP Server

- **Dash as MCP server:** External agents and services use Dash via MCP
- **Ronin:** MCP client (`ronin mcp add`). Dash exposes MCP server so other tools can call Dash (tasks, feed, etc.)

### 5.4 CLI

- **Dash subset:** `dash start`, `dash task add`, `dash feed`, etc. Powerful but out of the way; UI-first configuration.

### 5.5 File-Based Storage

- **Logs:** `~/.dash/logs/` or `~/.ronin/ninja.log`, `daemon.log`
- **Memory:** File-based (short-term-memory.md, long-term-memory.md)
- **Tasks:** File-based task definitions (`.task.md`)
- **Artifacts:** `.task.md` – manage tasks by editing instructions

### 5.6 Artifacts (.task.md)

- Tasks editable as markdown files
- Format: YAML frontmatter + markdown body (similar to `skill.md`)
- Schema: title, instructions, schedule, status

### 5.7 Skill Management

- Find, install, uninstall, enable, disable
- **Reference:** `docs/SKILLS.md`, `src/cli/commands/skills.ts`

### 5.8 Terminal and Shell Integration

- **Core capability:** Dash uses the terminal to utilize, chain, and script terminal commands for its installed OS
- **System awareness:** Knows its system at startup – info from Bun runtime (`process.platform`, `process.arch`, `os.homedir()`) or built-in skill
- **Context injection:** On each call, Dash configures context with system info so the agent can discover and take actions
- **Chaining:** Compose bash/command-prompt commands via `api.shell.exec` / `api.shell.execAsync`
- **Reference:** `plugins/shell.ts`, `api.shell.*`

### 5.9 Markdown-Centric Workflows

- **Primary format:** `.md` files – conversations, skills, tasks, memory
- **User-focused:** Easily takes and handles tasks and markdown management

### 5.10 Memory System

- **short-term-memory.md** and **long-term-memory.md** work in conjunction
- **Required skill:** `remember/skill.md` – agent must call this to "remember"
- **Flow:** Agent invokes remember skill → reads/writes memory files
- **Reference:** `api.memory` (Ronin); `skills/recall`

### 5.11 Tool Access

- **User-granted tools:** agent-browser, etc.
- **API calls:** Via bash (`curl`, `Invoke-WebRequest`)

### 5.12 SAR Engine

- **Bring SAR over:** Dash uses Ronin's SAR engine
- **Templates:** `quickSAR`, `standardSAR`, `smartSAR`
- **Flow:** Sense → Act (tools, shell, skills) → Respond
- **Reference:** `src/chains/templates.ts`, `src/chain/Chain.ts`, `docs/SAR_BEST_PRACTICES.md`

---

## 6. Desktop App (ElectroBun – Primary Front End)

ElectroBun is the primary front end for Dash, not optional.

### 6.1 Design and Layout

- **Lighter Ronin client:** Same visual language as Ronin (`desktop/electrobun/renderer/index.html`) – DRAM theme, sidebar, connection indicator – but without agents/plugins management.
- **Sidebar:** Home, Chat, Tasks, Config. Chat is prominent.
- **Content area:** Homepage with three top sections or route-specific views.

### 6.2 Animations and Sounds

- **Animations:** Message appear/scroll, typing indicator, connection status pulse, smooth transitions.
- **Sounds:** Optional (user-configurable) – new message, task completed, error. Subtle, non-intrusive.

### 6.3 Background and System Tray

- **Runs in background:** Dash stays alive when window is closed.
- **System tray icon:** Click to show; right-click for menu (Show, Restart, Logs, Quit).
- **Window behavior:** Close minimizes to tray; quit from tray or menu.
- **Reference:** `desktop/electrobun/main.js` – `createTray()`, `win.on("close")`

### 6.4 Health and Recovery

- Health check against `/api/health`; auto-recovery if backend dies.

---

## 7. Comparison: Dash vs Ronin

| Aspect | Ronin | Dash |
|--------|-------|------|
| Scope | Full agent library, many agents/plugins | Minimal: feed, chat, tasks, skills |
| Front end | ElectroBun optional, iframe to web | ElectroBun primary; animations, sounds; system tray |
| Homepage | Feed + stats + nav | Top 3: Chat, Tasks, Agent Feed |
| MCP | Client only | Server |
| Tasks | Kanban + PlanProposed flow | Now/later/recurring + .task.md |
| UI | Vanilla HTML in iframe | ElectroBun + DRAM theme |
| AI | 6 providers | LMStudio, Ollama, remote |
| Memory | SQLite (api.memory) | short-term-memory.md + long-term-memory.md + remember skill |
| Execution | SAR + shell plugin | SAR + terminal-centric |
| Data | Mixed (DB + files) | Markdown-centric |
| CLI | Prominent | Powerful but out of the way; UI-first |

---

## 8. Implementation Notes

- **Start from Ronin;** strip non-essential agents and plugins
- **Keep:** AgentRegistry, home-feed, HTTP server, CLI core, skills plugin, SAR engine, shell plugin, ElectroBun desktop
- **Add:** MCP server adapter, `.task.md` loader, simplified task model, system-context injection, `remember` skill, file-based memory; homepage layout with Chat/Tasks/Feed; animations and sounds
- **Replace/adjust:** ElectroBun as primary; homepage prioritizes Chat; lighter sidebar; system tray + background; file-based memory; config via UI

---

## 9. Security Hardening – Safest Agent on the Market

Dash aims to be the safest agent on the market.

### 9.1 Typical Agent Vulnerabilities

| Vulnerability | Ronin Gap | Dash Mitigation |
|---------------|-----------|-----------------|
| Unauthenticated APIs | Webhooks, events open | Auth for sensitive routes; webhook signing |
| Credentials in plaintext | config.json stores secrets | Encrypted vault; OS keychain |
| Weak default password | `roninpass` | No default; force password on first run |
| Prompt injection | No isolation | Input sanitization; context boundaries |
| Credential leakage | AI may echo secrets | Redact from tool results |
| Shell injection | Blocklist only | Stricter allowlist; sandboxing; user confirmation |
| Unrestricted tools | No permission model | Per-tool permissions |
| Event injection | Unauthenticated emit | HMAC/signature; EventGuard |

### 9.2 Password Protection

- **Master password:** Required on first run; no default
- **Hashing:** Argon2id or bcrypt (Bun.password.hash)
- **Session:** Short-lived JWTs; configurable TTL
- **Lockout:** Rate limiting after N failed attempts
- **CLI:** `dash unlock` or `DASH_VAULT_PASSWORD` env

### 9.3 Secret Vault

- **Encrypted vault:** `~/.dash/vault.enc` – AES-256-GCM; key from master password
- **Config:** Stores references (`secretRef: "vault:..."`), not values
- **OS keychain:** Optional for master key
- **Prompts:** Never inject raw secrets; use placeholders

### 9.4 API Hardening

- **Default bind:** localhost only
- **TLS:** For exposed endpoints
- **Webhook auth:** `X-Webhook-Signature` (HMAC-SHA256) or Bearer token
- **Event emit:** Require auth; EventGuard for dangerous events

### 9.5 Shell Safety

- **Allowlist:** Deny by default
- **Sandboxing:** Restricted env
- **User confirmation:** Destructive commands require approval
- **Path restrictions:** No writes to `/etc`, `/usr`

### 9.6 Implementation Phases

1. **Phase 1:** Master password + vault; auth for config and webhooks
2. **Phase 2:** Route protection; EventGuard; webhook signing
3. **Phase 3:** Stricter shell allowlist; user confirmation; output redaction
4. **Phase 4:** OS keychain; TLS; full audit logging

---

## Key Source Files

- `src/agent/AgentRegistry.ts` – home-feed, dashboard, routes
- `docs/CLI.md` – home-feed API, CLI
- `agents/chatty.ts` – chat UI/API
- `agents/schedule-manager.ts` – cron
- `agents/todo.ts` / `agents/tasking.ts` – tasks
- `docs/MCP.md` – MCP
- `docs/SKILLS.md` – skills
- `desktop/electrobun/main.js` – desktop client
