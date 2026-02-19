# AgentSkills in Ronin

Ronin integrates the [AgentSkills](https://agentskills.io) standard: modular, reusable AI workflows stored as folders with instructions and scripts. Skills are discovered on demand (no static registry), composed by the AI, and executed via the skills plugin. The **SkillMaker** agent creates new skills from task failures or explicit requests.

Skills complement plugins: plugins are code extensions; skills are task-focused bundles (skill.md + scripts) that the AI can discover, explore, and run.

## Directory layout

- **User skills**: `~/.ronin/skills/` (config: `system.skillsDir` in config.json; created by `ronin config --init`).
- **Project skills** (optional): `./skills/` in the project root. User directory takes precedence when both exist.

Each skill is a folder:

```
~/.ronin/skills/
└── <skill-name>/           # e.g. log-monitor (lowercase, hyphens)
    ├── skill.md            # Required: YAML frontmatter + Markdown (instructions, abilities)
    ├── scripts/            # Optional: TS/JS run by Bun
    │   └── <ability>.ts
    └── assets/             # Optional: templates, configs
```

## skill.md format

- **YAML frontmatter** (between `---`): `name`, `description` (short, for discovery).
- **Body**: Markdown with:
  - General instructions
  - **## Abilities**: one `### <abilityName>` per ability, with:
    - Short description
    - `Input:` (comma-separated params)
    - `Output:` (type or description)
    - `Run:` e.g. `bun run scripts/countErrors.ts --logPath={logPath}`

Example:

```markdown
---
name: log-monitor
description: Monitors log files for errors, detects spikes, and notifies.
---

# Log Monitor Skill

## When to Use
- Error spikes in logs.
- Detecting specific phrases.

## Abilities
### countErrors
Counts errors in a log file.
- Input: logPath (string)
- Output: errorCount (number)
- Run: bun run scripts/countErrors.ts --logPath={logPath}
```

## Three AI tools

The skills plugin exposes three methods (and LangChain tools) for the AI:

1. **discover_skills(query)**  
   Returns a lite list: `{ name, description }[]` for skills matching the query (keyword match on name/description). Use first to find candidates.

2. **explore_skill(skill_name, include_scripts?)**  
   Returns full details: frontmatter, instructions, parsed abilities (name, input, output, runCommand), optional script contents, and asset names. Use after discovery to plan composition.

3. **use_skill(skill_name, options?)**  
   Runs a skill:
   - **ability** + **params**: run one ability with the given params.
   - **pipeline** + **params**: run abilities in order, passing outputs as inputs to the next.

Execution uses `api.shell` (Bun) and an in-plugin **watchdog** (blocklist of dangerous patterns) before running scripts. On failure, the plugin emits `skill.use.failed`; on success it emits `skill-used`.

## SkillMaker agent

The **SkillMaker** agent (`agents/skill-maker.ts`) only creates skills. It listens for:

- **agent.task.failed** – Uses `failureNotes`, `request`, `description` (and optional `taskId`) to generate a skill that could address the failure, then emits **new-skill** and optionally **retry.task**.
- **create-skill** – Payload `{ request: string }`. Generates a skill from the description and emits **new-skill**.

SkillMaker uses `api.ai.complete` to generate skill.md and script contents, then writes under `~/.ronin/skills/<name>` via `api.files` and `api.files.ensureDir`. It does not manage tasks or run skills.

## Events

- **agent.task.failed** – Emitted by agents/tasking when a task fails. Payload should include `agent`, `taskId`, `error`, `timestamp`, and optionally `failureNotes`, `request`, `description` so SkillMaker can use them.
- **create-skill** – Explicit request to create a skill (`{ request }`).
- **new-skill** – Emitted by SkillMaker after writing a new skill (`{ name, reason, taskId?, path }`).
- **retry.task** – Optional: `{ taskId }` so a tasking agent can re-queue after a new skill is created.
- **skill-used** / **skill.use.failed** – Emitted by the skills plugin for observability.

## CLI

- **ronin skills** – Same as `ronin skills list`.
- **ronin skills list** – List all skills.
- **ronin skills discover "<query>"** – Print matching skills (JSON).
- **ronin skills explore <name> [--scripts]** – Print skill details (JSON).
- **ronin skills use <name> [--ability=...] [--pipeline=a,b,c] [--params='{}']** – Run a skill.
- **ronin skills install <git-repo> [--name <skill-name>]** – Clone into `~/.ronin/skills/<name>` (requires git plugin).
- **ronin skills update <name>** – Pull latest for an installed skill (must be a git repo).
- **ronin skills init** – Run `git init` in `~/.ronin/skills` for versioning.

Create a skill from a description (runs SkillMaker logic in-process):

- **ronin create skill "&lt;description&gt;"**  
  Example: `ronin create skill "monitor my app log and alert on error spikes"`

## LangChain / LangGraph

When the LangChain plugin is loaded, `wrapRoninPluginsAsTools` adds:

- **ronin_skills_discover** – Discover skills by query.
- **ronin_skills_explore** – Get full skill details.
- **ronin_skills_use** – Run a skill (ability or pipeline).

So LangChain agents and LangGraph nodes can discover and use skills without extra wiring.

## Backward compatibility

Skills are additive. No changes to existing plugin or agent contracts. `api.skills` is optional and only present when the skills plugin is loaded.

## Future

- **Realm research tool**: Discover shared skills (e.g. via a registry or realm-server) and install via `ronin skills install`. Deferred until realm-server design is ready.
- **Centralized watchdog**: Validation is currently inside the skills plugin; a shared watchdog service can be added later.
