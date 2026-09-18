# Megamind — Target Architecture Spec

**Status:** Target state for simplifying Ronin. Not a rewrite plan — a
destination. Ronin's working infrastructure (event bus, HTTP routing,
plugin/Tool Pack loader) is assumed worth keeping. What needs to change is
the conceptual layer on top of it: too many overlapping names for the same
thing, and two generations of "agent" semantics tangled together.

**Purpose of this document:** hand this to Claude Code (or any coding agent)
pointed at the Ronin repo, and ask it to (a) map every existing concept in
the codebase onto one of the primitives below, (b) flag anything that maps
to nothing, and (c) propose a migration plan — not necessarily a rewrite.

**Ground truth for current-state facts:** `ARCHITECTURE.md` in this repo
(root). It is kept in sync with the code as the code changes — if this
document and `ARCHITECTURE.md` disagree about what currently exists,
`ARCHITECTURE.md` wins; this document only wins about where things are
*headed*.

---

## 0. Context for the migrating agent

Ronin has accumulated three generations of design that don't agree with
each other or with the code:

1. An early "super Claude Code" phase, where `agents/` meant a markdown or
   TS-class config resembling a subagent definition.
2. A mid refactor (`ARCHITECTURE.md`) that renamed `Agent` → `Duty`,
   introduced a Sense/Analyze/Respond ("SAR") execution envelope, and tried
   to collapse six capability folders
   (`agents/plugins/skills/techniques/katas/contracts`) into three
   (`Tool`/`Skill`/`Duty`).
3. The author's current mental model (this document), which no longer uses
   "agent" for a config at all — "agent" now means a **CLI process**
   (Claude Code, OpenCode) invoked with a generated instruction sheet
   (prompt + context + skills). This is a different concept from a Duty and
   should not be renamed to match it.

The `technique`/`kata`/`contract`/`task` cluster was flagged for removal in
generation 2 but shares a storage substrate (`storage-v2.ts`, `parser-v2.ts`)
with real, currently-used execution paths. `technique` turned out to be
genuinely dead and has been removed. `kata` went through an intermediate
verdict of "load-bearing, keep permanently" that this document is now
correcting: investigation for an actual removal pass found the things that
would have justified keeping the DSL/compiler/registry layer — branching,
parallel phases, parent/child data-threading — weren't really delivered
through it, so `kata` was removed after all; `contract`/`task` stayed, with
the phase graph now living inline on the contract. See §2.10 and
`ARCHITECTURE.md` §5.

A naming collision existed between Ronin's own `ARCHITECTURE.md` (which used
to describe an internal "MNGR" Duty — "the Duty whose Respond actions assign
work to other Duties") and the author's separate external product also
called MNGR. **That internal-MNGR description was inaccurate and has been
removed from `ARCHITECTURE.md`** — the real `duties/mngr-worker.ts` is a
worker/client that registers with the external MNGR product over REST; it
does not coordinate other Duties internally, and no internal coordinating
Duty exists anywhere in the codebase. See `ARCHITECTURE.md` §6.1 for the
full, cited explanation — not repeated here to avoid the two docs drifting
apart again.

---

## 1. The One Idea

Everything is a **Duty**, woken by either an **event** or a **schedule**,
running against a **plain heartbeat loop** — not a behavior tree. (A real
behavior tree with composite decision nodes was considered and explicitly
rejected: the author does not currently have conditional multi-Duty logic
common enough to justify that complexity. Revisit only if that changes.)

```
Sensors ─┐
Schedule ─┼──► [ event bus ] ──► Duty.run() ──► effects (events, files, API calls, spawned processes)
Direct   ─┘
call
```

No SAR envelope, no separate "Contract" class, no Tool/Skill split as
first-class runtime concepts. One loop, one bus, one work-unit type.

---

## 2. Core Primitives

### 2.1 The Loop
A single process ticks at a configurable interval (default 1s). Each tick:
1. Checks due cron schedules, invokes matching Duties.
2. Drains the event queue, dispatches to subscribed Duties.

No node status (Success/Failure/Running), no shared blackboard, no tree
traversal. If a Duty needs multi-step conditional logic, that logic lives
inside the Duty's own `run()`.

### 2.2 Event Bus
In-process pub/sub. `publish(event, payload)`, `subscribe(event, handler)`.
Cross-Duty communication is **events only** — no direct calls into another
Duty's internals. (This rule already existed in Ronin's docs; keep it.)

