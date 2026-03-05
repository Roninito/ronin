---
name: Self Assess
description: Runs Ronin doctor checks in the Bun shell to self-assess runtime health.
---

# Self Assess

Runs Ronin's built-in diagnostics and returns the result.

## When to Use

- Quick health check of current Ronin setup
- Validate plugin/config/runtime status before debugging

## Abilities

### doctor
Run Ronin diagnostics in the Bun shell.
- Input: none
- Output: { success, exitCode, stdout, stderr }
- Run: bun run scripts/run.ts
