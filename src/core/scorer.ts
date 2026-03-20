/**
 * Claude scoring engine.
 * Routes conversations through the Make scorer proxy scenario,
 * which calls claude-sonnet-4-6 via Make's built-in AI Provider connection.
 * Returns a structured ScorerOutput.
 */

import { ScorerInput, ScorerOutput, Confidence, Product, SignalType, IntercomContact } from '../types';
import { preScreen, extractConversationText } from './signals';
import { runGuardrail, detectProductFromText } from './guardrail';

const MAKE_SCORER_WEBHOOK_URL = process.env.MAKE_SCORER_WEBHOOK_URL
  ?? 'https://hook.us2.make.com/m7x3fyqvf1154h4vu6jvomy6456ubxgm';

/**
 * Call the Make scorer proxy and return Claude's raw text response.
 */
async function callMakeScorer(payload: {
  customer_name: string;
  customer_email: string;
  stripe_plan: string;
  profitwell_plans: string;
  conversation_text: string;
}): Promise<string> {
  const response = await fetch(MAKE_SCORER_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Make scorer proxy returned HTTP ${response.status}`);
  }

  return response.text();
}

/**
 * Parse Claude's structured response.
 */
function parseClaudeResponse(text: string): {
  result: Confidence;
  product: Product;
  signal_type: SignalType;
  quote: string;
  action: string;
  reason: string;
} {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const get = (key: string): string => {
    const line = lines.find(l => l.startsWith(`${key}:`));
    if (!line) return '';
    return line.slice(key.length + 1).trim();
  };

  const resultRaw = get('RESULT').toUpperCase();
  const result: Confidence = (['HIGH', 'MEDIUM', 'LOW', 'SKIP'].includes(resultRaw)
    ? resultRaw : 'SKIP') as Confidence;

  const productRaw = get('PRODUCT');
  const product: Product = (['Grow', 'Train', 'Pro', 'Unknown'].includes(productRaw)
    ? productRaw : 'Unknown') as Product;

  const signalRaw = get('SIGNAL_TYPE');
  const signal_type: SignalType = (['Explicit', 'Behavioral', 'Inferred', 'N/A'].includes(signalRaw)
    ? signalRaw : 'N/A') as SignalType;

  const quote = get('QUOTE') || 'N/A';
  const action = get('ACTION') || 'N/A';
  const reason = get('REASON') || '';

  return { result, product, signal_type, quote, action, reason };
}

/**
 * Score a single conversation.
 * Returns SKIP immediately if pre-screen or guardrail blocks.
 */
export async function scoreConversation(input: ScorerInput): Promise<ScorerOutput> {
  const { conversation, contact } = input;

  const parts = conversation.conversation_parts?.conversation_parts ?? [];
  const conversationText = extractConversationText(conversation.source, parts);

  // Step 1: Pre-screen with keywords (free, no API call)
  const preScreenResult = preScreen(conversationText);
  if (!preScreenResult.matched) {
    return skipResult('No signal keywords found in conversation', contact, 0);
  }

  // Step 2: Quick product detection for guardrail pre-check
  const likelyProduct = detectProductFromText(conversationText);

  // Step 3: Guardrail check (uses Intercom custom attributes)
  const guardrail = runGuardrail(contact, likelyProduct);
  if (guardrail.skip) {
    return {
      result: 'SKIP',
      product: likelyProduct ?? 'Unknown',
      signal_type: 'N/A',
      stripe_verified: false,
      current_plan: guardrail.current_plan,
      profitwell_plans: guardrail.profitwell_plans,
      quote: 'N/A',
      action: 'N/A',
      raw_response: '',
      tokens_used: 0,
      skip_reason: guardrail.reason,
    };
  }

  // Step 4: Call claude-sonnet-4-6 via Make scorer proxy
  const rawResponse = await callMakeScorer({
    customer_name: contact.name || 'Unknown',
    customer_email: contact.email || 'unknown',
    stripe_plan: String(contact.custom_attributes?.stripe_plan ?? 'unknown'),
    profitwell_plans: String(contact.custom_attributes?.profitwell_plans ?? 'unknown'),
    conversation_text: conversationText,
  });

  // Step 5: Parse response
  const parsed = parseClaudeResponse(rawResponse);

  return {
    result: parsed.result,
    product: parsed.product,
    signal_type: parsed.signal_type,
    stripe_verified: false, // v1: using Intercom attrs, not live Stripe
    current_plan: guardrail.current_plan,
    profitwell_plans: guardrail.profitwell_plans,
    quote: parsed.quote,
    action: parsed.action,
    raw_response: rawResponse,
    tokens_used: 0, // Make proxy doesn't expose token counts
  };
}

function skipResult(reason: string, contact: IntercomContact, tokens: number): ScorerOutput {
  return {
    result: 'SKIP',
    product: 'Unknown',
    signal_type: 'N/A',
    stripe_verified: false,
    current_plan: String(contact.custom_attributes?.stripe_plan ?? ''),
    profitwell_plans: String(contact.custom_attributes?.profitwell_plans ?? ''),
    quote: 'N/A',
    action: 'N/A',
    raw_response: '',
    tokens_used: tokens,
    skip_reason: reason,
  };
}
