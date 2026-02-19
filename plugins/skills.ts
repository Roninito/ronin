/**
 * Skills plugin: discover, explore, and use AgentSkills (skill.md + scripts)
 * Requires setAPI(api) to be called by createAPI so methods can access files, shell, config, events.
 */
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import type { Plugin } from "../src/plugins/base.js";
import type { AgentAPI } from "../src/types/api.js";
import type {
  SkillMeta,
  SkillFrontmatter,
  SkillDetail,
  AbilitySpec,
  UseSkillResult,
} from "../src/types/skills.js";

const MAX_DISCOVER = 10;
const DEFAULT_WATCHDOG_BLOCKLIST = [
  /\brm\s+-?rf?\b/,
  /\bmv\s+.*\s+\.\./,
  /\bchmod\s+[0-7]{3,4}\s+/,
  /\bchown\s+/,
  />\s*\/etc\//,
  /\|\s*tee\s+.*\/etc\//,
];

let apiRef: AgentAPI | null = null;

function getSkillsDirs(): string[] {
  if (!apiRef) return [];
  const system = apiRef.config.getSystem();
  const userDir =
    system.skillsDir ?? join(homedir(), ".ronin", "skills");
  const projectDir = join(process.cwd(), "skills");
  const dirs: string[] = [];
  if (existsSync(userDir)) dirs.push(userDir);
  if (existsSync(projectDir) && projectDir !== userDir) dirs.push(projectDir);
  return dirs;
}

function parseFrontmatter(raw: string): SkillFrontmatter {
  const nameMatch = raw.match(/name:\s*(.+)/);
  const descMatch = raw.match(/description:\s*(.+)/);
  return {
    name: (nameMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, ""),
    description: (descMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, ""),
  };
}

function parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const parts = content.split(/\n---\s*\n/);
  if (parts.length < 2) {
    return { frontmatter: { name: "", description: "" }, body: content };
  }
  const frontmatter = parseFrontmatter(parts[0]);
  const body = parts.slice(1).join("\n---\n").trim();
  return { frontmatter, body };
}

function parseAbilities(body: string): AbilitySpec[] {
  const abilities: AbilitySpec[] = [];
  const abSection = body.match(/##\s+Abilities\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!abSection) return abilities;
  const section = abSection[1];
  const headingBlocks = section.split(/\n###\s+/);
  for (let i = 1; i < headingBlocks.length; i++) {
    const block = headingBlocks[i];
    const firstLine = block.indexOf("\n") >= 0 ? block.slice(0, block.indexOf("\n")) : block;
    const name = firstLine.trim();
    const rest = block.slice(firstLine.length).trim();
    const descriptionMatch = rest.match(/^(.+?)(?=\n-|\nRun:|\nInput:|\z)/s);
    const inputMatch = rest.match(/Input:\s*(.+?)(?=\n|$)/);
    const outputMatch = rest.match(/Output:\s*(.+?)(?=\n|$)/);
    const runMatch = rest.match(/Run:\s*(.+?)(?=\n|$)/);
    abilities.push({
      name,
      description: descriptionMatch?.[1]?.trim(),
      input: inputMatch
        ? inputMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      output: outputMatch?.[1]?.trim(),
      runCommand: runMatch?.[1]?.trim(),
    });
  }
  return abilities;
}

function matchesQuery(meta: SkillMeta, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return (
    meta.name.toLowerCase().includes(q) ||
    meta.description.toLowerCase().includes(q)
  );
}

function runWatchdog(scriptContent: string, blocklist: RegExp[]): boolean {
  for (const re of blocklist) {
    if (re.test(scriptContent)) return false;
  }
  return true;
}

async function discover_skills(query: string): Promise<SkillMeta[]> {
  if (!apiRef) throw new Error("Skills plugin: API not set. setAPI(api) must be called first.");
  const results: SkillMeta[] = [];
  const dirs = getSkillsDirs();
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await apiRef.files.list(dir);
    } catch {
      continue;
    }
    const subdirs = entries.filter((p) => {
      const full = join(dir, p.split("/").pop() ?? p);
      return existsSync(full);
    });
    for (const sub of subdirs) {
      const skillDir = join(dir, sub.split("/").pop() ?? sub);
      const skillMdPath = join(skillDir, "skill.md");
      const skillMdPathAlt = join(skillDir, "SKILL.md");
      let path = skillMdPath;
      if (!existsSync(skillMdPath) && existsSync(skillMdPathAlt)) path = skillMdPathAlt;
      if (!existsSync(path)) continue;
      try {
        const content = await apiRef.files.read(path);
        const { frontmatter } = parseSkillMd(content);
        if (!frontmatter.name) continue;
        const meta: SkillMeta = {
          name: frontmatter.name,
          description: frontmatter.description || "",
        };
        if (matchesQuery(meta, query)) results.push(meta);
      } catch {
        // skip unreadable
      }
    }
  }
  return results.slice(0, MAX_DISCOVER);
}

