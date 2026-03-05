import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectSkillsDir = join(process.cwd(), "skills");
if (!existsSync(projectSkillsDir)) {
  console.error("❌ ./skills not found. Run this check from the repo root.");
  process.exit(1);
}

const output = execSync("bun run ronin skills list", { encoding: "utf8" });
const required = ["Self Assess", "Agent Browser", "notion-assistant"];
const missing = required.filter((name) => !output.includes(name));

if (missing.length > 0) {
  console.error(`❌ Local skills not detected: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("✅ Local ./skills detection check passed.");
