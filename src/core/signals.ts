/**
 * Signal library — Groups A-E keyword matching.
 * Pre-screens conversations before sending to Claude.
 * A conversation must match at least one keyword to proceed to scoring.
 */

// Group A — Explicit product interest
const GROUP_A = [
  'grow plan', 'grow pricing', 'grow features', 'what is grow', 'tell me about grow',
  'train plan', 'train pricing', 'train features', 'what is train', 'tell me about train',
  'add-on', 'add on', 'upgrade my plan', 'upgrade plan', 'upgrade to',
  'new product', 'what else do you offer', "what's included in", 'what is included in',
  'can i see a demo', 'show me how', 'request a demo',
];

// Group B — Pricing exploration
const GROUP_B = [
  'how much does', 'what does it cost', 'how much is',
  'what plan', 'which plan', 'plan options', 'compare plans',
  'is there a way to get', 'do you have a plan that',
  'cost per', ' pricing', 'price ',
];

// Group C — Expansion language
const GROUP_C = [
  "we're growing", 'growing our team', 'adding staff', 'new location',
  'opening another', 'expanding', 'scaling', 'more members',
  'new hire', 'hiring coaches', 'second location', 'franchise',
  'multiple locations', 'multi-location',
];

// Group D — Capability gap (inferred)
const GROUP_D = [
  'wish you had', 'would be great if', 'do you support', 'can your platform',
  'is there a feature', 'we need a way to', 'how do we handle',
  'currently using', 'we also use', 'we use another tool',
  'does pushpress have', 'does it have',
];

// Standalone product name triggers — only flag if context suggests inquiry, not support
const PRODUCT_NAMES = ['grow', 'train'];

// Explicit upgrade/pricing intent words
const INTENT_WORDS = ['upgrade', 'pricing', 'price', 'cost', 'plan', 'demo'];

export interface PreScreenResult {
  matched: boolean;
  matchedGroups: string[];
  matchedTerms: string[];
}

export function preScreen(text: string): PreScreenResult {
  const lower = text.toLowerCase();
  const matchedGroups: string[] = [];
  const matchedTerms: string[] = [];

  function checkGroup(terms: string[], groupName: string): void {
    for (const term of terms) {
      if (lower.includes(term)) {
        if (!matchedGroups.includes(groupName)) matchedGroups.push(groupName);
        matchedTerms.push(term);
      }
    }
  }

  checkGroup(GROUP_A, 'A');
  checkGroup(GROUP_B, 'B');
  checkGroup(GROUP_C, 'C');
  checkGroup(GROUP_D, 'D');

  // Product names only count if paired with intent words (reduces false positives)
  const hasProductName = PRODUCT_NAMES.some(p => lower.includes(p));
  const hasIntent = INTENT_WORDS.some(w => lower.includes(w));
  if (hasProductName && hasIntent) {
    if (!matchedGroups.includes('A')) matchedGroups.push('A');
    const found = PRODUCT_NAMES.filter(p => lower.includes(p));
    matchedTerms.push(...found);
  }

  return {
    matched: matchedGroups.length > 0,
    matchedGroups,
    matchedTerms: [...new Set(matchedTerms)],
  };
}

/**
 * Extract full text from a conversation for analysis.
 */
export function extractConversationText(source: { body: string }, parts?: Array<{ body: string; author: { type: string } }>): string {
  const lines: string[] = [];

  if (source.body) {
    lines.push(stripHtml(source.body));
  }

  if (parts) {
    for (const part of parts) {
      if (part.body && part.author.type !== 'bot') {
        lines.push(stripHtml(part.body));
      }
    }
  }

  return lines.join('\n').trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
