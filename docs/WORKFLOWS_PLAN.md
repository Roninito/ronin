# Workflows — Design Plan

> **Status:** Implemented. The durable user-facing guide is now
> `docs/WORKFLOWS.md` — read that first for day-to-day use. This plan is kept
> here as the design record (including the one deliberate deviation from the
> original sketch: workflows are pulled into context, never "run" — see §4)
> and can move to `docs/history/` in a future cleanup pass.

## 1. Problem

Ronin has three first-class capability concepts — **Tool**, **Skill**,
**Duty** — plus an engine-internal, compiled automation layer — **Contract →
Kata → Task** (see `ARCHITECTURE.md` §2, §5). None of these is a good fit for
"here's how we do this kind of work": a loosely structured, human-owned
description of a repeatable piece of work — its purpose, the standard it
should meet, and the rough steps — that gets refined by hand or through
conversation as the work itself evolves. Kata is the closest analog but is
the wrong shape on purpose: it's a validated, compiled phase-graph with no
tolerance for free text, meant for unattended deterministic execution, not
for capturing "how we approach the app-launch marketing push."

**Workflow** fills that gap: a plain markdown file, freely hand-edited, that
Duties consult as *guidance* — never compiled, never executed on its own.

## 2. Where it sits in the model

Not a fourth capability concept. Added to `ARCHITECTURE.md` §2's "Supporting
structure" table:

| Concept | Definition |
|---------|------------|
| **Workflow** | A markdown file describing a category of work: purpose, standards/expectations, and steps. Discoverable like a Skill, but not callable — it only ever contributes read-only guidance text into a running SAR chain's context. Hand-edited; never compiled or validated. |

Relationship to Kata: a Workflow is the human-in-the-loop draft stage; a Kata
is what you get once a workflow's steps are stable and deterministic enough
to automate unattended. That graduation path (`kata propose --from-workflow`)
is noted for the future and explicitly **out of scope** for this build.

## 3. Storage & file format

- **Location:** `workflows/` at the project root — project-level only (peer
  of `duties/`, `skills/`, `katas/`, `contracts/`). No user-level
  `~/.ronin/workflows/` split for v1.
- **One file per workflow**, kebab-case filename matching frontmatter `name`,
  e.g. `workflows/market-solution.md`.
- **Format:** light YAML frontmatter + free markdown body. Frontmatter is
  metadata for discovery only — never parsed as instructions:

```markdown
---
name: market-solution
description: Launch-and-report loop for marketing a shipped app across social + email.
tags: [marketing, social, reporting]
status: draft   # draft | active | deprecated
skills: [twitter, agent-browser, email-manager]   # advisory only, not enforced
---

# Market Solution Workflow

## Purpose
What "done" looks like and why this workflow exists.

## When to use
Trigger conditions — when a Duty (or the user) should reach for this.

## Standards & expectations
Quality bar, tone, required approvals, things to always/never do.

## Steps
1. Post the announcement to Twitter (twitter skill).
2. Screenshot the resulting post (agent-browser skill).
3. Reuse the screenshot on the secondary site/post.
4. Publish the secondary post.
5. Compile all screenshots + links into a report and email it (email-manager).

## Notes
Freeform — gotchas, links to past runs, changelog of adjustments.
```

- **No compiler, no registration step.** A hand edit can never "break" a
  workflow the way a bad edit breaks a `.kata` file — worst case, discovery
  just won't match it well or a section reads oddly.

## 4. Discovery & context-injection (the execution model)

Confirmed with user: **workflows are never run.** They're pulled into
whatever SAR chain is already executing, as guidance — the same discovery
shape as `discover_skills(query)` (`docs/SKILLS.md`: keyword match on
name/description), but with no equivalent of `use_skill` — there is nothing
to invoke.

- New middleware, `createWorkflowContextMiddleware`, added to the SAR
  envelope stack in `DutyRegistry.executeDuty()` (`ARCHITECTURE.md` §3),
  alongside `createModelResolutionMiddleware` / `createTokenGuardMiddleware`.
  Applies to **every** duty execution uniformly — no per-duty opt-in.
- Each run, it derives a query from the current context (duty name/persona,
  the triggering contract/kata's description, or — for chat — the live user
  message), keyword-matches it against `workflows/*.md` frontmatter
  (`name`, `description`, `tags`), and on a confident match injects that
  workflow's body into the chain context as a clearly-labeled
  operator-guidance block, before Analyze runs.
