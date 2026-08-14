/**
 * Kata DSL grammar description, shared between `kata propose` and
 * `contract propose` (which can draft a one-phase kata inline). Kept as a
 * single source of truth so the two AI-authoring prompts never drift apart.
 */
export const KATA_DSL_GRAMMAR = `Kata DSL grammar:
  kata <name> v<N>
    requires skill <skill-name>
    ...
    initial <phase-name>

    phase <phase-name>
      run skill <skill-name> [ability <ability-name>]
      next <phase-name>

    phase <last-phase>
      run skill <skill-name> [ability <ability-name>]
      complete

Worked example — this is a SYNTAX TEMPLATE ONLY, not a real registered kata. It exists
purely to show correct grammar (the "initial" line, unquoted phase names, phase
chaining). Never set existingKataName to "example.placeholder-kata" or any name that
merely resembles this shape — copy the STRUCTURE, not the literal name, and never skip
the "initial" line:

  kata example.placeholder-kata v1
    requires skill some-skill-a
    requires skill some-skill-b

    initial step-one

    phase step-one
      run skill some-skill-a ability its-ability
      next step-two

    phase step-two
      run skill some-skill-b ability its-ability
      complete

Rules:
- Name format: domain.action (e.g. system.log.monitor, finance.audit, data.pipeline)
- Skill names must be one of the names in the "Available skills" list given below —
  never invent a skill or a py./ts. prefix; use the bare name exactly as listed
  (e.g. "discord", not "ts.discord").
- The "initial <phase-name>" line is REQUIRED and must appear once, right after the
  "requires" lines and before the first "phase" block — a kata missing it will fail
  to parse. <phase-name> is a bare word (no quotes), and must match the name used in
  the "phase <phase-name>" line it points to.
- The optional "ability <ability-name>" clause after "run skill <skill-name>" picks which
  of the skill's declared abilities to run. It can be omitted when the skill has exactly
  one ability — it will be auto-resolved. Skills with multiple abilities require it.
  The ability MUST be one actually listed for that exact skill in "Available skills" below
  — never call an ability that belongs to a different skill (e.g. a "summarize" ability
  only exists on the "summarize" skill, not on "discord" or any other skill).
- Every skill named in ANY "run skill <skill-name>" line, in every phase, must ALSO have
  its own "requires skill <skill-name>" line — missing even one fails compilation.
- If the intent has multiple distinct steps (e.g. "read X, then summarize it, then send it
  to Y"), draft one phase per step, each running the ONE skill suited to that specific
  step, chained in order with "next" — do not collapse multiple steps into one phase or
  skip a step.
- "next <phase-name>" takes a bare phase name too, never quoted.
- Every phase must either: next <phase>, complete, or fail
- At least 2 phases for non-trivial intents`;