### 2.3 Duty
The one work-unit type. A Duty declares:
- a name
- a trigger: event subscription(s) and/or a cron schedule (see 2.5) — at
  least one required, both allowed
- optionally, one or more HTTP routes (see 2.6)
- a `run(context)` implementing exactly one of four kinds of work:

| Kind | What it is | Example |
|---|---|---|
| **Function** | Pure in-process code. No AI, no external process. | bash/file ops, math, formatting |
| **API/process orchestration** | Talks to an external API or a spawned long-lived backend. No AI, no CLI agent — deterministic integration code. | the Reticulum mesh-networking duty (spawns a Python backend, sends/receives LXMF messages) |
| **Direct model call** | Prompt + context straight to a model API. Used when generation is needed but full agentic/coding capability is not. | drafting copy, summarizing, classifying |
| **CLI agent spawn** | Spawns Claude Code / OpenCode with a generated instruction sheet (prompt, context, skills references). Used for open-ended coding, planning, or judgment-heavy work — including **creating new Duties**. | "write a new Duty that does X" is handled by spawning a CLI agent, not by a hand-coded meta-Duty |

A Duty never needs to be more than one of these four kinds. If a task
needs two kinds, that's two Duties connected by an event, not one Duty
doing both.

**Resolved:** "Direct model call" is already fully covered by the existing
model router (`AIAPI.complete`/`.callTools`, tier-based). "CLI agent spawn"
is a deliberately separate mechanism (`duties/tasking.ts` +
`src/tasking/executors.ts`, dispatching to `claude`/`opencode`/`qwen`/
`cursor`/`gemini` CLI plugins) that does not go through the model router at
all — it shells out to CLI binaries directly. These are correctly two
different paths already, not two things that need reconciling into one.

### 2.4 Sensors
Not a separate class — a naming convention for a Duty that only publishes,
never subscribes. Its `run()` translates an external signal (system event,
messenger/notification traffic, file change, mesh message) into
`bus.publish(...)`. No decision logic.

### 2.5 Schedule
Not a separate concept ("Contract" is retired in name only — see 2.10, the
underlying trigger→phase engine stays, minus Kata). A cron expression is just one of the
two trigger types a Duty can declare, alongside or instead of event
subscriptions.

### 2.6 Routes
Any Duty may optionally register one or more HTTP routes on the engine's
single local HTTP server (status pages, management UIs, custom local HTML
tools). This pattern already works in Ronin (`static webhook` +
`onWebhook()`) — audit for reuse rather than rebuilding. `mngr-worker.ts`
is a genuine, live example of this pattern; `tool-orchestrator.ts` also
implements it correctly as *code*, but is not currently receiving any
traffic (see the migration map) — reference it for the pattern, not as
evidence the pattern is in active use there specifically.

Tunneling (Cloudflare Tunnel, etc.) is the user's concern, not the engine's;
the engine just needs to be a normal local server. **This is also the
answer to mobile access** — see 2.11's note on why mobile access is
out of scope for the cross-instance primitive.

