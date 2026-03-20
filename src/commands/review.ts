/**
 * review command — manage the feedback loop.
 * confirm / reject (false positive) / convert signals.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { listSignals, getSignalById, updateSignalFeedback } from '../db/schema';
import { Signal, FeedbackStatus } from '../types';

// ─── helpers ───────────────────────────────────────────────────────────────

function parseSince(since: string): Date {
  const match = since.match(/^(\d+)(h|d)$/);
  if (!match) throw new Error(`Invalid --since format: "${since}". Use e.g. "24h" or "7d".`);
  const value = parseInt(match[1], 10);
  const ms = match[2] === 'h' ? value * 3_600_000 : value * 86_400_000;
  return new Date(Date.now() - ms);
}

function confidenceColor(result: string): string {
  if (result === 'HIGH') return chalk.red.bold(result);
  if (result === 'MEDIUM') return chalk.yellow(result);
  if (result === 'LOW') return chalk.gray(result);
  return chalk.dim(result);
}

function statusColor(status: FeedbackStatus): string {
  const colors: Record<FeedbackStatus, (s: string) => string> = {
    pending: chalk.yellow,
    confirmed: chalk.green,
    false_positive: chalk.red,
    converted: chalk.cyan.bold,
  };
  return (colors[status] ?? chalk.white)(status);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── list ──────────────────────────────────────────────────────────────────

export interface ReviewListOptions {
  status?: string;
  since?: string;
  confidence?: string;
  limit?: number;
}

export function runReviewList(options: ReviewListOptions = {}): void {
  const since = options.since ? parseSince(options.since) : undefined;
  const signals = listSignals({
    since,
    result: options.confidence ? options.confidence.toUpperCase() : undefined,
    feedback_status: options.status ?? 'pending',
    limit: options.limit ?? 50,
  });

  if (signals.length === 0) {
    console.log(chalk.dim(`\n  No signals with status "${options.status ?? 'pending'}".\n`));
    return;
  }

  console.log(chalk.bold(`\n  Signals — ${options.status ?? 'pending'} (${signals.length})\n`));

  const table = new Table({
    head: ['ID (first 8)', 'Date', 'Customer', 'Result', 'Product', 'Status', 'Quote'],
    colWidths: [12, 18, 28, 9, 9, 16, 45],
    style: { head: ['bold'] },
  });

  for (const s of signals) {
    table.push([
      s.id.slice(0, 8),
      formatDate(s.detected_at),
      s.customer_email.slice(0, 26),
      confidenceColor(s.result),
      s.product,
      statusColor(s.feedback_status),
      `"${s.quote.slice(0, 40)}"`,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`\n  Use full signal ID with confirm/reject/convert commands.\n`));
}

// ─── confirm / reject / convert ────────────────────────────────────────────

export interface ReviewActionOptions {
  signalId: string;
  reason?: string;
  by?: string;
}

function resolveSignal(signalId: string): Signal | null {
  // Accept full UUID or 8-char prefix
  if (signalId.length === 36) return getSignalById(signalId);

  // Prefix match — scan recent signals
  const recents = listSignals({ limit: 200 });
  return recents.find(s => s.id.startsWith(signalId)) ?? null;
}

export function runReviewConfirm(options: ReviewActionOptions): void {
  const signal = resolveSignal(options.signalId);
  if (!signal) {
    console.error(chalk.red(`\n  Signal not found: ${options.signalId}\n`));
    process.exit(1);
  }

  const by = options.by ?? process.env.USER ?? 'cli';
  const updated = updateSignalFeedback(signal.id, 'confirmed', by, options.reason);
  if (updated) {
    console.log(chalk.green(`\n  ✅ Signal ${signal.id.slice(0, 8)} marked as CONFIRMED`));
    console.log(chalk.dim(`     ${signal.customer_email} | ${signal.result} | ${signal.product}\n`));
  }
}

export function runReviewReject(options: ReviewActionOptions): void {
  const signal = resolveSignal(options.signalId);
  if (!signal) {
    console.error(chalk.red(`\n  Signal not found: ${options.signalId}\n`));
    process.exit(1);
  }

  const by = options.by ?? process.env.USER ?? 'cli';
  const updated = updateSignalFeedback(signal.id, 'false_positive', by, options.reason);
  if (updated) {
    console.log(chalk.red(`\n  ❌ Signal ${signal.id.slice(0, 8)} marked as FALSE POSITIVE`));
    if (options.reason) {
      console.log(chalk.dim(`     Reason: ${options.reason}`));
    }
    console.log(chalk.dim(`     ${signal.customer_email} | ${signal.result} | ${signal.product}\n`));
  }
}

export function runReviewConvert(options: ReviewActionOptions): void {
  const signal = resolveSignal(options.signalId);
  if (!signal) {
    console.error(chalk.red(`\n  Signal not found: ${options.signalId}\n`));
    process.exit(1);
  }

  const by = options.by ?? process.env.USER ?? 'cli';
  const updated = updateSignalFeedback(signal.id, 'converted', by, options.reason);
  if (updated) {
    console.log(chalk.cyan.bold(`\n  🎉 Signal ${signal.id.slice(0, 8)} marked as CONVERTED`));
    console.log(chalk.dim(`     ${signal.customer_email} | ${signal.result} | ${signal.product}\n`));
  }
}
