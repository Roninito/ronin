/**
 * Skills CLI: list, discover, explore, use, install, update, init
 * and create skill (delegates to SkillMaker or emit).
 */
import { createAPI } from "../../api/index.js";
import { getDefaultSkillsDir } from "./config.js";
import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

export interface SkillsCLIOptions {
  agentDir?: string;
  pluginDir?: string;
  userPluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
}

function getSkillsDirFromApi(api: { config: { getSystem(): { skillsDir?: string } } }): string {
  const system = api.config.getSystem();
  return system.skillsDir ?? getDefaultSkillsDir();
}

function getSkillRoots(): string[] {
  const userDir = getDefaultSkillsDir();
  const projectDir = join(process.cwd(), "skills");
  const roots: string[] = [];
  if (existsSync(userDir)) roots.push(userDir);
  if (existsSync(projectDir) && projectDir !== userDir) roots.push(projectDir);
  return roots;
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const parts = content.split(/\n---\s*\n/);
  const frontmatter = parts.length > 1 ? parts[0] : "";
  const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
  const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
  return { name, description };
}

async function readSkillFile(skillDir: string): Promise<{ path: string; content: string } | null> {
  const lower = join(skillDir, "skill.md");
  const upper = join(skillDir, "SKILL.md");
  const target = existsSync(lower) ? lower : (existsSync(upper) ? upper : null);
  if (!target) return null;
  try {
    return { path: target, content: await readFile(target, "utf-8") };
  } catch {
    return null;
  }
}

async function discoverLocalSkills(query: string): Promise<Array<{ name: string; description: string }>> {
  const roots = getSkillRoots();
  const q = query.trim().toLowerCase();
  const out: Array<{ name: string; description: string }> = [];

  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillDir = join(root, entry);
      const skillFile = await readSkillFile(skillDir);
      if (!skillFile) continue;
      const meta = parseFrontmatter(skillFile.content);
      const name = meta.name || entry;
      const description = meta.description || "";
      if (!q || name.toLowerCase().includes(q) || description.toLowerCase().includes(q)) {
        out.push({ name, description });
      }
    }
  }

  return out;
}

async function exploreLocalSkill(
  skillName: string,
  includeScripts: boolean
): Promise<{
  frontmatter: { name: string; description: string };
  instructions: string;
  abilities: Array<{ name: string; description?: string }>;
  scripts?: Array<{ file: string; content: string }>;
  assets: string[];
}> {
  const normalized = skillName.replace(/\s+/g, "-").toLowerCase();
  const roots = getSkillRoots();

  for (const root of roots) {
    const skillDir = join(root, normalized);
    const skillFile = await readSkillFile(skillDir);
    if (!skillFile) continue;

    const parts = skillFile.content.split(/\n---\s*\n/);
    const instructions = parts.length > 1 ? parts.slice(1).join("\n---\n").trim() : skillFile.content;
    const frontmatter = parseFrontmatter(skillFile.content);

    const abilities = Array.from(instructions.matchAll(/\n###\s+(.+)\n/g)).map((m) => ({
      name: m[1].trim(),
    }));

    const scripts: Array<{ file: string; content: string }> = [];
    const scriptsDir = join(skillDir, "scripts");
    if (existsSync(scriptsDir)) {
      let files: string[] = [];
      try {
        files = await readdir(scriptsDir);
      } catch {
        files = [];
      }
      if (includeScripts) {
        for (const file of files) {
          try {
            const content = await readFile(join(scriptsDir, file), "utf-8");
            scripts.push({ file, content });
          } catch {
            scripts.push({ file, content: "" });
          }
        }
      }
    }

    const assetsDir = join(skillDir, "assets");
    let assets: string[] = [];
    if (existsSync(assetsDir)) {
      try {
        assets = await readdir(assetsDir);
      } catch {
        assets = [];
      }
    }

    return {
      frontmatter,
      instructions,
      abilities,
      scripts: includeScripts ? scripts : undefined,
      assets,
    };
  }

  throw new Error(`Skill not found: ${skillName}`);
}