### 2.7 Plugins / Tool Packs
Kept as-is, deliberately. This was already a pluggable toolkit rather than
built-in tools, which is the right call — MCP reduces but does not
eliminate the need for it (Reticulum-style API/process orchestration is not
naturally an MCP server; it's a Ronin-native capability). A Duty of kind
"API/process orchestration" typically calls into a Plugin/Tool Pack, or
into an MCP client, depending on what's available. **All tooling comes from
Plugins (or MCP) — there is no separate `Tool` registry/type sitting
alongside them.**

### 2.8 Skills (agentskills.io-aligned)
Kept as a first-class concept, distinct from tooling. A Skill is a portable,
declarative, markdown-defined capability compatible with the agentskills.io
convention — the kind of thing you'd hand to a CLI agent as part of its
instruction sheet (see 2.3, "CLI agent spawn"), not something a Duty calls
like a function. Skills are how you give a spawned Claude Code / OpenCode
process reusable, shareable know-how; Plugins are how a Duty gets typed
tooling. Keep both, keep them distinct, and keep the existing `skills/`
markdown format — just verify it's actually agentskills.io-compatible
rather than a bespoke lookalike.

**Still open:** Ronin's `SKILL.md` frontmatter (`name`, `description`) looks
compatible on its face, but the body format adds a bespoke `## Abilities`
section with `Input:`/`Output:`/`Run:` lines that get parsed and dispatched
to a literal shell command template — that specific mechanism is very
likely a Ronin-specific addition, not part of the published agentskills.io
spec, which expects the agent itself to read the skill and act on it via
its own tool use. Needs a real side-by-side check against the published
spec text, not inference from code shape alone — not done here.

### 2.9 SARChain — candidate core tech, not discarded
`packages/sar` (Executor, Chain, MiddlewareStack) is real infrastructure —
token-guard budget enforcement, centralized model resolution, execution
tracking, and logging, applied uniformly. This is worth keeping. What's
**not** worth keeping is forcing every Duty into a rigid three-phase
Sense/Analyze/Respond shape by convention just because the middleware chain
exists.

**Resolved:** yes, this is already separable today. `DutyRegistry.executeDuty()`
wraps every Duty in the middleware stack automatically regardless of
whether that Duty's own code has any phase structure at all — a Duty opts
into deeper use via `this.use()`/`this.createChain()` or doesn't; nothing
in the `Chain`/`Executor`/`MiddlewareStack` API requires or names three
phases. "Sense/Analyze/Respond" is a label the current `ARCHITECTURE.md`
applies to what the stack conceptually does, not a constraint baked into
the API.

### 2.10 Contract → Task — Kata removed, resolved (not the A/B decision this section used to pose)
This section previously framed Kata as "confirmed real, needs a decision,
not a removal" and leaned toward keeping it as a distinct concept (Option A
below). That's now overtaken by events: a real removal pass happened, and
neither Option A nor Option B is what shipped — a third path, not
considered at the time, turned out to be the right one: delete the DSL/
compiler/registry layer entirely and store the phase graph as plain data
directly on the Contract, with no intermediate "Kata" object at all.

```
Contract ──inline phases──► Task ──runs phases──► Skills / Tools
(trigger: cron, or           (a running          (leaf
 event + condition            instance)           capabilities)
 guard; phase graph
 stored on the row)
```

- **Contract** binds a trigger — cron, or an event with an optional
  condition guard — directly to a phase graph (`initial <phase>`/`phase
  <name>` blocks, parsed into JSON on the contract row).
- **Task** is a running instance of that phase graph, advancing phase by
  phase via `ContractTaskEngine`/`ContractTaskExecutor` on `TaskStorageV2`.
