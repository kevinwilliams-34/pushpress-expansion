/**
 * Prompt loader — loads the skill prompt from local SKILL.md (primary)
 * or from the Make Data Store (fallback when MAKE_DATASTORE_ID is set).
 */

import fs from 'fs';
import path from 'path';

let cachedPrompt: string | null = null;

/**
 * Load the skill prompt. Uses local SKILL.md by default.
 * Strips YAML frontmatter before returning.
 */
export function loadSkillPrompt(): string {
  if (cachedPrompt) return cachedPrompt;

  const skillPath = process.env.SKILL_PATH || path.join(process.cwd(), 'skill', 'SKILL.md');

  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill file not found at ${skillPath}. Run from the project root or set SKILL_PATH.`);
  }

  const raw = fs.readFileSync(skillPath, 'utf-8');
  cachedPrompt = stripFrontmatter(raw);
  return cachedPrompt;
}

/**
 * Strip YAML frontmatter (--- ... ---) from markdown.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) return content;

  return content.slice(endIndex + 3).trimStart();
}

/**
 * Invalidate the cached prompt (call after skill edit/deploy).
 */
export function invalidatePromptCache(): void {
  cachedPrompt = null;
}

/**
 * Load the PushPress patterns reference file.
 */
export function loadPatterns(): string {
  const patternsPath = path.join(process.cwd(), 'skill', 'pushpress-patterns.md');
  if (!fs.existsSync(patternsPath)) return '';
  return fs.readFileSync(patternsPath, 'utf-8');
}