async function explore_skill(
  skill_name: string,
  include_scripts?: boolean
): Promise<SkillDetail> {
  if (!apiRef) throw new Error("Skills plugin: API not set. setAPI(api) must be called first.");
  const dirs = getSkillsDirs();
  const normalized = skill_name.replace(/\s+/g, "-").toLowerCase();
  for (const dir of dirs) {
    const skillDir = join(dir, normalized);
    const skillMdPath = join(skillDir, "skill.md");
    const skillMdPathAlt = join(skillDir, "SKILL.md");
    let path = existsSync(skillMdPath) ? skillMdPath : skillMdPathAlt;
    if (!path || !existsSync(path)) continue;
    const content = await apiRef.files.read(path);
    const { frontmatter, body } = parseSkillMd(content);
    const abilities = parseAbilities(body);
    const assets: string[] = [];
    const scripts: Array<{ file: string; content: string }> = [];
    const scriptsDir = join(skillDir, "scripts");
    const assetsDir = join(skillDir, "assets");
    if (existsSync(scriptsDir)) {
      try {
        const list = await apiRef.files.list(scriptsDir);
        for (const f of list) {
          const name = f.split("/").pop() ?? f;
          if (include_scripts) {
            try {
              const content = await apiRef.files.read(join(scriptsDir, name));
              scripts.push({ file: name, content });
            } catch {
              scripts.push({ file: name, content: "" });
            }
          }
        }
      } catch {
        // ignore
      }
    }
    if (existsSync(assetsDir)) {
      try {
        const list = await apiRef.files.list(assetsDir);
        assets.push(...list.map((p) => p.split("/").pop() ?? p));
      } catch {
        // ignore
      }
    }
    return {
      frontmatter,
      instructions: body,
      abilities,
      scripts: include_scripts ? scripts : undefined,
      assets,
    };
  }
  throw new Error(`Skill not found: ${skill_name}`);
}

function buildScriptArgs(
  runCommand: string | undefined,
  params: Record<string, unknown>
): string[] {
  if (!runCommand) return [];
  const args: string[] = [];
  const placeholders = runCommand.match(/\{(\w+)\}/g);
  if (placeholders) {
    for (const ph of placeholders) {
      const key = ph.slice(1, -1);
      const v = params[key];
      if (v !== undefined && v !== null) args.push(`--${key}=${String(v)}`);
    }
  }
  return args;
}

async function runAbility(
  skillDir: string,
  ability: AbilitySpec,
  params: Record<string, unknown>,
  blocklist: RegExp[]
): Promise<{ output: unknown; log: string }> {
  if (!apiRef?.shell) throw new Error("Shell plugin required to run skills.");
  const runCommand = ability.runCommand;
  let scriptPath = "";
  if (runCommand) {
    const bunMatch = runCommand.match(/bun\s+run\s+(\S+)/);
    if (bunMatch) scriptPath = join(skillDir, bunMatch[1]);
    else scriptPath = join(skillDir, "scripts", `${ability.name}.ts`);
  } else {
    scriptPath = join(skillDir, "scripts", `${ability.name}.ts`);
  }
  if (!existsSync(scriptPath)) {
    const alt = join(skillDir, "scripts", `${ability.name}.js`);
    if (existsSync(alt)) scriptPath = alt;
  }
  if (!existsSync(scriptPath)) {
    return { output: null, log: `Script not found: ${scriptPath}` };
  }
  let scriptContent = "";
  try {
    scriptContent = await apiRef.files.read(scriptPath);
  } catch {
    return { output: null, log: `Could not read script: ${scriptPath}` };
  }
  if (!runWatchdog(scriptContent, blocklist)) {
    return { output: null, log: "Watchdog blocked script (forbidden pattern)" };
  }
  const args = buildScriptArgs(ability.runCommand, params);
  const result = await apiRef.shell.exec("bun", ["run", scriptPath, ...args], {
    cwd: skillDir,
  });
  const log = result.stdout + (result.stderr ? "\n" + result.stderr : "");
  let output: unknown = null;
  if (result.stdout.trim()) {
    try {
      output = JSON.parse(result.stdout.trim());
    } catch {
      output = result.stdout.trim();
    }
  }
  if (!result.success) {
    throw new Error(log || "Script failed");
  }
  return { output, log };
}

