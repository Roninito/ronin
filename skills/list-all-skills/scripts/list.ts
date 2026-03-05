/**
 * List all skills with meta (_meta.json) and full description (skill.md/SKILL.md).
 * Outputs JSON: { skills: Array<{ slug, meta, name, description, fullDescription }> }
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface SkillMetaFile {
  slug?: string;
  version?: string;
  ownerId?: string;
  publishedAt?: number | null;
}

interface SkillEntry {
  slug: string;
  meta: SkillMetaFile;
  name: string;
  description: string;
  fullDescription: string;
}

function getSkillRoots(): string[] {
  const roots: string[] = [];
  // Current skills root (parent of this skill's dir when run with cwd = skill dir)
  const siblingRoot = join(process.cwd(), "..");
  if (existsSync(siblingRoot)) roots.push(siblingRoot);
  const userSkills = join(homedir(), ".ronin", "skills");
  if (existsSync(userSkills) && !roots.includes(userSkills)) roots.push(userSkills);
  return roots;
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return { name: "", description: "" };
  const block = match[1];
  const nameMatch = block.match(/name:\s*(.+)/);
  const descMatch = block.match(/description:\s*(.+)/);
  return {
    name: (nameMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, ""),
    description: (descMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, ""),
  };
}

function main(): void {
  const skills: SkillEntry[] = [];
  const seenSlugs = new Set<string>();

  for (const root of getSkillRoots()) {
    let entries: string[];
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }

    for (const name of entries) {
      const skillDir = join(root, name);
      const skillMd = join(skillDir, "skill.md");
      const skillMdAlt = join(skillDir, "SKILL.md");
      const pathMd = existsSync(skillMd) ? skillMd : existsSync(skillMdAlt) ? skillMdAlt : null;
      if (!pathMd) continue;

      const slug = name;
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      let meta: SkillMetaFile = {};
      const metaPath = join(skillDir, "_meta.json");
      if (existsSync(metaPath)) {
        try {
          meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SkillMetaFile;
          if (!meta.slug) meta.slug = slug;
        } catch {
          meta = { slug };
        }
      } else {
        meta = { slug };
      }

      let fullDescription = "";
      let nameStr = "";
      let descriptionStr = "";
      try {
        fullDescription = readFileSync(pathMd, "utf-8");
        const { name: n, description: d } = parseFrontmatter(fullDescription);
        nameStr = n || slug;
        descriptionStr = d || "";
      } catch {
        nameStr = slug;
      }

      skills.push({
        slug,
        meta: {
          slug: meta.slug,
          version: meta.version,
          ownerId: meta.ownerId,
          publishedAt: meta.publishedAt,
        },
        name: nameStr,
        description: descriptionStr,
        fullDescription,
      });
    }
  }

  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  console.log(JSON.stringify({ skills }));
}

main();
