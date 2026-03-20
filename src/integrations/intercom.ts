/**
 * Intercom API client.
 * Handles rate limiting (1,000 req/min) with exponential backoff.
 */

import { IntercomContact, IntercomConversation } from '../types';

const BASE_URL = 'https://api.intercom.io';
const WORKSPACE_ID = process.env.INTERCOM_WORKSPACE_ID || 'aunedqr1';

function getToken(): string {
  const token = process.env.INTERCOM_ACCESS_TOKEN;
  if (!token) throw new Error('INTERCOM_ACCESS_TOKEN is not set');
  return token;
}

function headers(): Record<string, string> {
  return {
    'Authorization': `Bearer ${getToken()}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Intercom-Version': '2.11',
  };
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers as Record<string, string> || {}) } });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('X-RateLimit-Reset') || '1', 10);
      const delay = Math.max(retryAfter * 1000 - Date.now(), 1000);
      await sleep(delay);
      continue;
    }

    if (res.status >= 500 && attempt < retries) {
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }

    return res;
  }
  throw new Error(`Failed after ${retries} retries`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface ListConversationsParams {
  updatedAfter: Date;
  updatedBefore?: Date;
  limit?: number;
}

/**
 * List conversations updated in the given time window.
 * Handles pagination automatically.
 */
export async function listConversations(params: ListConversationsParams): Promise<IntercomConversation[]> {
  const conversations: IntercomConversation[] = [];
  const perPage = 20;
  let startingAfter: string | null = null;

  const afterTs = Math.floor(params.updatedAfter.getTime() / 1000);
  const beforeTs = params.updatedBefore ? Math.floor(params.updatedBefore.getTime() / 1000) : undefined;

  while (true) {
    const queryParams = new URLSearchParams({
      per_page: String(perPage),
      order: 'desc',
      sort: 'updated_at',
    });

    if (startingAfter) {
      queryParams.set('starting_after', startingAfter);
    }

    const url = `${BASE_URL}/conversations?${queryParams}`;
    const res = await fetchWithRetry(url);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Intercom listConversations failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      conversations: IntercomConversation[];
      pages?: { next?: { starting_after?: string } };
    };

    for (const conv of data.conversations) {
      // Filter by updated_at window
      if (conv.updated_at < afterTs) {
        // Since sorted desc, once we're past the window we can stop
        return conversations;
      }
      if (beforeTs && conv.updated_at > beforeTs) continue;

      conversations.push(conv);

      if (params.limit && conversations.length >= params.limit) {
        return conversations;
      }
    }

    // Pagination
    const nextCursor = data.pages?.next?.starting_after;
    if (!nextCursor || data.conversations.length < perPage) break;
    startingAfter = nextCursor;
  }

  return conversations;
}

/**
 * Get a single conversation by ID with full conversation parts.
 */
export async function getConversation(conversationId: string): Promise<IntercomConversation> {
  const url = `${BASE_URL}/conversations/${conversationId}`;
  const res = await fetchWithRetry(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Intercom getConversation failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<IntercomConversation>;
}

/**
 * Get a contact by ID with full custom attributes.
 */
export async function getContact(contactId: string): Promise<IntercomContact> {
  const url = `${BASE_URL}/contacts/${contactId}`;
  const res = await fetchWithRetry(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Intercom getContact failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<IntercomContact>;
}

/**
 * Build the Intercom conversation URL.
 */
export function conversationUrl(conversationId: string): string {
  return `https://app.intercom.com/a/apps/${WORKSPACE_ID}/conversations/${conversationId}`;
}

/**
 * Extract the primary contact ID from a conversation.
 */
export function extractPrimaryContactId(conversation: IntercomConversation): string | null {
  const contacts = conversation.contacts?.contacts ?? [];
  // Prefer 'user' type over 'lead'
  const user = contacts.find(c => c.type === 'user') ?? contacts[0];
  return user?.id ?? null;
}
