# docs/history/ — archive, never authoritative

Everything in this directory is a point-in-time record: planning docs, phase
summaries, and superseded drafts. **If anything here disagrees with
`../../ARCHITECTURE.md`, the root document wins** — that's the whole reason
this directory exists (see `../../ARCHITECTURE.md` §12).

## Architecture planning docs (moved from the Desktop, August 2026)

These four were previously kept only on a contributor's Desktop — outside
git, outside version control — which is exactly why they drifted out of sync
with the real repo and started contradicting it. They're archived here now
specifically so that can't happen again at this location.

- `ARCHITECTURE_CHANGES_PLAN.md` — executed (Agent→Duty rename, provider
  consolidation, SAR envelope). See `../../ARCHITECTURE.md` §13.
- `ARCHITECTURE_REMOVALS_PLAN.md` — R0/R1/R3 executed, R2 (optional schema
  cleanup) not confirmed done. Its central conclusion — keep kata/task/contract,
  they're the engine — is now the canonical framing in `../../ARCHITECTURE.md` §5,
  not just a historical curiosity.
- `CLI_CLEANUP_PLAN.md` — mostly executed (technique CLI removed).
- `REFACTOR_SUMMARY.md` — commit-by-commit record of the `refactor/duty-architecture` branch.
- `DESKTOP_ARCHITECTURE_DRAFT.md` — a *third*, independent `ARCHITECTURE.md`
  that lived only on the Desktop while two other copies existed in the repo,
  none in sync. Its ideas were folded into the real `../../ARCHITECTURE.md`
  with corrections (notably: it recommended dropping kata entirely — reversed
  in the canonical doc).

## Visual/HTML docs (moved from the Desktop, August 2026)

`architecture.html`, `ronin-capabilities.html`, `ronin-duties.html`,
`sar-coder-guide.html` — snapshots from June–August 2026. **Not verified
against current state as part of this cleanup** (unlike the .md files above,
these weren't rewritten) — treat as illustrative history, not a live
reference. If any diagram in these is still worth having as a maintained,
current doc, that's a separate follow-up content pass.

## Everything else

Phase summaries, model-selection implementation notes, database migration
records, and similar — archived as-is, each already scoped to a specific
past change rather than claiming to describe current state.
