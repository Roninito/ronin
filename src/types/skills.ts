/**
 * Types for AgentSkills integration (discover, explore, use)
 */

/** Lite metadata returned by discover_skills */
export interface SkillMeta {
  name: string;
  description: string;
}

/** YAML frontmatter from skill.md */
export interface SkillFrontmatter {
  name: string;
  description: string;
}

/** Parsed ability from ## Abilities sections */
export interface AbilitySpec {
  name: string;
  description?: string;
  input: string[];
  output?: string;
  runCommand?: string;
}

/** Full skill details from explore_skill */
export interface SkillDetail {
  frontmatter: SkillFrontmatter;
  instructions: string;
  abilities: AbilitySpec[];
  scripts?: Array<{ file: string; content: string }>;
  assets: string[];
}

/** Result of use_skill execution */
export interface UseSkillResult {
  success: boolean;
  output?: unknown;
  logs?: string[];
  error?: string;
}

/** Optional blocklist/allowlist for script validation (watchdog) */
export interface SkillWatchdogRules {
  blocklist?: RegExp[];
  allowlist?: RegExp[];
}

/** Skill with parsed abilities, e.g. from list_skills_with_abilities */
export interface SkillWithAbilities {
  name: string;
  description: string;
  abilities: { name: string; description?: string; input: string[] }[];
}
