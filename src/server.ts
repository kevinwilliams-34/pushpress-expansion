/**
 * HTTP server for Make webhook calls.
 * Make fires webhooks to this server; this app handles all scoring + routing.
 *
 * Endpoints:
 *   POST /webhook/conversation-created
 *   POST /webhook/conversation-replied
 *   GET  /health
 *   GET  /signals
 *   GET  /signals/:id
 */

import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { getConversation, getContact, conversationUrl, extractPrimaryContactId } from './integrations/intercom';
import { scoreConversation } from './core/scorer';
import { loadSkillPrompt } from './core/prompt';
import { insertSignal, updateSignalSlackTs, listSignals, getSignalById } from './db/schema';
import { postSignalAlert } from './integrations/slack';
import { Signal } from './types';

// ─── helpers ───────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function checkAuth(req: http.IncomingMessage, secret: string | undefined): boolean {
  if (!secret) return true;
  return req.headers['x-webhook-secret'] === secret;
}

// ─── webhook handler ────────────────────────────────────────────────────────

async function handleWebhook(
  body: string,
  trigger: 'webhook_new' | 'webhook_reply',
): Promise<{ status: number; body: unknown }> {
  let payload: { conversation_id?: string; contact_id?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }

  const { conversation_id, contact_id } = payload;
  if (!conversation_id) {
    return { status: 400, body: { error: 'Missing conversation_id' } };
  }

  let conversation;
  try {
    conversation = await getConversation(conversation_id);
  } catch (err) {
    return { status: 502, body: { error: `Intercom fetch failed: ${(err as Error).message}` } };
  }

  const resolvedContactId = contact_id ?? extractPrimaryContactId(conversation);
  if (!resolvedContactId) {
    return { status: 200, body: { result: 'SKIP', reason: 'No contact on conversation' } };
  }

  let contact;
  try {
    contact = await getContact(resolvedContactId);
  } catch (err) {
    return { status: 502, body: { error: `Contact fetch failed: ${(err as Error).message}` } };
  }

  let skillPrompt: string;
  try {
    skillPrompt = loadSkillPrompt();
  } catch (err) {
    return { status: 500, body: { error: `Skill prompt load failed: ${(err as Error).message}` } };
  }

  let scored;
  try {
    scored = await scoreConversation({ conversation, contact, prompt: skillPrompt });
  } catch (err) {
    return { status: 500, body: { error: `Scoring failed: ${(err as Error).message}` } };
  }

  if (scored.result === 'SKIP') {
    return { status: 200, body: { result: 'SKIP', reason: scored.skip_reason } };
  }

  const signal: Signal = {
    id: uuidv4(),
    conversation_id,
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
    intercom_url: conversationUrl(conversation_id),
    slack_message_ts: null,
    detected_at: new Date().toISOString(),
    trigger,
    feedback_status: 'pending',
    feedback_at: null,
    feedback_by: null,
    notes: null,
  };

  insertSignal(signal);

  if (signal.result === 'HIGH' || signal.result === 'MEDIUM') {
    const slackTs = await postSignalAlert(signal, true);
    if (slackTs) {
      updateSignalSlackTs(signal.id, slackTs);
      signal.slack_message_ts = slackTs;
    }
  }

  return {
    status: 200,
    body: {
      result: signal.result,
      product: signal.product,
      signal_id: signal.id,
      slack_posted: !!signal.slack_message_ts,
    },
  };
}

// ─── router ─────────────────────────────────────────────────────────────────

async function router(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  secret: string | undefined,
): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // Health check — no auth required
  if (method === 'GET' && url === '/health') {
    json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  // Auth check for all other routes
  if (!checkAuth(req, secret)) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Webhook endpoints
  if (method === 'POST' && url === '/webhook/conversation-created') {
    const body = await readBody(req);
    const result = await handleWebhook(body, 'webhook_new');
    json(res, result.status, result.body);
    return;
  }

  if (method === 'POST' && url === '/webhook/conversation-replied') {
    const body = await readBody(req);
    const result = await handleWebhook(body, 'webhook_reply');
    json(res, result.status, result.body);
    return;
  }

  // Signals API
  if (method === 'GET' && url.startsWith('/signals')) {
    const idMatch = url.match(/^\/signals\/([^/?]+)/);
    if (idMatch) {
      const signal = getSignalById(idMatch[1]);
      if (!signal) {
        json(res, 404, { error: 'Signal not found' });
      } else {
        json(res, 200, signal);
      }
      return;
    }

    // /signals with optional ?since=7d&result=HIGH&limit=50
    const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '');
    const sinceStr = params.get('since');
    const sinceDate = sinceStr ? parseSinceParam(sinceStr) : undefined;
    const signals = listSignals({
      since: sinceDate,
      result: params.get('result') ?? undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : 100,
    });
    json(res, 200, signals);
    return;
  }

  json(res, 404, { error: 'Not found' });
}

function parseSinceParam(since: string): Date | undefined {
  const match = since.match(/^(\d+)(h|d)$/);
  if (!match) return undefined;
  const value = parseInt(match[1], 10);
  const ms = match[2] === 'h' ? value * 3600_000 : value * 86400_000;
  return new Date(Date.now() - ms);
}

// ─── server factory ─────────────────────────────────────────────────────────

export function createServer(secret: string | undefined): http.Server {
  return http.createServer(async (req, res) => {
    try {
      await router(req, res, secret);
    } catch (err) {
      console.error('[server] Unhandled error:', (err as Error).message);
      if (!res.headersSent) {
        json(res, 500, { error: 'Internal server error' });
      }
    }
  });
}
