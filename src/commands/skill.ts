/**
 * skill command — manage the scoring prompt.
 * show, deploy (sync to Make Data Store), history.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { diffLines } from 'diff';
import { loadSkillPrompt } from '../core/prompt';
import { insertSkillVersion, listSkillVersions, getSignalByConversationId } from '../db/schema';

const MAKE_API_BASE = 'https://us2.make.com/api/v2';

// ─── show ──────────────────────────────────────────────────────────────────

export function runSkillShow(): void {
  const skillPath = process.env.SKILL_PATH ?? './skill/SKILL.md';
  const absPath = path.resolve(skillPath);

  if (!fs.existsSync(absPath)) {
    console.error(chalk.red(`\n  SKILL.md not found at ${absPath}\n`));
    process.exit(1);
  }

  const stat = fs.statSync(absPath);
  const raw = fs.readFileSync(absPath, 'utf-8');
  const lines = raw.split('\n');
  const preview = lines.slice(0, 30).join('\n');

  console.log(chalk.bold('\n  Skill — Current Version\n'));
  console.log(chalk.dim(`  Path:     ${absPath}`));
  console.log(chalk.dim(`  Modified: ${stat.mtime.toLocaleString()}`));
  console.log(chalk.dim(`  Lines:    ${lines.length}`));
  console.log('');
  console.log(chalk.dim('  ── Preview (first 30 lines) ──────────────────'));
  console.log(preview);
  if (lines.length > 30) {
    console.log(chalk.dim(`  ... ${lines.length - 30} more lines`));
  }
  console.log('');
}

// ─── history ───────────────────────────────────────────────────────────────

export function runSkillHistory(): void {
  const versions = listSkillVersions();

  if (versions.length === 0) {
    console.log(chalk.dim('\n  No skill versions deployed yet. Run `skill deploy` first.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Skill Version History (${versions.length})\n`));

  for (const v of versions) {
    const syncBadge = v.make_datastore_synced
      ? chalk.green('✓ synced')
      : chalk.yellow('⚠ not synced');
    console.log(
      `  ${chalk.bold(v.version)}  ${chalk.dim(new Date(v.deployed_at).toLocaleString())}  ${syncBadge}`
    );
    if (v.deployed_by) console.log(chalk.dim(`     by: ${v.deployed_by}`));
    if (v.notes) console.log(chalk.dim(`     ${v.notes}`));
    console.log('');
  }
}

// ─── deploy ────────────────────────────────────────────────────────────────

export interface SkillDeployOptions {
  version?: string;
  notes?: string;
  dryRun?: boolean;
}

export async function runSkillDeploy(options: SkillDeployOptions = {}): Promise<void> {
  const datastoreId = parseInt(process.env.MAKE_DATASTORE_ID ?? '84644', 10);
  const datastoreKey = process.env.MAKE_DATASTORE_KEY ?? 'upsell-skill-v1';
  const makeToken = process.env.MAKE_API_TOKEN;
  const versionTag = options.version ?? `upsell-skill-v${Date.now()}`;
  const deployedBy = process.env.USER ?? 'cli';

  let prompt: string;
  try {
    prompt = loadSkillPrompt();
  } catch (err) {
    console.error(chalk.red(`\n  Failed to load skill: ${(err as Error).message}\n`));
    process.exit(1);
  }

  console.log(chalk.bold('\n  Skill Deploy\n'));
  console.log(chalk.dim(`  Version:    ${versionTag}`));
  console.log(chalk.dim(`  Data Store: ${datastoreId} / key: ${datastoreKey}`));
  console.log(chalk.dim(`  Prompt:     ${prompt.length} chars, ${prompt.split('\n').length} lines`));
  if (options.dryRun) {
    console.log(chalk.cyan('\n  [DRY RUN] — not writing to Make or DB\n'));
    return;
  }

  // Push to Make Data Store
  let makeSynced = false;
  if (!makeToken) {
    console.log(chalk.yellow('\n  ⚠  MAKE_API_TOKEN not set — skipping Make Data Store sync.'));
    console.log(chalk.dim('     Set MAKE_API_TOKEN in .env to enable sync.\n'));
  } else {
    try {
      const url = `${MAKE_API_BASE}/data-store-records`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${makeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataStoreId: datastoreId,
          key: datastoreKey,
          data: { prompt },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      makeSynced = true;
      console.log(chalk.green('\n  ✅ Make Data Store updated successfully.'));
    } catch (err) {
      console.error(chalk.red(`\n  ❌ Make sync failed: ${(err as Error).message}`));
      console.log(chalk.dim('     Version logged locally only.\n'));
    }
  }

  // Record version in SQLite
  insertSkillVersion({
    id: uuidv4(),
    version: versionTag,
    prompt,
    deployed_at: new Date().toISOString(),
    deployed_by: deployedBy,
    make_datastore_synced: makeSynced,
    notes: options.notes ?? '',
  });

  console.log(chalk.green(`\n  ✅ Version "${versionTag}" recorded locally.`));
  console.log(chalk.dim(`     Run \`skill history\` to see all versions.\n`));
}

// ─── edit ──────────────────────────────────────────────────────────────────

export function runSkillEdit(): void {
  const skillPath = process.env.SKILL_PATH ?? './skill/SKILL.md';
  const absPath = path.resolve(skillPath);

  if (!fs.existsSync(absPath)) {
    console.error(chalk.red(`\n  SKILL.md not found at ${absPath}\n`));
    process.exit(1);
  }

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  console.log(chalk.dim(`\n  Opening ${absPath} in ${editor}...\n`));
  try {
    execSync(`${editor} "${absPath}"`, { stdio: 'inherit' });
    console.log(chalk.green('\n  ✅ Done editing. Run `skill deploy` to push changes.\n'));
  } catch {
    console.error(chalk.red('\n  ❌ Editor exited with an error.\n'));
    process.exit(1);
  }
}

// ─── rollback ──────────────────────────────────────────────────────────────

export interface SkillRollbackOptions {
  version: string;
  dryRun?: boolean;
}

export function runSkillRollback(options: SkillRollbackOptions): void {
  const versions = listSkillVersions();
  const target = versions.find(v => v.version === options.version || v.id.startsWith(options.version));

  if (!target) {
    console.error(chalk.red(`\n  Version not found: "${options.version}"\n`));
    console.log(chalk.dim('  Run `skill history` to see available versions.'));
    process.exit(1);
  }

  const skillPath = process.env.SKILL_PATH ?? './skill/SKILL.md';
  const absPath = path.resolve(skillPath);

  console.log(chalk.bold('\n  Skill Rollback\n'));
  console.log(chalk.dim(`  Restoring version: ${target.version}`));
  console.log(chalk.dim(`  Deployed:          ${new Date(target.deployed_at).toLocaleString()}`));
  console.log(chalk.dim(`  Prompt:            ${target.prompt.length} chars`));

  if (options.dryRun) {
    console.log(chalk.cyan('\n  [DRY RUN] — not writing to disk\n'));
    return;
  }

  // Back up current SKILL.md if it exists
  if (fs.existsSync(absPath)) {
    const backup = absPath + '.bak';
    fs.copyFileSync(absPath, backup);
    console.log(chalk.dim(`\n  Backed up current SKILL.md → ${backup}`));
  }

  fs.writeFileSync(absPath, target.prompt, 'utf-8');
  console.log(chalk.green(`\n  ✅ Rolled back to "${target.version}"`));
  console.log(chalk.dim('     Run `skill deploy` to push this version to Make.\n'));
}

// ─── test ──────────────────────────────────────────────────────────────────

export interface SkillTestOptions {
  fixture?: string;
  dryRun?: boolean;
}

export async function runSkillTest(options: SkillTestOptions = {}): Promise<void> {
  const fixturesDir = path.resolve('./tests/fixtures');
  const scorerUrl = process.env.MAKE_SCORER_WEBHOOK_URL;

  if (!scorerUrl) {
    console.error(chalk.red('\n  MAKE_SCORER_WEBHOOK_URL not set in .env\n'));
    process.exit(1);
  }

  if (!fs.existsSync(fixturesDir)) {
    console.error(chalk.red(`\n  Fixtures directory not found: ${fixturesDir}\n`));
    process.exit(1);
  }

  // Find fixture files
  const allFixtures = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'));
  const fixtures = options.fixture
    ? allFixtures.filter(f => f.includes(options.fixture!))
    : allFixtures;

  if (fixtures.length === 0) {
    console.log(chalk.dim(`\n  No fixtures found${options.fixture ? ` matching "${options.fixture}"` : ''}.\n`));
    return;
  }

  console.log(chalk.bold(`\n  Skill Test — ${fixtures.length} fixture(s)\n`));

  let passed = 0;
  let failed = 0;

  for (const fixtureName of fixtures) {
    const fixturePath = path.join(fixturesDir, fixtureName);
    let fixture: Record<string, unknown>;
    try {
      fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    } catch (err) {
      console.log(chalk.red(`  ✗ ${fixtureName}: failed to parse JSON`));
      failed++;
      continue;
    }

    const expected = fixture['expected'] as { result?: string; product?: string } | undefined;
    const input = fixture['input'] as Record<string, string> | undefined;

    if (!input) {
      console.log(chalk.yellow(`  ⚠ ${fixtureName}: missing "input" field — skipping`));
      continue;
    }

    if (options.dryRun) {
      console.log(chalk.dim(`  [DRY RUN] ${fixtureName} — expected ${JSON.stringify(expected)}`));
      continue;
    }

    try {
      const res = await fetch(scorerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const raw = await res.text();

      // Simple check: does the response contain the expected result?
      const resultMatch = expected?.result
        ? raw.toUpperCase().includes(expected.result.toUpperCase())
        : true;
      const productMatch = expected?.product
        ? raw.toUpperCase().includes(expected.product.toUpperCase())
        : true;

      if (resultMatch && productMatch) {
        console.log(chalk.green(`  ✓ ${fixtureName}`));
        if (expected) console.log(chalk.dim(`    Expected: ${JSON.stringify(expected)} — found in response`));
        passed++;
      } else {
        console.log(chalk.red(`  ✗ ${fixtureName}`));
        console.log(chalk.dim(`    Expected: ${JSON.stringify(expected)}`));
        console.log(chalk.dim(`    Response: ${raw.slice(0, 200)}`));
        failed++;
      }
    } catch (err) {
      console.log(chalk.red(`  ✗ ${fixtureName}: ${(err as Error).message}`));
      failed++;
    }
  }

  console.log('');
  console.log(`  Results: ${chalk.green(`${passed} passed`)}  ${failed > 0 ? chalk.red(`${failed} failed`) : chalk.dim('0 failed')}`);
  console.log('');
  if (failed > 0) process.exit(1);
}

// ─── diff ──────────────────────────────────────────────────────────────────

export function runSkillDiff(v1: string, v2: string): void {
  const versions = listSkillVersions();

  const findVersion = (tag: string) =>
    versions.find(v => v.version === tag || v.id.startsWith(tag));

  const left = (tag: string) => {
    if (tag === 'current') {
      const skillPath = path.resolve(process.env.SKILL_PATH ?? './skill/SKILL.md');
      if (!fs.existsSync(skillPath)) {
        console.error(chalk.red(`\n  SKILL.md not found at ${skillPath}\n`));
        process.exit(1);
      }
      return { version: 'current (SKILL.md)', prompt: fs.readFileSync(skillPath, 'utf-8') };
    }
    return findVersion(tag);
  };

  const aVer = left(v1);
  const bVer = left(v2);

  if (!aVer) { console.error(chalk.red(`\n  Version not found: "${v1}"\n`)); process.exit(1); }
  if (!bVer) { console.error(chalk.red(`\n  Version not found: "${v2}"\n`)); process.exit(1); }

  console.log(chalk.bold(`\n  Diff: ${aVer.version} → ${bVer.version}\n`));

  const changes = diffLines(aVer.prompt, bVer.prompt);
  let hasChanges = false;

  for (const part of changes) {
    if (part.added) {
      hasChanges = true;
      const lines = part.value.split('\n').filter(Boolean);
      for (const l of lines) console.log(chalk.green('+ ' + l));
    } else if (part.removed) {
      hasChanges = true;
      const lines = part.value.split('\n').filter(Boolean);
      for (const l of lines) console.log(chalk.red('- ' + l));
    } else {
      // context — show first and last 2 lines
      const lines = part.value.split('\n').filter(Boolean);
      if (lines.length <= 4) {
        for (const l of lines) console.log(chalk.dim('  ' + l));
      } else {
        for (const l of lines.slice(0, 2)) console.log(chalk.dim('  ' + l));
        console.log(chalk.dim(`  ... ${lines.length - 4} lines unchanged ...`));
        for (const l of lines.slice(-2)) console.log(chalk.dim('  ' + l));
      }
    }
  }

  if (!hasChanges) {
    console.log(chalk.dim('  No differences found.\n'));
  } else {
    console.log('');
  }
}
