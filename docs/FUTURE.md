# Future / deferred work

Durable log for items deliberately deferred during simplification passes.
Oldest first.

- **Per-contract `tools:` allowlist for tasker SAR runs** (deferred 2026-10-05
  during the duty chop pass). SAR mode currently passes the full tool
  registry every round; as contract volume grows, add frontmatter
  `tools:` (allowlist of tool names / provider prefixes), plus a `deny:`
  list and a default-deny profile for high-frequency contracts.
