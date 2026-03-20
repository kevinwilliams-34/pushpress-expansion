/**
 * Slack integration — posts upsell signal alerts via the ExpansionBot.
 * Confidence routing:
 *   HIGH   → immediate post + @marcy
 *   MEDIUM → immediate post, no tag
 *   LOW    → batched in daily digest (not implemented in Phase 1)
 */

import { Signal } from '../types';

const SLACK_API = 'https://slack.com/api';

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  return token;
}

function getChannel(): string {
  return process.env.SLACK_CHANNEL || '#intercom-upsell-opportunities';
}

function getMarcyUserId(): string {
  return process.env.SLACK_MARCY_USER_ID || 'U061X6PRSEL';
}

async function slackPost(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as { ok: boolean; ts?: string; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API error (${method}): ${data.error}`);
  }
  return data;
}

function confidenceEmoji(confidence: string): string {
  switch (confidence) {
    case 'HIGH': return '🔔';
    case 'MEDIUM': return '🟡';
    case 'LOW': return '⚪';
    default: return '•';
  }
}

function confidenceLabel(confidence: string): string {
  return `*${confidence} CONFIDENCE*`;
}

/**
 * Build the Slack block kit message for a signal.
 */
function buildAlertBlocks(signal: Signal, isRealTime: boolean): object[] {
  const emoji = confidenceEmoji(signal.result);
  const label = confidenceLabel(signal.result);
  const trigger = isRealTime ? '_(Real-Time)_' : '_(Scheduled Scan)_';
  const marcyMention = signal.result === 'HIGH' ? `<@${getMarcyUserId()}> — flagged for immediate review` : '';
  const ts = new Date(signal.detected_at).toLocaleString('en-US', { timeZone: 'America/Denver' });

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} Upsell Signal — ${signal.result} CONFIDENCE ${isRealTime ? '(Real-Time)' : '(Scan)'}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Customer:*\n${signal.customer_name || 'Unknown'} | ${signal.customer_email || 'unknown'}` },
        { type: 'mrkdwn', text: `*Current Plan:*\n${signal.current_plan || 'Unknown'}` },
        { type: 'mrkdwn', text: `*Product of Interest:*\n${signal.product}` },
        { type: 'mrkdwn', text: `*Signal Type:*\n${signal.signal_type}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Quote:* _"${signal.quote}"_`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recommended Action:* ${signal.action}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Conversation', emoji: true },
          url: signal.intercom_url,
          action_id: `view_conversation_${signal.id}`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${marcyMention ? marcyMention + '  ·  ' : ''}Expansion Bot · ${ts} · Signal ID: ${signal.id}`,
        },
      ],
    },
    { type: 'divider' },
  ];
}

/**
 * Build the fallback text (shown in notifications / unfurls).
 */
function buildFallbackText(signal: Signal): string {
  return `${confidenceEmoji(signal.result)} Upsell Signal — ${signal.result} | ${signal.customer_name} | ${signal.product} | "${signal.quote.slice(0, 100)}"`;
}

/**
 * Post a single signal alert to Slack.
 * Returns the message timestamp (for threading / feedback loop).
 */
export async function postSignalAlert(signal: Signal, isRealTime = false): Promise<string | null> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn('[Slack] SLACK_BOT_TOKEN not set — skipping Slack post');
    return null;
  }

  const channel = getChannel();
  const text = buildFallbackText(signal);

  // HIGH confidence: also @marcy in the text field so notification fires
  const notifyText = signal.result === 'HIGH'
    ? `${text}\n<@${getMarcyUserId()}>`
    : text;

  try {
    const result = await slackPost('chat.postMessage', {
      channel,
      text: notifyText,
      blocks: buildAlertBlocks(signal, isRealTime),
      unfurl_links: false,
    });

    return result.ts ?? null;
  } catch (err) {
    console.error('[Slack] Failed to post alert:', err);
    return null;
  }
}

/**
 * Post a daily digest of LOW confidence signals.
 */
export async function postDailyDigest(signals: Signal[]): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN || signals.length === 0) return;

  const channel = getChannel();
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const lines = signals.map(s =>
    `• *${s.customer_name || s.customer_email}* — ${s.product} — _"${s.quote.slice(0, 80)}..."_ — <${s.intercom_url}|View>`
  );

  await slackPost('chat.postMessage', {
    channel,
    text: `⚪ Daily Digest — ${date} — ${signals.length} Low Confidence Signal(s)`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `⚪ Daily Digest — ${date}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${signals.length} Low Confidence Signal(s)*\n\n${lines.join('\n')}`,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: 'Expansion Bot · Review when convenient' }],
      },
    ],
  });
}

/**
 * Update an existing Slack message (e.g., mark as false positive).
 */
export async function updateMessage(ts: string, signal: Signal): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;

  const channel = getChannel();
  const statusText = signal.feedback_status === 'false_positive'
    ? '~Upsell Signal~ — ❌ Marked as false positive'
    : signal.feedback_status === 'converted'
    ? '✅ Converted to deal!'
    : undefined;

  if (!statusText) return;

  try {
    await slackPost('chat.update', {
      channel,
      ts,
      text: statusText,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: statusText },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Updated by ${signal.feedback_by ?? 'unknown'} · ${signal.feedback_at ?? ''}` }],
        },
      ],
    });
  } catch (err) {
    console.error('[Slack] Failed to update message:', err);
  }
}
