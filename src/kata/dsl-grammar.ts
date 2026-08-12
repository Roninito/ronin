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

Rules:
- Name format: domain.action (e.g. system.log.monitor, finance.audit, data.pipeline)
- Skill names use prefix convention:
    py.<name>   = Python-based skill (data processing, ML, scripts, system calls)
    ts.<name>   = TypeScript-based skill (API calls, file ops, web scraping, automation)
  Use the prefix that best matches the work each phase does.
- The optional "ability <ability-name>" clause after "run skill <skill-name>" picks which
  of the skill's declared abilities to run. It can be omitted when the skill has exactly
  one ability — it will be auto-resolved. Skills with multiple abilities require it.
- Every phase must either: next <phase>, complete, or fail
- The initial phase must be defined
- At least 2 phases for non-trivial intents`;
