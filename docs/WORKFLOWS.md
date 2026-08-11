# Workflows in Ronin

A **Workflow** is a markdown file describing a category of work: its
purpose, the standard it should meet, and its rough steps. It is guidance a
Duty consults, not code — there is no compiler, no registration step, and no
"run" command. You can always hand-edit a workflow file directly; nothing
will break.

See `ARCHITECTURE.md` §2 for where Workflow sits relative to Ronin's three
capability concepts (Tool, Skill, Duty) and the Kata/Contract/Task engine.
In short: a Workflow is the human-in-the-loop draft of "how we do this"; a
Kata is what you get once that process is stable enough to compile into
unattended, deterministic automation. They're independent — you don't need
one to have the other.

## Directory layout

```
workflows/
└── <name>.md   # e.g. market-solution.md — kebab-case, matches frontmatter `name`
```

Project-level only (`workflows/` at the repo root, alongside `duties/`,
`skills/`, `katas/`, `contracts/`) — no user-level `~/.ronin/workflows/`
split.

## File format

```markdown
---
name: market-solution
description: One sentence description, used for discovery.
tags: [marketing, social, reporting]
status: draft   # draft | active | deprecated
skills: [twitter, agent-browser, email-manager]   # advisory only, never enforced
---

# Market Solution Workflow

## Purpose
What "done" looks like and why this workflow exists.

## When to use
Trigger conditions — when a Duty or the user should reach for this.

## Standards & expectations
Quality bar, tone, required approvals, things to always/never do.

## Steps
1. Post the announcement to Twitter (twitter skill).
2. Screenshot the resulting post (agent-browser skill).
3. ...

## Notes
Freeform — gotchas, links to past runs, changelog of adjustments.
```

The `## Purpose` / `## When to use` / `## Standards & expectations` /
`## Steps` / `## Notes` sections are a convention, not a requirement — the
body is never parsed structurally, only the frontmatter is. Write whatever
actually helps.

## How Workflows get used: context injection, never execution

Workflows are never run. Instead, whatever Duty is currently doing work
looks for a relevant workflow and, if one matches, gets its body folded
into its context as guidance before it acts:

- **Live chat** (`duties/chatty.ts`): each message is keyword-matched
  against `workflows/*.md` (`discoverWorkflow()` in
  `src/workflow/discovery.ts`) before the system prompt is built. A match
  gets prepended as an extra context section — e.g. asking Ronin to "kick
  off the market-solution workflow for the new release" pulls in
  `market-solution.md`'s full guidance automatically.
- **Any Duty run through the SAR envelope** (`DutyRegistry.executeDuty()`):
  `createWorkflowContextMiddleware` (`src/middleware/workflowContext.ts`)
  runs the same discovery against the duty's name/description (and any live
  user message), matching the shape of `createArtifactInjectMiddleware`.
  Note: this envelope's context isn't consumed by every duty's `execute()`
  today — see the caveat in `ARCHITECTURE.md` §3. It fires uniformly and
  costs nothing when there's no relevant workflow; duties that do consume
  their own chain context (a few use `this.use()`/`this.createChain()`)
  benefit from it directly.

Matching is simple keyword overlap on the workflow's `name`, `description`,
and `tags` (same shape as `discover_skills(query)` in `docs/SKILLS.md`) — no
embeddings, no extra model call. A confident name mention always wins; tag
and description overlap are weaker, secondary signals. No match is common
and expected — most conversations and duty runs won't touch a workflow at
all.

## Creating and editing a workflow

**By hand:** just create/edit `workflows/<name>.md`. No registration step.

**Via CLI:**

```
ronin workflow list                        List all workflows
ronin workflow show <name>                  Print a workflow's contents
ronin workflow new <name>                   Scaffold a blank workflow, opens in $EDITOR
ronin workflow edit <name>                  Open an existing workflow in $EDITOR
ronin workflow propose "<description>"      AI-drafts one, y/n confirm, writes to workflows/
ronin create workflow "<description>"       Alias for `workflow propose`
```

**Via chat:** ask Ronin to formalize something you're discussing (e.g. "can
you save this as a workflow?"). Chatty may call the `workflows.propose`
tool, which drafts the file and stages it as a pending proposal — it is
never written to `workflows/` directly. The chat UI renders an Allow/Refuse
card; only Allow writes the file. This mirrors how AI-drafted Kata/Contract
proposals are staged (`docs/KATA_AUTHORING.md`, `src/contract/propose.ts`).

**Via the `/workflows` page:** a list of all workflows, a viewer/editor for
the selected one (Edit toggle switches from rendered preview to a raw
textarea; Save writes directly — no approval gate, since this is you
editing knowingly, not an unattended AI proposal), and a "Discuss" panel
where you can talk through a workflow (existing or brand new) with Ronin.
When it has concrete content to propose, an "Insert into editor" button
drops the draft into the editor pane — it never auto-saves; you still hit
Save when you're happy with it.

## Tool surface (for other Duties / the AI)

- `workflows.propose` — draft from plain English, stages a pending proposal (§ Creating, "Via chat").
- `workflows.list` — list all workflows (name, description, tags, status).
- `workflows.get` — full body of a named workflow.

All three are registered by `duties/workflow-manager.ts`, which also owns
`workflows/` read/write/delete, the proposal approve/refuse endpoints, and
the `/workflows` page.

## A note on naming

Ronin already had an unrelated, older concept also called "workflow" —
`WorkflowDefinition` / `WorkflowEngine` in `src/tools/types.ts` /
`src/tools/WorkflowEngine.ts`, an in-memory, multi-step tool-orchestration
pipeline used by `duties/tool-orchestrator.ts`. It predates this feature,
isn't part of the canonical model in `ARCHITECTURE.md` §2, and is unrelated
to the markdown SOPs described here. The two aren't wired together; a
future cleanup could rename or retire the older one (similar to how
`technique` was retired — `ARCHITECTURE.md` §4) but that's out of scope for
this feature.