- Contracts are still **AI-authored from plain English** (`contract
  propose`), staged as a pending proposal, and only go live once a human
  approves it via a review UI — never silently. There's no separate `kata
  propose` anymore; a contract proposal drafts its own phases block inline.

**Why removal won over both options on the table:** investigation found Kata
wasn't actually delivering what would have justified Option A's "keep it
distinct" case — `src/kata/conditions.ts` was only consumed by Contract
trigger evaluation, not phase-to-phase branching; the parallel-phase
coordinator was fully built and never called; `spawn kata → var` parsed but
silently discarded the binding. None of branching, parallelism, or
parent/child data-threading worked *through* Kata to begin with, so deleting
it lost none of that. And Option B's "fold Kata into a generic interpreter
Duty" was never necessary either — the executor doesn't need to be a Duty at
all; it's a normal engine component like the old Task engine was, just
reading phases off the Contract instead of off a separate compiled artifact.
The three live contracts (`daily-morning-briefing`, `on-discord-mention`,
`portfolio-sync`) were migrated to inline phases as part of the same pass;
`portfolio-sync`'s kata-version mismatch (silently failing every 15 minutes
during market hours) was fixed along the way. See `ARCHITECTURE.md` §5 for
the current shape and the "Kata removal" note in its migration-notes
section.

### 2.11 Cross-Boundary Communication (Realm + Reticulum, two different tiers)

**This did not exist in the original draft of this spec — added after
confirming what's actually built.** The author's stated goal ("mobile setup
and adding Ronin to multiple machines and communication between them")
turned out to be three separate problems, each with its own answer.
Conflating them was the original gap in this document.

**Mobile access is solved and is neither of these primitives' job.** Bun
has no real Android support, and phones aggressively kill backgrounded
processes, so Ronin never runs *on* a phone. The answer is already built
and documented (`docs/REMOTE_ACCESS.md`): Ronin stays running on a real
always-on machine, a Cloudflare Tunnel exposes the dashboard, `RouteGuard`
enforces a fail-closed path whitelist on every request (tunneled or local),
and `/chat` is an installable PWA. Nothing in this section changes that.

The remaining goal splits into two tiers with different trust models and
different transports — **do not merge them into one mechanism**:

#### Tier 1 — Realm: your own machines (intra-owner, paired, low-latency)

A call-sign-based pairing system for machines *you* own, in two parts:

- **`realm-server`** (a separate sibling project, not part of this repo) —
  a lightweight Bun WebSocket server, SQLite-backed, that acts as a
  discovery/signaling registry: instances register a call sign + current
  WebSocket address, send heartbeats, and the server relays WebRTC SDP
  offers/answers and ICE candidates so two instances can establish a direct
  peer connection (falling back to relayed WebSocket if P2P doesn't
  negotiate).
- **`plugins/realm.ts`** (in this repo) — the client side. Exposes
  `beam(target, eventType, payload)` (fire-and-forget push to a named
  peer), `query(target, queryType, payload)` (request/response),
  `sendMessage`, `sendMedia`, and `getPeerStatus`. Already has a live
  consumer today: `duties/voice-messaging.ts` uses `api.realm.sendMessage()`.

An incoming beam is re-emitted into the receiving instance's local event
bus as `realm:beam:<eventType>` (not as the plain event name) — **kept
explicit, by author decision**: a Duty that wants to react to a
cross-machine event subscribes to `realm:beam:X` deliberately, rather than
every local subscriber to `X` silently also firing on remote traffic it
wasn't written to expect. This is a narrower, more conservative choice than
full location-transparency, consistent with §2.2's existing rule that
cross-Duty communication is events-only and explicit.

#### Tier 2 — Reticulum: encrypted comms between different people (inter-owner)

**This is a genuinely different problem from Tier 1, and the current code
does not implement it yet.** The intended design (author's own words):
lossless, encrypted communication *between two separate users*, each of
whom may be running their own internal mesh of machines (which could
itself be a Realm pairing, or something else) — Reticulum is the transport
that bridges one person's mesh to a friend's separate mesh, not a way to
find more of your own machines. Later, planned extensions on the same
channel: socket streaming, and shared workspaces between friends and even
between machines.

**What exists today does not match this yet, and shouldn't be mistaken for
it:** `src/mesh/MeshDiscoveryService.ts` currently implements
single-instance service advertisement/discovery plus a request/response RPC
(`advertise`/`discoverServices`/`executeRemoteService`) over Reticulum's
`announce`/`query` primitives — closer to "find any compatible instance and
call one named service on it" than to "person A's mesh and person B's mesh
now have an encrypted channel between them." It is also not bridged to the
local `api.events` bus at all right now — receiving a service advertisement
only updates an in-memory registry, nothing re-emits as a local event the
way Realm's beams do.

Building the real Tier 2 vision is genuine, undesigned work, not a wiring
task: it needs an actual concept for "my mesh" as one addressable identity
(not one instance), an encrypted person-to-person channel over Reticulum/
LXMF (which already has the right transport properties for this — built
for exactly this kind of encrypted, delay-tolerant, off-grid-capable
messaging), and only later the streaming/shared-workspace features layered
on top. Reticulum plugin/LXMF stays as the right transport choice; the
service-discovery layer on top of it (`src/mesh/`) is very likely the wrong
shape for this and will need real redesign, not just a bridge to the event
bus.

**Keep both tiers, keep them conceptually separate:** Realm answers "get my
own machines talking to each other," which is done. Reticulum/mesh answers
"get my Ronin talking to a friend's Ronin, encrypted," which is the actual
intent but not yet built to that shape — worth a dedicated design pass of
its own rather than folding into this cleanup.

**Known housekeeping, not urgent:** `realm2` (a sibling directory next to
`realm-server`) is a byte-identical duplicate — same three commits, zero
diff — almost certainly an accidental extra clone. Worth deleting whenever
convenient; not blocking anything.

---

## 3. Explicit Non-Goals

- No behavior tree / composite node engine.
- No *internal coordinating Duty* (an internal "MNGR"-style dispatcher that
  assigns work across other Duties) — confirmed correctly absent in the
  real codebase too; an internal coordinator was proposed once and
  explicitly rejected there. Cross-Duty coordination stays event-only.
- No *forced* three-phase Sense/Analyze/Respond shape on every Duty by
  convention — but see 2.9: the SARChain middleware itself (budget, model
  resolution, tracking, logging) is a keep candidate, evaluated on its own.
- `technique` specifically is retired — confirmed dead and removed in the
  real codebase, converted to Skill format. **Kata was also removed** — see
  2.10: the DSL/compiler/registry layer is gone, phase graphs live inline on
  the Contract now. **Contract/Task are not a non-goal** — they're a real,
  actively-developed trigger→phase engine, confirmed load-bearing; keep
  them.
- No separate `Tool` registry/type sitting alongside Plugins — tooling
  comes from Plugins (or MCP) only. **Skills are not part of this
  non-goal** — see 2.8: agentskills.io-style Skills are kept as a distinct,
  first-class concept for CLI-agent instruction sheets, not as tooling.
- No automatic full mirroring of the event bus across paired instances
  (see 2.11) — cross-machine reaction is opt-in per Duty
  (`realm:beam:X` subscription), not implicit.
- Reticulum/mesh is not the vehicle for "get my own machines talking to
  each other" (see 2.11, Tier 1) — that's Realm's job. Reticulum/mesh *is*
  the intended vehicle for "encrypted comms between different people's
  separate Ronin installs" (Tier 2) — a real, wanted feature, just not yet
  built to that shape; the current `src/mesh/` code is a different,
  narrower thing (single-instance service discovery/RPC) and needs a real
  redesign pass, not a quick wire-up, before it matches the intent.

---

## 4. Migration Map (old → new)

| Ronin concept | Status in new spec |
|---|---|
| `Agent` (TS class, pre-refactor) | → **Duty** |
| `Duty` (SAR-enveloped, post-refactor) | → **Duty**; drop the *forced* three-phase ceremony, but keep `packages/sar` (SARChain) as the optional middleware layer behind `run()` — confirmed separable, see 2.9 |
| Sensors (cron/file-watch/webhook triggers) | → **Duty with a schedule and/or event subscription**, no separate class |
| `contracts/` (trigger→phase binding, confirmed real engine) | → **keep** — see 2.10. Not the same as the typed-Schema `contracts/` folder some older docs described; the *typed I/O* meaning should still move to `schema/` eventually (deferred, unrelated), but the *trigger-binding* meaning (Contract→Task, phases inline, Kata removed) is a live, separate thing and stays regardless |
| `plugins/` (Tool Packs) | → **keep as-is** — the only source of tooling, no separate `Tool` registry |
| `skills/` (markdown-defined capabilities) | → **keep as first-class**, aligned to agentskills.io format — compatibility of the `Abilities`/`Run:` mechanism specifically still needs a real check, see 2.8 |
| `techniques/` | → **confirmed dead, already removed** — converted to Skill format, no action needed |
| `task/`, `contracts/` (trigger-binding sense) | → **confirmed real and load-bearing — keep.** See 2.10 for how this relates to Duty. |
| `src/kata/` (DSL/compiler/registry) | → **removed.** See 2.10 — the removal case this section originally left undecided; phase graphs now live inline on the Contract, no separate Kata layer. |
| Event bus (`api.events`) | → **keep as-is**, this is the core primitive |
| HTTP routing (`static webhook` + `onWebhook`) | → **keep as-is**, generalize naming to "route" if desired, but don't rebuild |
| Model router (`ToolRouter`, tier-based) | → keep; backs "direct model call." Confirmed unrelated to "CLI agent spawn," which is its own working mechanism — see 2.3 |
| `mngr-worker.ts` | → keep as-is; it's already correctly documented (`ARCHITECTURE.md` §6.1) as the external-MNGR-product integration, not an internal orchestrator |
| `tool-orchestrator.ts` | → **resolved: not receiving live traffic.** Nothing in the codebase calls its webhook or constructs it outside its own file; the two other references found are naming-collision comments, not callers. Keep as a *code pattern* reference for §2.6 (route registration), not as evidence of an active production path |
| Reticulum plugin (`plugins/reticulum.ts`) | → **keep as the transport for Tier 2 (see 2.11)** — LXMF's encrypted, delay-tolerant, off-grid-capable messaging is the right fit for person-to-person comms between separate Ronin installs |
| `src/mesh/` (`MeshDiscoveryService`) | → **keep the code, but it's the wrong shape for the actual goal** — see 2.11, Tier 2. Currently single-instance service discovery/RPC over Reticulum, not "my mesh talks to your mesh" encrypted messaging. Needs a real design pass (an addressable "my mesh" identity, an encrypted inter-owner channel) before it matches the intent — not a quick bridge to `api.events` |
| **`plugins/realm.ts` + `realm-server`** | → **the actual cross-instance communication primitive** — see 2.11. Call-sign pairing, `beam`/`query` between named instances, already has a live consumer (`duties/voice-messaging.ts`) |
| `src/realms/` (plural — distributed *kata* registry, unrelated to Realm above despite the near-identical name) | → **deleted.** Confirmed zero callers anywhere in the codebase before removal. Not a rename or merge — the functionality (sharing katas across instances) had no real user; local kata management (`src/kata/`) was itself removed later the same day, see 2.10 |
| `duties/tasking.ts` + `src/tasking/executors.ts` (multi-CLI dispatch: claude/opencode/qwen/cursor/gemini, chosen by label/heuristic) | → **keep and reuse** — this is already the "CLI agent spawn" Duty kind (§2.3) working in production; don't rebuild it |
| RouteGuard / QuickTunnel (Cloudflare, fail-closed path whitelist on the HTTP server) | → **keep** — real remote-access security layer already wired into route handling (§2.6), and the actual mechanism behind mobile access (§2.11) |
| `workflows/*.md` (SOP guidance, read-only context injection) | → **resolved: keep as a distinct concept, not redundant with Skill.** Skill = callable (frontmatter + an `Abilities` section mapping to executable scripts). Workflow = pure guidance prose, injected read-only into context, never executed. The two were designed to connect — a Workflow's frontmatter has a `skills:` field meant to name the Skills it recommends — but that field is advisory-only and unenforced today, so in practice they're two unconnected systems rather than one layered one. Worth finishing the wiring, not worth merging the concepts |
| `src/tools/WorkflowEngine.ts` (an older, unrelated third "workflow" concept — tool-step orchestration pipelines, distinct from both Skill and the `workflows/*.md` SOPs above) | → **deleted.** Confirmed fully dead: its 6 example pipelines were never registered anywhere, and `registerWorkflow()` had zero real callers ever, including custom ones. Not a "candidate for cleanup" — already removed |

---

## 5. Open Questions

**Resolved since the original draft:**

1. ~~Is `tool-orchestrator.ts` receiving live traffic?~~ No — confirmed no callers anywhere in the codebase.
2. ~~What actually depends on `techniques/`, `katas/`, `contracts/`?~~ `technique` is dead (removed); `contract`/`task` are a real, load-bearing execution engine and were kept; `kata` was removed too, after a real removal pass — see §2.10.
3. ~~Does the model router need to change to support "direct model call" vs "CLI agent spawn"?~~ No — they're already correctly separate mechanisms; CLI agent spawn never went through the router.
4. ~~Can `packages/sar` be used as an opt-in middleware layer independent of SAR phase naming?~~ Yes — confirmed already separable; nothing in the API requires the three-phase shape.
5. ~~Is `workflows/*.md` redundant with Skill?~~ No — genuinely distinct (callable vs. guidance-only), though the field meant to connect them isn't wired up yet.
6. ~~Kata/Contract/Task — Option A or Option B (§2.10)?~~ Neither — Kata was removed outright (a third path this section hadn't considered), Contract/Task kept with phases inline. See §2.10.

**Still open:**

1. Which existing Duties, if any, already fit the four-kind taxonomy in
   §2.3 cleanly, and which would need to be split into multiple Duties?
   Not audited yet.
2. Does the current `skills/` markdown format actually conform to the
   agentskills.io spec, or is it a bespoke lookalike that needs converting?
   The `Abilities`/`Run:` shell-dispatch mechanism looks like a Ronin-specific
   addition on top of otherwise-plausible frontmatter — needs a real
   side-by-side check against the published spec, not inference from shape.
3. **New:** design Tier 2 (§2.11) for real — what does "my mesh" look like
   as one addressable identity across potentially multiple machines? What's
   the actual encrypted-channel handshake between two people's installs
   over Reticulum/LXMF? This is genuine, undesigned work, not an audit —
   nothing to resolve by reading more code, since the code doesn't do this
   yet.

---

**Bottom line for the coding agent:** this is a simplification target, not
a from-scratch design. Prefer "delete/rename/consolidate" diffs over
"rewrite" diffs wherever the existing code already does the job — the event
bus, HTTP routing, plugin loader, and (per §2.11) the Realm pairing system
are all explicitly called out above as worth keeping and building on, not
rebuilding.