- No match → no-op. Zero overhead, zero behavior change for runs with no
  relevant workflow.
- Matching is simple keyword matching for v1, consistent with how skill
  discovery already works — no embeddings/semantic search, no extra model
  call to decide relevance.

This means a scheduled morning-briefing contract, a chat conversation, or any
future Duty all get workflow guidance "for free" the moment a matching file
exists in `workflows/` — nothing else has to be wired to know Workflows
exist.

## 5. Ownership: new `workflow-manager` duty

Mirrors `contract-executor.ts`'s role for contracts: one duty owns the
domain's storage, routes, and tool surface.

`duties/workflow-manager.ts` owns:
- Reading/writing `workflows/*.md` (with filename sanitization — no path
  traversal outside `workflows/`).
- `discoverWorkflow(query)` / `loadWorkflow(name)` — used by the SAR
  middleware (§4) and exposed as a tool for other duties.
- The staged-proposal flow for AI-authored workflows (§6).
- The `/workflows` route and its API (§7).

The keyword-matching/frontmatter-parsing logic itself lives in a shared
`src/workflow/` module (not inside the duty) so the middleware can import it
directly without going through the duty/event layer — same reasoning as
`src/contract/` being separate from `contract-executor.ts`.

## 6. AI-authored creation (chat-driven, unattended path)

For workflows an AI drafts **on its own initiative** mid-conversation or from
a duty run (not the user sitting at the `/workflows` page — see §7 for that,
different trust model):

- New model-callable tool `workflows.propose`, usable by `chatty` and other
  duties, invoked when a conversation reveals a repeatable process worth
  formalizing.
- Drafts frontmatter + body, stages it via a `WorkflowProposalStorage`
  (mirrors `ContractProposalStorage` in `src/contract/`) — **not** written to
  `workflows/` yet.
- Chat surfaces an inline "Save as workflow?" card, mirroring
  `injectContractProposalCardIntoResponse` in `duties/chatty.ts`. Approve →
  moves the file into `workflows/`. Refuse/edit → discarded or opened for
  editing.
- This is the same staged-approval safety pattern Ronin already uses for
  kata/contract, applied here even though a markdown file carries no
  execution risk — consistency with existing UX, and it gives the user a
  chance to fix names/wording before it starts influencing other runs via §4.

## 7. CLI

```
ronin workflow list                  List all workflows (name, status, tags)
ronin workflow show <name>           Print a workflow's contents
ronin workflow new <name>            Scaffold a blank workflow and open it
ronin workflow edit <name>           Open in $EDITOR
ronin workflow propose "<desc>"      AI-drafts a workflow from plain language, stages it (§6)
```

## 8. Web route: `/workflows`

New requirement from this session. A page — analogous to `/contracts` and
`/todo` — for listing, viewing, and editing workflows directly, plus a
lower-friction, human-present editing loop that's distinct from the §6
staged-approval flow.

### 8.1 Page layout

- **List pane:** all workflows from `workflows/`, showing name, description,
  status badge, tags. "+ New Workflow" action.
- **Viewer/editor pane:** selecting a workflow shows its rendered markdown
  with an "Edit" toggle to a raw textarea editor + Save button. Saving here
  writes directly to `workflows/<name>.md` — **no approval gate**, because
  this is the user directly and knowingly editing, not an unattended duty
  proposing a change. This is the key trust distinction from §6.
- **Discussion prompt:** an embedded chat panel scoped to the selected
  workflow (or to "new workflow" mode when nothing is selected). The user
  discusses what the workflow should say; the AI proposes draft text; an
  "Insert into editor" action drops the draft into the editor pane without
  auto-saving — the user still hits Save to persist. Reuses the same
  `api.ai` chat-completion plumbing `chatty.ts` already uses for `/chat`,
  just scoped with the selected workflow's current content as context
  instead of general Ronin context.

### 8.2 API surface (owned by `workflow-manager`, following `contract-executor`'s pattern)

```
GET    /workflows                    HTML page (list + viewer/editor + prompt)
GET    /api/workflows                List: [{ name, description, status, tags }]
GET    /api/workflows/:name          Raw markdown content
POST   /api/workflows/:name          Create or overwrite (full text body) — direct save, no approval
DELETE /api/workflows/:name          Delete
POST   /api/workflows/:name/chat     One discussion turn: { message } -> { reply, draft? }
```

