/**
 * Skills CLI: list, discover, explore, use, install, update, init
 * and create skill (delegates to SkillMaker or emit).
 */
import { createAPI } from "../../api/index.js";
import { getDefaultSkillsDir } from "./config.js";
import { existsSync } from "fs";
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

export async function skillsCommand(
  subcommand: string,
  subArgs: string[],
  options: SkillsCLIOptions = {}
): Promise<void> {
  const api = await createAPI({
    pluginDir: options.pluginDir,
    userPluginDir: options.userPluginDir,
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
  });

  const skillsDir = getSkillsDirFromApi(api);

  switch (subcommand) {
    case "list": {
      if (!api.skills) {
        console.error("❌ Skills plugin not loaded.");
        process.exit(1);
      }
      const all = await api.skills.discover_skills("");
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
      if (!api.skills) {
        console.error("❌ Skills plugin not loaded.");
        process.exit(1);
      }
      const query = subArgs.join(" ").trim() || "*";
      const list = await api.skills.discover_skills(query);
      console.log(JSON.stringify(list, null, 2));
      return;
    }

    case "explore": {
      const name = subArgs[0];
      if (!name) {
        console.error("❌ Usage: ronin skills explore <skill-name>");
        process.exit(1);
      }
      if (!api.skills) {
        console.error("❌ Skills plugin not loaded.");
        process.exit(1);
      }
      const includeScripts = subArgs.includes("--scripts");
      const detail = await api.skills.explore_skill(name, includeScripts);
      console.log(JSON.stringify(detail, null, 2));
      return;
    }

    case "use": {
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