export async function skillsCommand(
  subcommand: string,
  subArgs: string[],
  options: SkillsCLIOptions = {}
): Promise<void> {
  switch (subcommand) {
    case "list": {
      const all = await discoverLocalSkills("");
      if (all.length === 0) {
        console.log("No skills found. Add skills to ~/.ronin/skills/ or ./skills/");
        return;
      }
      console.log(`\n📁 Skills (${all.length}):\n`);
      for (const s of all) {
        console.log(`  ${s.name}`);
        console.log(`    ${s.description || "(no description)"}\n`);
      }
      return;
    }

    case "discover": {
      const query = subArgs.join(" ").trim() || "*";
      const normalizedQuery = query === "*" ? "" : query;
      const list = await discoverLocalSkills(normalizedQuery);
      console.log(JSON.stringify(list, null, 2));
      return;
    }

    case "explore": {
      const name = subArgs[0];
      if (!name) {
        console.error("❌ Usage: ronin skills explore <skill-name>");
        process.exit(1);
      }
      const includeScripts = subArgs.includes("--scripts");
      const detail = await exploreLocalSkill(name, includeScripts);
      console.log(JSON.stringify(detail, null, 2));
      return;
    }

    case "use": {
      const api = await createAPI({
        pluginDir: options.pluginDir,
        userPluginDir: options.userPluginDir,
        ollamaUrl: options.ollamaUrl,
        ollamaModel: options.ollamaModel,
        dbPath: options.dbPath,
      });
      const skillName = subArgs[0];
      if (!skillName) {
        console.error("❌ Usage: ronin skills use <skill-name> [--ability=...] [--pipeline=a,b,c] [--params='{}']");
        process.exit(1);
      }
      if (!api.skills) {
        console.error("❌ Skills plugin not loaded.");
        process.exit(1);
      }
      const ability = subArgs.find((a) => a.startsWith("--ability="))?.slice("--ability=".length);
      const pipelineStr = subArgs.find((a) => a.startsWith("--pipeline="))?.slice("--pipeline=".length);
      const paramsStr = subArgs.find((a) => a.startsWith("--params="))?.slice("--params=".length);
      const pipeline = pipelineStr ? pipelineStr.split(",").map((s) => s.trim()) : undefined;
      let params: Record<string, unknown> = {};
      if (paramsStr) {
        try {
          params = JSON.parse(paramsStr);
        } catch {
          console.error("❌ --params must be valid JSON");
          process.exit(1);
        }
      }
      const result = await api.skills.use_skill(skillName, {
        ability,
        pipeline,
        params,
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) process.exit(1);
      return;
    }

    case "install": {
      const api = await createAPI({
        pluginDir: options.pluginDir,
        userPluginDir: options.userPluginDir,
        ollamaUrl: options.ollamaUrl,
        ollamaModel: options.ollamaModel,
        dbPath: options.dbPath,
      });
      const skillsDir = getSkillsDirFromApi(api);
      const repo = subArgs[0];
      if (!repo || repo.startsWith("--")) {
        console.error("❌ Usage: ronin skills install <git-repo> [--name <skill-name>]");
        process.exit(1);
      }
      const nameOpt = subArgs.find((a) => a.startsWith("--name="))?.slice("--name=".length)
        ?? subArgs[subArgs.indexOf("--name") + 1];
      const skillName = nameOpt ?? repo.replace(/\.git$/, "").split("/").pop() ?? "skill";
      const targetDir = join(skillsDir, skillName);
      if (existsSync(targetDir)) {
        console.error(`❌ Directory already exists: ${targetDir}`);
        process.exit(1);
      }
      if (!api.git) {
        console.error("❌ Git plugin not loaded. Install the git plugin to use skills install.");
        process.exit(1);
      }
      const result = await api.git.clone(repo, targetDir);
      if (!result.success) {
        console.error("❌ Clone failed:", result.output);
        process.exit(1);
      }
      console.log(`✅ Installed skill "${skillName}" at ${targetDir}`);
      return;
    }

    case "update": {
      const api = await createAPI({
        pluginDir: options.pluginDir,
        userPluginDir: options.userPluginDir,
        ollamaUrl: options.ollamaUrl,
        ollamaModel: options.ollamaModel,
        dbPath: options.dbPath,
      });
      const skillsDir = getSkillsDirFromApi(api);
      const name = subArgs[0];
      if (!name) {
        console.error("❌ Usage: ronin skills update <skill-name>");
        process.exit(1);
      }
      const skillPath = join(skillsDir, name);
      if (!existsSync(join(skillPath, ".git"))) {
        console.error(`❌ Not a git repo: ${skillPath}`);
        process.exit(1);
      }
      if (!api.git) {
        console.error("❌ Git plugin not loaded.");
        process.exit(1);
      }
      const cwd = process.cwd();
      process.chdir(skillPath);
      try {
        const result = await api.git.pull();
        if (!result.success) {
          console.error("❌ Pull failed:", result.output);
          process.exit(1);
        }
        console.log(`✅ Updated skill "${name}"`);
      } finally {
        process.chdir(cwd);
      }
      return;
    }

    case "init": {
      const api = await createAPI({
        pluginDir: options.pluginDir,
        userPluginDir: options.userPluginDir,
        ollamaUrl: options.ollamaUrl,
        ollamaModel: options.ollamaModel,
        dbPath: options.dbPath,
      });
      const skillsDir = getSkillsDirFromApi(api);
      if (!existsSync(join(skillsDir, ".git"))) {
        if (!api.git) {
          console.error("❌ Git plugin not loaded.");
          process.exit(1);
        }
        const cwd = process.cwd();
        process.chdir(skillsDir);
        try {
          await api.git.init();
          console.log(`✅ Git initialized in ${skillsDir}`);
        } finally {
          process.chdir(cwd);
        }
      } else {
        console.log("Already a git repo:", skillsDir);
      }
      return;
    }

    default:
      console.error(`❌ Unknown skills command: ${subcommand}`);
      console.log("Available: list, discover, explore, use, install, update, init");
      process.exit(1);
  }
}

export async function createSkillCommand(
  description: string,
  options: SkillsCLIOptions = {}
): Promise<void> {
  const api = await createAPI({
    pluginDir: options.pluginDir,
    userPluginDir: options.userPluginDir,
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
  });
  const SkillMakerClass = (await import("../../../agents/skill-maker.js")).default;
  const agent = new SkillMakerClass(api);
  await agent.createSkillFromRequest(description);
}
