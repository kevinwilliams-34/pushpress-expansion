/**
 * report command — signal analytics and performance tracking.
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  getSummaryStats,
  listSignals,
  getBreakdownByProduct,
  getBreakdownByTrigger,
  getAccuracyOverTime,
  getConversionFunnel,
} from '../db/schema';

function parseSinceDate(since?: string): Date | undefined {
  if (!since) return undefined;
  const match = since.match(/^(\d+)(h|d)$/);
  if (!match) return new Date(since); // assume ISO date
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === 'h' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export function runReportSummary(options: { since?: string } = {}): void {
  const dotenv = require('dotenv');
  dotenv.config();

  const since = parseSinceDate(options.since);
  const stats = getSummaryStats(since);
  const label = options.since ? `Last ${options.since}` : 'All Time';

  const total = stats.total_signals ?? 0;
  const high = stats.high ?? 0;
  const medium = stats.medium ?? 0;
  const low = stats.low ?? 0;
  const confirmed = stats.confirmed ?? 0;
  const falsePosCount = stats.false_positives ?? 0;
  const pending = stats.pending ?? 0;
  const converted = stats.converted ?? 0;
  const grow = stats.grow ?? 0;
  const train = stats.train ?? 0;

  const precision = total > 0
    ? Math.round(((confirmed + converted) / (confirmed + converted + falsePosCount)) * 100) || 0
    : 0;

  console.log('');
  console.log(chalk.bold('PushPress Expansion Intelligence — ' + label));
  console.log(chalk.bold('━'.repeat(50)));
  console.log('');
  console.log(`Signals detected:       ${chalk.bold(total)}`);
  console.log(`  ${chalk.red.bold('→ HIGH:')}               ${high}`);
  console.log(`  ${chalk.yellow('→ MEDIUM:')}             ${medium}`);
  console.log(`  ${chalk.gray('→ LOW:')}                ${low}`);
  console.log('');
  console.log('Signal accuracy:');
  console.log(`  Confirmed upsells:    ${confirmed}  (${total > 0 ? Math.round((confirmed / total) * 100) : 0}%)`);
  console.log(`  False positives:      ${falsePosCount}  (${total > 0 ? Math.round((falsePosCount / total) * 100) : 0}%)`);
  console.log(`  Pending review:       ${pending}  (${total > 0 ? Math.round((pending / total) * 100) : 0}%)`);
  console.log(`  Precision:            ${chalk.bold(precision + '%')} (confirmed / reviewed)`);
  console.log('');
  console.log('Conversions to deal:    ' + chalk.bold(converted));
  if (grow + train > 0) {
    if (grow > 0) console.log(`  → Grow:              ${grow}`);
    if (train > 0) console.log(`  → Train:             ${train}`);
  }
  console.log('');

  if (total === 0) {
    console.log(chalk.dim('  No signals found in this window.'));
  }
}

// ─── breakdown ─────────────────────────────────────────────────────────────

export function runReportBreakdown(options: { since?: string; by?: string } = {}): void {
  const dotenv = require('dotenv');
  dotenv.config();

  const since = parseSinceDate(options.since);
  const label = options.since ? `Last ${options.since}` : 'All Time';
  const by = options.by ?? 'product';

  console.log('');
  console.log(chalk.bold(`Signal Breakdown by ${by} — ${label}`));
  console.log(chalk.bold('─'.repeat(70)));

  if (by === 'trigger') {
    const rows = getBreakdownByTrigger(since);
    if (rows.length === 0) {
      console.log(chalk.dim('\n  No data in this window.\n'));
      return;
    }
    const maxTotal = Math.max(...rows.map(r => r.total));
    for (const r of rows) {
      const bar = '█'.repeat(Math.round((r.total / maxTotal) * 20));
      console.log(
        `\n  ${chalk.bold(r.trigger.padEnd(18))} ${chalk.dim(bar)} ${r.total}` +
        `\n  ${chalk.dim('H:')} ${chalk.red.bold(String(r.high).padStart(3))}  ` +
        `${chalk.dim('M:')} ${chalk.yellow(String(r.medium).padStart(3))}  ` +
        `${chalk.dim('L:')} ${chalk.gray(String(r.low).padStart(3))}`
      );
    }
  } else {
    // default: by product
    const rows = getBreakdownByProduct(since);
    if (rows.length === 0) {
      console.log(chalk.dim('\n  No data in this window.\n'));
      return;
    }
    const maxTotal = Math.max(...rows.map(r => r.total));
    for (const r of rows) {
      const bar = '█'.repeat(Math.round((r.total / maxTotal) * 20));
      const precision = (r.confirmed + r.converted + r.false_positives) > 0
        ? Math.round(((r.confirmed + r.converted) / (r.confirmed + r.converted + r.false_positives)) * 100)
        : 0;
      console.log(
        `\n  ${chalk.bold(r.product.padEnd(10))} ${chalk.dim(bar)} ${r.total} signals` +
        `\n  ${chalk.dim('H:')} ${chalk.red.bold(String(r.high).padStart(3))}  ` +
        `${chalk.dim('M:')} ${chalk.yellow(String(r.medium).padStart(3))}  ` +
        `${chalk.dim('L:')} ${chalk.gray(String(r.low).padStart(3))}  ` +
        `${chalk.dim('Precision:')} ${precision}%  ` +
        `${chalk.dim('Converted:')} ${chalk.cyan.bold(String(r.converted))}`
      );
    }
  }
  console.log('');
}

// ─── accuracy ──────────────────────────────────────────────────────────────

export function runReportAccuracy(options: { since?: string; by?: string } = {}): void {
  const dotenv = require('dotenv');
  dotenv.config();

  const since = parseSinceDate(options.since);
  const label = options.since ? `Last ${options.since}` : 'All Time';
  const groupBy = (options.by === 'week' ? 'week' : 'day') as 'day' | 'week';
  const points = getAccuracyOverTime(since, groupBy);

  if (points.length === 0) {
    console.log(chalk.dim('\n  No feedback data in this window.\n'));
    return;
  }

  console.log('');
  console.log(chalk.bold(`Signal Accuracy over Time — ${label} (by ${groupBy})`));
  console.log(chalk.bold('─'.repeat(70)));
  console.log(chalk.dim(`  ${'Date'.padEnd(14)} ${'Total'.padStart(6)} ${'Confirmed'.padStart(10)} ${'FP'.padStart(5)} ${'Converted'.padStart(10)} ${'Precision'.padStart(10)}`));
  console.log(chalk.dim('  ' + '─'.repeat(60)));

  for (const p of points) {
    const precision = p.precision;
    const precisionColor = precision >= 80 ? chalk.green.bold
      : precision >= 60 ? chalk.yellow
      : chalk.red;
    console.log(
      `  ${p.date.padEnd(14)} ` +
      `${String(p.total).padStart(6)} ` +
      `${chalk.green(String(p.confirmed).padStart(10))} ` +
      `${chalk.red(String(p.false_positives).padStart(5))} ` +
      `${chalk.cyan(String(p.converted).padStart(10))} ` +
      `${precisionColor(String(precision + '%').padStart(10))}`
    );
  }

  const totalReviewed = points.reduce((s, p) => s + p.confirmed + p.false_positives + p.converted, 0);
  const totalConfirmed = points.reduce((s, p) => s + p.confirmed + p.converted, 0);
  const avgPrecision = totalReviewed > 0 ? Math.round((totalConfirmed / totalReviewed) * 100) : 0;
  console.log(chalk.dim('  ' + '─'.repeat(60)));
  console.log(`  ${chalk.bold('Overall precision:')} ${chalk.bold(avgPrecision + '%')}  (${totalConfirmed} of ${totalReviewed} reviewed signals confirmed/converted)`);
  console.log('');
}

// ─── conversions ───────────────────────────────────────────────────────────

export function runReportConversions(options: { since?: string } = {}): void {
  const dotenv = require('dotenv');
  dotenv.config();

  const since = parseSinceDate(options.since);
  const label = options.since ? `Last ${options.since}` : 'All Time';
  const funnel = getConversionFunnel(since);

  console.log('');
  console.log(chalk.bold(`Conversion Funnel — ${label}`));
  console.log(chalk.bold('─'.repeat(50)));
  console.log('');

  const total = funnel.total_detected;
  const bar = (n: number) => '█'.repeat(Math.round(total > 0 ? (n / total) * 30 : 0));

  console.log(`  ${chalk.bold('Detected'.padEnd(18))} ${chalk.dim(bar(total).padEnd(32))} ${chalk.bold(String(total))}`);
  console.log(`  ${chalk.dim('↓')} review rate: ${chalk.bold(funnel.review_rate + '%')}`);
  console.log(`  ${'Reviewed'.padEnd(18)} ${chalk.dim(bar(funnel.reviewed).padEnd(32))} ${funnel.reviewed}`);
  console.log(`  ${chalk.dim('↓')} precision: ${chalk.bold(funnel.precision + '%')}`);
  console.log(`  ${'Confirmed'.padEnd(18)} ${chalk.green(bar(funnel.confirmed + funnel.converted).padEnd(32))} ${funnel.confirmed + funnel.converted}`);
  console.log(`  ${chalk.dim('↓')} convert rate: ${chalk.bold(funnel.convert_rate + '%')}`);
  console.log(`  ${'Converted to deal'.padEnd(18)} ${chalk.cyan.bold(bar(funnel.converted).padEnd(32))} ${chalk.cyan.bold(String(funnel.converted))}`);
  console.log('');
  console.log(`  False positives:   ${chalk.red(String(funnel.false_positives))}  (${total > 0 ? Math.round((funnel.false_positives / total) * 100) : 0}% of total)`);
  console.log(`  Pending review:    ${chalk.yellow(String(funnel.pending))}  (${total > 0 ? Math.round((funnel.pending / total) * 100) : 0}% of total)`);
  console.log('');
}

// ─── export ────────────────────────────────────────────────────────────────

export function runReportExport(options: { since?: string; format?: string; output?: string } = {}): void {
  const dotenv = require('dotenv');
  dotenv.config();

  const since = parseSinceDate(options.since);
  const format = options.format ?? 'csv';
  const signals = listSignals({ since, limit: 10000 });

  if (signals.length === 0) {
    console.log(chalk.dim('\n  No signals to export.\n'));
    return;
  }

  let content: string;

  if (format === 'json') {
    content = JSON.stringify(signals, null, 2);
  } else {
    // CSV
    const headers = [
      'id', 'conversation_id', 'detected_at', 'customer_name', 'customer_email',
      'current_plan', 'result', 'product', 'signal_type', 'stripe_verified',
      'feedback_status', 'feedback_at', 'feedback_by', 'quote', 'action',
      'intercom_url', 'trigger', 'notes',
    ];
    const escape = (v: unknown): string => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const rows = signals.map(s =>
      headers.map(h => escape((s as unknown as Record<string, unknown>)[h])).join(',')
    );
    content = [headers.join(','), ...rows].join('\n');
  }

  if (options.output) {
    const outPath = path.resolve(options.output);
    fs.writeFileSync(outPath, content, 'utf-8');
    console.log(chalk.green(`\n  ✅ Exported ${signals.length} signals to ${outPath}\n`));
  } else {
    process.stdout.write(content + '\n');
  }
}

// ─── recent ────────────────────────────────────────────────────────────────

export function runReportRecent(options: { since?: string; limit?: number; result?: string } = {}): void {
  const dotenv = require('dotenv');
  dotenv.config();

  const since = parseSinceDate(options.since);
  const signals = listSignals({
    since,
    result: options.result?.toUpperCase(),
    limit: options.limit ?? 20,
  });

  if (signals.length === 0) {
    console.log(chalk.dim('\nNo signals found.\n'));
    return;
  }

  console.log('');
  console.log(chalk.bold(`Recent Signals (${signals.length})`));
  console.log(chalk.bold('─'.repeat(80)));

  for (const s of signals) {
    const confidenceColor = {
      HIGH: chalk.red.bold,
      MEDIUM: chalk.yellow.bold,
      LOW: chalk.gray,
      SKIP: chalk.dim,
    }[s.result] ?? chalk.white;

    const feedbackIcon = {
      pending: '⏳',
      confirmed: '✅',
      false_positive: '❌',
      converted: '💰',
    }[s.feedback_status] ?? '•';

    const date = new Date(s.detected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    console.log(
      `${feedbackIcon} ${confidenceColor(`[${s.result}]`)} ` +
      `${chalk.bold(s.customer_name || s.customer_email)} | ` +
      chalk.cyan(s.product) + ` | ` +
      chalk.dim(date) + '\n' +
      `   "${s.quote.slice(0, 100)}"\n` +
      `   ${chalk.dim(s.intercom_url)}\n`
    );
  }
}
