/**
 * scan command — pulls Intercom conversations, scores them, routes output.
 */

import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import Table from 'cli-table3';
import { ScanOptions, Signal, Confidence } from '../types';
import { listConversations, getConversation, getContact, conversationUrl, extractPrimaryContactId } from '../integrations/intercom';
import { scoreConversation } from '../core/scorer';
import { loadSkillPrompt } from '../core/prompt';
import { insertSignal, updateSignalSlackTs, insertScanLog, completeScanLog, getSignalByConversationId } from '../db/schema';
import { postSignalAlert } from '../integrations/slack';

/**
 * Parse a "since" string like "24h", "7d", "48h" into a Date.
 */
function parseSince(since: string): Date {
  const match = since.match(/^(\d+)(h|d)$/);
  if (!match) throw new Error(`Invalid --since format: "${since}". Use e.g. "24h" or "7d".`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === 'h' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

function meetsMinConfidence(result: Confidence, minConfidence: string | undefined): boolean {
  if (!minConfidence) return true;
  const order: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const resultOrder: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, SKIP: 0 };
  return resultOrder[result] >= (order[minConfidence.toLowerCase()] ?? 1);
}

function printTableRow(signal: Signal, dryRun: boolean): void {
  const confidenceColor = {
    HIGH: chalk.red.bold,
    MEDIUM: chalk.yellow.bold,
    LOW: chalk.gray,
    SKIP: chalk.dim,
  }[signal.result] ?? chalk.white;

  const prefix = dryRun ? chalk.cyan('[DRY RUN] ') : '';
  console.log(
    prefix +
    confidenceColor(`[${signal.result}]`) +
    ` ${signal.customer_name || signal.customer_email} | ` +
    chalk.bold(signal.product) +
    ` | "${signal.quote.slice(0, 80)}"`
  );
}

interface ScanResult {
  reviewed: number;
  found: number;
  skipped: number;
  signals: Signal[];
}

export async function runScan(options: ScanOptions = {}): Promise<ScanResult> {
  // Load .env if not already loaded
  const dotenv = await import('dotenv');
  dotenv.config();

  const scanId = uuidv4();
  const trigger = options.trigger ?? 'manual';

  // Determine time window
  let updatedAfter: Date;
  let updatedBefore: Date | undefined;

  if (options.conversationId) {
    // Single conversation mode — time window doesn't matter
    updatedAfter = new Date(0);
  } else if (options.from) {
    updatedAfter = new Date(options.from);
    updatedBefore = options.to ? new Date(options.to) : undefined;
  } else {
    updatedAfter = parseSince(options.since ?? '24h');
  }

  const dryRun = options.dryRun ?? false;
  const outputMode = options.output ?? 'slack';

  // Load skill prompt
  let skillPrompt: string;
  try {
    skillPrompt = loadSkillPrompt();
  } catch (err) {
    console.error(chalk.red(`Failed to load skill prompt: ${(err as Error).message}`));
    process.exit(1);
  }

  console.log(chalk.bold('\n🔍 PushPress Expansion Intelligence — Scan'));
  if (dryRun) console.log(chalk.cyan('  Mode: DRY RUN (no Slack/DB writes)'));
  console.log(`  Window: ${options.conversationId ? `Conversation ${options.conversationId}` : `since ${updatedAfter.toLocaleString()}`}`);
  console.log('');

  if (!dryRun) {
    insertScanLog(scanId, trigger);
  }

  let conversations;
  try {
    if (options.conversationId) {
      const conv = await getConversation(options.conversationId);
      conversations = [conv];
    } else {
      console.log(chalk.dim('  Fetching conversations from Intercom...'));
      conversations = await listConversations({ updatedAfter, updatedBefore });
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.error(chalk.red(`Failed to fetch conversations: ${msg}`));
    if (!dryRun) completeScanLog(scanId, 0, 0, 0, msg);
    process.exit(1);
  }

  console.log(chalk.dim(`  Found ${conversations.length} conversation(s) to review\n`));

  const signals: Signal[] = [];
  let skippedCount = 0;
  let reviewed = 0;

  // Output table header
  if (outputMode === 'table') {
    const table = new Table({
      head: ['Result', 'Customer', 'Plan', 'Product', 'Quote (truncated)'],
      colWidths: [10, 25, 15, 10, 50],
    });
    console.log(table.toString());
  }

  for (const conversation of conversations) {
    reviewed++;

    // Skip already-flagged conversations
    const existing = getSignalByConversationId(conversation.id);
    if (existing && !options.conversationId) {
      skippedCount++;
      continue;
    }

    // Get contact
    const contactId = extractPrimaryContactId(conversation);
    if (!contactId) {
      skippedCount++;
      continue;
    }

    let contact;
    try {
      contact = await getContact(contactId);
    } catch (err) {
      console.error(chalk.yellow(`  Skipping conv ${conversation.id}: failed to get contact — ${(err as Error).message}`));
      skippedCount++;
      continue;
    }

    // Score the conversation
    let scored;
    try {
      scored = await scoreConversation({ conversation, contact, prompt: skillPrompt });
    } catch (err) {
      console.error(chalk.yellow(`  Error scoring conv ${conversation.id}: ${(err as Error).message}`));
      skippedCount++;
      continue;
    }

    if (scored.result === 'SKIP') {
      skippedCount++;
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(chalk.dim(`  [SKIP] ${contact.email} — ${scored.skip_reason}`));
      }
      continue;
    }

    // Apply min-confidence filter
    if (!meetsMinConfidence(scored.result, options.minConfidence)) {
      skippedCount++;
      continue;
    }

    // Build signal record
    const signal: Signal = {
      id: uuidv4(),
      conversation_id: conversation.id,
      customer_name: contact.name ?? '',
      customer_email: contact.email ?? '',
      current_plan: scored.current_plan,
      profitwell_plans: scored.profitwell_plans,
      result: scored.result,
      product: scored.product,
      signal_type: scored.signal_type,
      stripe_verified: scored.stripe_verified,
      quote: scored.quote,
      action: scored.action,
      intercom_url: conversationUrl(conversation.id),
      slack_message_ts: null,
      detected_at: new Date().toISOString(),
      trigger,
      feedback_status: 'pending',
      feedback_at: null,
      feedback_by: null,
      notes: null,
    };

    signals.push(signal);

    // Print output
    if (outputMode === 'json') {
      console.log(JSON.stringify(signal, null, 2));
    } else {
      printTableRow(signal, dryRun);
    }

    if (!dryRun) {
      // Write to DB
      insertSignal(signal);

      // Post to Slack (HIGH + MEDIUM immediately, LOW batched)
      if (signal.result === 'HIGH' || signal.result === 'MEDIUM') {
        const slackTs = await postSignalAlert(signal, trigger !== 'manual' && trigger !== 'scheduled');
        if (slackTs) {
          updateSignalSlackTs(signal.id, slackTs);
          signal.slack_message_ts = slackTs;
        }
      }
    }
  }

  if (!dryRun) {
    completeScanLog(scanId, reviewed, signals.length, skippedCount);
  }

  // Print summary
  console.log('');
  console.log(chalk.bold('── Scan Complete ──────────────────────────────'));
  console.log(`  Conversations reviewed: ${chalk.bold(reviewed)}`);
  console.log(`  Signals found:          ${chalk.bold(signals.length)}`);

  if (signals.length > 0) {
    const high = signals.filter(s => s.result === 'HIGH').length;
    const medium = signals.filter(s => s.result === 'MEDIUM').length;
    const low = signals.filter(s => s.result === 'LOW').length;
    if (high > 0) console.log(`    ${chalk.red.bold('→ HIGH:')}   ${high}`);
    if (medium > 0) console.log(`    ${chalk.yellow('→ MEDIUM:')} ${medium}`);
    if (low > 0) console.log(`    ${chalk.gray('→ LOW:')}    ${low}`);
  } else {
    console.log(chalk.green('\n  ✅ No upsell opportunities detected in this window.'));
  }

  console.log(`  Skipped (guardrail):    ${chalk.dim(skippedCount)}`);

  if (dryRun) {
    console.log(chalk.cyan('\n  [DRY RUN] No writes to Slack or DB.'));
  }

  console.log('');

  return { reviewed, found: signals.length, skipped: skippedCount, signals };
}