The unattended §6 propose/approve endpoints stay separate
(`/api/workflows/proposals`, `/approve`, `/refuse`) since they serve a
different trust model (AI-initiated, needs a gate) than the page's direct-save
editing (user-initiated, no gate needed).

### 8.3 UI conventions

Build with the existing shared theme utilities (`getHeaderBarCSS`,
`getHeaderHomeIconHTML`, `dramTheme`, `getSharedUIPrimitivesCSS`,
`getAdobeCleanFontFaceCSS` from `src/utils/theme.js`) and `escapeHtml`
patterns already used in `duties/contract-executor.ts`, for visual
consistency with `/contracts` and `/todo`.

## 9. Future / explicitly out of scope for this build

- User-level `~/.ronin/workflows/` split.
- Semantic/embedding-based workflow matching (keyword matching only, for now).
- `ronin workflow run <name>` standalone executor — rejected per §4, workflows
  are context, not something that runs.
- `kata propose --from-workflow` graduation path — worth doing later, not now.

## 10. Implementation checklist

- [x] `workflows/` directory + example files: `market-solution.md` (the
      launch/screenshot/report example from this discussion) and
      `morning-briefing.md`.
- [x] `src/workflow/` — frontmatter parser, `discoverWorkflow(query)`,
      `loadWorkflow(name)`, `listWorkflows()`.
- [x] `src/middleware/workflowContext.ts` — `createWorkflowContextMiddleware`,
      wired into both `executeDuty()` definitions in `DutyRegistry.ts` (see
      the duplicate-method note in `ARCHITECTURE.md` §3). Also wired
      directly into `duties/chatty.ts`'s live `/chat` message assembly,
      since that path is route-driven and bypasses the envelope entirely —
      see §4 note below and `ARCHITECTURE.md` §3's "Known gap".
- [x] `src/workflow/proposal-storage.ts` — `WorkflowProposalStorage` (mirrors
      `ContractProposalStorage`), backed by a new `workflow_proposals` table
      in `src/database/migrations.ts`.
- [x] `duties/workflow-manager.ts` — owns storage, routes, `/workflows` page,
      proposal flow, and the `workflows.propose` / `workflows.list` /
      `workflows.get` tool surface.
- [x] `injectWorkflowProposalCardIntoResponse` in `src/utils/prompt.ts`,
      wired into `duties/chatty.ts` (both the response pipeline and the
      chat UI's card rendering — generalized to handle both
      `contract-proposal` and `workflow-proposal` fences).
- [x] `src/cli/commands/workflow.ts` + registration in `src/cli/index.ts`
      (including a `ronin create workflow "<description>"` alias).
- [x] Docs: `docs/WORKFLOWS.md` (user guide), plus updates to
      `ARCHITECTURE.md` §2 (table), §3 (middleware stack + known-gap note),
      §9 (target tree), §11 (CLI commands), and `README.md`.
- [x] Verification: compiled `src/workflow/` standalone and exercised
      `listWorkflows`/`loadWorkflow`/`discoverWorkflow` against the real
      `market-solution.md`/`morning-briefing.md` files (including the
      morning-briefing example from this discussion, path-traversal
      rejection in `sanitizeWorkflowName`, and frontmatter round-tripping);
      syntax- and behavior-checked the chat UI's proposal-card JS in
      isolation. Full in-app run (`bun run ronin start`, live `/workflows`
      page, live chat) was not exercised — no Bun runtime available in this
      environment; do that before relying on this in production.

### Note: deviation from the original execution-model sketch

§4 as originally drafted (before user clarification) proposed workflows as
purely a SAR-envelope concern. The user clarified mid-build: workflows
should be pulled into whatever context is already being built, not "run" —
closer to "less than a skill" (discoverable, never callable). That's what's
implemented. It surfaced a real, pre-existing gap: `DutyRegistry`'s
runner-applied envelope doesn't thread its context into most duties'
`execute()` calls, and live chat bypasses the envelope entirely. Rather than
silently ship a middleware that looked correct but did nothing for the
primary interactive surface (chat), workflow discovery is also called
directly inside `duties/chatty.ts`. See `ARCHITECTURE.md` §3 for the full
explanation — worth a dedicated cleanup pass later, out of scope here.
