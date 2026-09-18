/**
 * Contract phase-block DSL grammar description, fed to the AI model drafting
 * new contracts (src/contract/propose.ts). Adapted from the old
 * src/kata/dsl-grammar.ts (2026-09-17) — a contract now declares its own
 * phases inline instead of pointing at a separately-authored Kata, so there's
 * no `kata <name> vN` header and no `requires` declarations (skill existence
 * is checked directly against the real skill list, not against a declared
 * list — see propose.ts's validateSkillReferences).
 */
export const CONTRACT_PHASE_GRAMMAR = `Contract phases-block grammar:
  initial <phase-name>

  phase <phase-name>
    run skill <skill-name> [ability <ability-name>]
    next <phase-name>

  phase <last-phase>
    run skill <skill-name> [ability <ability-name>]
    complete

Worked example — this is a SYNTAX TEMPLATE ONLY, not a real contract. It exists purely
to show correct grammar (the "initial" line, unquoted phase names, phase chaining).
Copy the STRUCTURE, not the literal names, and never skip the "initial" line:

  initial step-one

  phase step-one
    run skill some-skill-a ability its-ability
    next step-two

  phase step-two
    run skill some-skill-b ability its-ability
    complete

A phase can also wait for an event instead of running a skill — use this only when the
intent genuinely needs to pause for something external (e.g. a human approval):

  phase wait-for-approval
    wait event some.approval.event [timeout <milliseconds>]
    next step-two

Rules:
- Skill names must be one of the names in the "Available skills" list given below —
  never invent a skill or a py./ts. prefix; use the bare name exactly as listed
  (e.g. "discord", not "ts.discord").
- The "initial <phase-name>" line is REQUIRED and must appear once, before the first
  "phase" block — a contract missing it will fail to parse. <phase-name> is a bare word
  (no quotes), and must match the name used in the "phase <phase-name>" line it points to.
- The optional "ability <ability-name>" clause after "run skill <skill-name>" picks which
  of the skill's declared abilities to run. It can be omitted when the skill has exactly
  one ability — it will be auto-resolved. Skills with multiple abilities require it.
  The ability MUST be one actually listed for that exact skill in "Available skills" below
  — never call an ability that belongs to a different skill (e.g. a "summarize" ability
  only exists on the "summarize" skill, not on "discord" or any other skill).
- If the intent has multiple distinct steps (e.g. "read X, then summarize it, then send it
  to Y"), draft one phase per step, each running the ONE skill suited to that specific
  step, chained in order with "next" — do not collapse multiple steps into one phase or
  skip a step.
- "next <phase-name>" takes a bare phase name too, never quoted.
- Every phase must either: next <phase>, complete, or fail
- At least 2 phases for non-trivial intents`;