async function use_skill(
  skill_name: string,
  options?: {
    ability?: string;
    params?: Record<string, unknown>;
    pipeline?: string[];
  }
): Promise<UseSkillResult> {
  if (!apiRef) throw new Error("Skills plugin: API not set. setAPI(api) must be called first.");
  const detail = await explore_skill(skill_name, false);
  const dirs = getSkillsDirs();
  const normalized = skill_name.replace(/\s+/g, "-").toLowerCase();
  let skillDir = "";
  for (const dir of dirs) {
    const d = join(dir, normalized);
    if (existsSync(join(d, "skill.md")) || existsSync(join(d, "SKILL.md"))) {
      skillDir = d;
      break;
    }
  }
  if (!skillDir) {
    return { success: false, error: `Skill directory not found: ${skill_name}` };
  }
  const blocklist = DEFAULT_WATCHDOG_BLOCKLIST;
  const logs: string[] = [];
  let lastOutput: unknown = undefined;
  const params = { ...(options?.params ?? {}) };
  try {
    if (options?.pipeline?.length) {
      for (const abilityName of options.pipeline) {
        const ability = detail.abilities.find(
          (a) => a.name.toLowerCase() === abilityName.toLowerCase()
        );
        if (!ability) {
          return {
            success: false,
            logs,
            error: `Ability not found: ${abilityName}`,
          };
        }
        const { output, log } = await runAbility(
          skillDir,
          ability,
          params,
          blocklist
        );
        logs.push(log);
        lastOutput = output;
        if (output && typeof output === "object" && !Array.isArray(output)) {
          Object.assign(params, output as Record<string, unknown>);
        }
      }
    } else if (options?.ability) {
      const ability = detail.abilities.find(
        (a) => a.name.toLowerCase() === options.ability!.toLowerCase()
      );
      if (!ability) {
        return {
          success: false,
          logs,
          error: `Ability not found: ${options.ability}`,
        };
      }
      const { output, log } = await runAbility(
        skillDir,
        ability,
        params,
        blocklist
      );
      logs.push(log);
      lastOutput = output;
    } else {
      return {
        success: false,
        error: "Must specify ability or pipeline",
      };
    }
    if (apiRef.events) {
      (apiRef.events as { emit(event: string, data: unknown, source: string): void }).emit(
        "skill-used",
        { skill_name, ability: options?.ability, pipeline: options?.pipeline },
        "skills"
      );
    }
    return { success: true, output: lastOutput, logs };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (apiRef.events) {
      (apiRef.events as { emit(event: string, data: unknown, source: string): void }).emit(
        "skill.use.failed",
        { skill_name, error: errorMessage },
        "skills"
      );
    }
    return {
      success: false,
      logs,
      error: errorMessage,
    };
  }
}

function setAPI(api: AgentAPI): void {
  apiRef = api;
}

const skillsPlugin: Plugin = {
  name: "skills",
  description: "Discover, explore, and use AgentSkills (skill.md + scripts). Use discover_skills(query), explore_skill(skill_name, include_scripts?), use_skill(skill_name, { ability?, params?, pipeline? }).",
  methods: {
    setAPI,
    discover_skills,
    explore_skill,
    use_skill,
  },
};

export default skillsPlugin;
