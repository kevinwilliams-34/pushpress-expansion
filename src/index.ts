#!/usr/bin/env node
/**
 * pushpress-expansion — PushPress Expansion Intelligence CLI
 */

import 'dotenv/config';
import { Command } from 'commander';
import { runScan } from './commands/scan';
import { runServe } from './commands/serve';
import { runReportSummary, runReportRecent, runReportBreakdown, runReportAccuracy, runReportConversions, runReportExport } from './commands/report';
import { runReviewList, runReviewConfirm, runReviewReject, runReviewConvert } from './commands/review';
import { runSkillShow, runSkillHistory, runSkillDeploy, runSkillEdit, runSkillRollback, runSkillTest, runSkillDiff } from './commands/skill';

const program = new Command();

program
  .name('pushpress-expansion')
  .description('PushPress Expansion Intelligence — upsell signal detection from Intercom')
  .version('1.0.0');

// ─── scan ──────────────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Pull and score Intercom conversations for upsell signals')
  .option('--since <window>', 'Time window to scan (e.g. 24h, 7d)', '24h')
  .option('--from <date>', 'Start date (ISO format, e.g. 2026-03-01)')
  .option('--to <date>', 'End date (ISO format)')
  .option('--conversation-id <id>', 'Score a single specific conversation')
  .option('--dry-run', 'Score but do not write to Slack or DB', false)
  .option('--output <mode>', 'Output mode: slack | json | table', 'slack')
  .option('--min-confidence <level>', 'Minimum confidence to report: high | medium | low', 'low')
  .action(async (opts) => {
    await runScan({
      since: opts.from ? undefined : opts.since,
      from: opts.from,
      to: opts.to,
      conversationId: opts.conversationId,
      dryRun: opts.dryRun,
      output: opts.output,
      minConfidence: opts.minConfidence,
      trigger: 'manual',
    });
  });

// ─── serve ─────────────────────────────────────────────────────────────────

program
  .command('serve')
  .description('Start HTTP webhook server for Make to call')
  .option('--port <n>', 'Port to listen on', '3000')
  .option('--token <secret>', 'Webhook auth secret (also reads WEBHOOK_SECRET env var)')
  .action((opts) => {
    runServe({
      port: parseInt(opts.port, 10),
      token: opts.token,
    });
  });

// ─── report ────────────────────────────────────────────────────────────────

const reportCmd = program
  .command('report')
  .description('Signal analytics and performance tracking');

reportCmd
  .command('summary')
  .description('Summary stats (signals, accuracy, conversions)')
  .option('--since <window>', 'Time window (e.g. 30d, 7d)')
  .action((opts) => {
    runReportSummary({ since: opts.since });
  });

reportCmd
  .command('recent')
  .description('List recent signals')
  .option('--since <window>', 'Time window (e.g. 7d)')
  .option('--limit <n>', 'Max results', '20')
  .option('--result <level>', 'Filter by result: HIGH | MEDIUM | LOW')
  .action((opts) => {
    runReportRecent({
      since: opts.since,
      limit: parseInt(opts.limit, 10),
      result: opts.result,
    });
  });

reportCmd
  .command('breakdown')
  .description('Signal breakdown by product or trigger')
  .option('--since <window>', 'Time window (e.g. 30d)')
  .option('--by <dimension>', 'Breakdown by: product | trigger', 'product')
  .action((opts) => {
    runReportBreakdown({ since: opts.since, by: opts.by });
  });

reportCmd
  .command('accuracy')
  .description('Precision over time (feedback loop stats)')
  .option('--since <window>', 'Time window (e.g. 30d)')
  .option('--by <unit>', 'Group by: day | week', 'day')
  .action((opts) => {
    runReportAccuracy({ since: opts.since, by: opts.by });
  });

reportCmd
  .command('conversions')
  .description('Conversion funnel from detected → confirmed → deal')
  .option('--since <window>', 'Time window (e.g. 30d)')
  .action((opts) => {
    runReportConversions({ since: opts.since });
  });

reportCmd
  .command('export')
  .description('Export signals to CSV or JSON')
  .option('--since <window>', 'Time window (e.g. 90d)')
  .option('--format <fmt>', 'Output format: csv | json', 'csv')
  .option('--output <file>', 'Write to file instead of stdout')
  .action((opts) => {
    runReportExport({ since: opts.since, format: opts.format, output: opts.output });
  });

// ─── review ────────────────────────────────────────────────────────────────

const reviewCmd = program
  .command('review')
  .description('Manage the feedback loop (false positives, confirmed upsells)');

reviewCmd
  .command('list')
  .description('List signals by status')
  .option('--status <s>', 'Filter by status: pending | confirmed | false_positive | converted', 'pending')
  .option('--since <window>', 'Time window (e.g. 7d)')
  .option('--confidence <level>', 'Filter by confidence: high | medium | low')
  .option('--limit <n>', 'Max results', '50')
  .action((opts) => {
    runReviewList({
      status: opts.status,
      since: opts.since,
      confidence: opts.confidence,
      limit: parseInt(opts.limit, 10),
    });
  });

reviewCmd
  .command('confirm <signal-id>')
  .description('Mark a signal as a genuine upsell')
  .option('--notes <text>', 'Optional notes')
  .action((signalId, opts) => {
    runReviewConfirm({ signalId, reason: opts.notes });
  });

reviewCmd
  .command('reject <signal-id>')
  .description('Mark a signal as a false positive')
  .option('--reason <text>', 'Reason for rejection (improves signal library)')
  .action((signalId, opts) => {
    runReviewReject({ signalId, reason: opts.reason });
  });

reviewCmd
  .command('convert <signal-id>')
  .description('Mark a signal as converted to a deal')
  .option('--notes <text>', 'Optional notes')
  .action((signalId, opts) => {
    runReviewConvert({ signalId, reason: opts.notes });
  });

// ─── skill ─────────────────────────────────────────────────────────────────

const skillCmd = program
  .command('skill')
  .description('Manage the scoring prompt (SKILL.md → Make Data Store)');

skillCmd
  .command('show')
  .description('Show current skill content and metadata')
  .action(() => {
    runSkillShow();
  });

skillCmd
  .command('history')
  .description('List deployed skill versions')
  .action(() => {
    runSkillHistory();
  });

skillCmd
  .command('deploy')
  .description('Deploy SKILL.md to Make Data Store and record version')
  .option('--version <tag>', 'Version tag (e.g. upsell-skill-v2)')
  .option('--notes <text>', 'Notes for this version')
  .option('--dry-run', 'Preview without writing', false)
  .action(async (opts) => {
    await runSkillDeploy({
      version: opts.version,
      notes: opts.notes,
      dryRun: opts.dryRun,
    });
  });

skillCmd
  .command('edit')
  .description('Open SKILL.md in your $EDITOR')
  .action(() => {
    runSkillEdit();
  });

skillCmd
  .command('rollback <version>')
  .description('Restore a previously deployed skill version')
  .option('--dry-run', 'Preview without writing to disk', false)
  .action((version, opts) => {
    runSkillRollback({ version, dryRun: opts.dryRun });
  });

skillCmd
  .command('test')
  .description('Run skill against test fixtures in tests/fixtures/')
  .option('--fixture <name>', 'Only run fixtures matching this name pattern')
  .option('--dry-run', 'Show fixtures without calling scorer', false)
  .action(async (opts) => {
    await runSkillTest({ fixture: opts.fixture, dryRun: opts.dryRun });
  });

skillCmd
  .command('diff <v1> <v2>')
  .description('Diff two skill versions (use "current" for SKILL.md on disk)')
  .action((v1, v2) => {
    runSkillDiff(v1, v2);
  });

// ─── Default help ──────────────────────────────────────────────────────────

program.addHelpText('after', `
Examples:
  $ pushpress-expansion scan --dry-run
  $ pushpress-expansion scan --since 7d --min-confidence high
  $ pushpress-expansion scan --conversation-id 215473558621936
  $ pushpress-expansion serve --port 3000
  $ pushpress-expansion report summary --since 30d
  $ pushpress-expansion report recent --result HIGH
  $ pushpress-expansion report breakdown --by product
  $ pushpress-expansion report accuracy --since 30d --by week
  $ pushpress-expansion report conversions --since 90d
  $ pushpress-expansion report export --format csv --output signals.csv
  $ pushpress-expansion review list --status pending
  $ pushpress-expansion review confirm abc12345
  $ pushpress-expansion review reject abc12345 --reason "already owns Grow"
  $ pushpress-expansion review convert abc12345
  $ pushpress-expansion skill show
  $ pushpress-expansion skill edit
  $ pushpress-expansion skill deploy --version upsell-skill-v2
  $ pushpress-expansion skill rollback upsell-skill-v1
  $ pushpress-expansion skill test
  $ pushpress-expansion skill diff upsell-skill-v1 current
`);

program.parse(process.argv);
