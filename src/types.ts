export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'SKIP';
export type Product = 'Grow' | 'Train' | 'Pro' | 'Unknown';
export type SignalType = 'Explicit' | 'Behavioral' | 'Inferred' | 'N/A';
export type Trigger = 'scheduled' | 'webhook_new' | 'webhook_reply' | 'manual';
export type FeedbackStatus = 'pending' | 'confirmed' | 'false_positive' | 'converted';

export interface Signal {
  id: string;
  conversation_id: string;
  customer_name: string;
  customer_email: string;
  current_plan: string;
  profitwell_plans: string;
  result: Confidence;
  product: Product;
  signal_type: SignalType;
  stripe_verified: boolean;
  quote: string;
  action: string;
  intercom_url: string;
  slack_message_ts: string | null;
  detected_at: string;
  trigger: Trigger;
  feedback_status: FeedbackStatus;
  feedback_at: string | null;
  feedback_by: string | null;
  notes: string | null;
}

export interface SkillVersion {
  id: string;
  version: string;
  prompt: string;
  deployed_at: string;
  deployed_by: string;
  make_datastore_synced: boolean;
  notes: string;
}

// Intercom types
export interface IntercomContact {
  id: string;
  name: string;
  email: string;
  custom_attributes: {
    stripe_plan?: string;
    profitwell_plans?: string;
    [key: string]: unknown;
  };
}

export interface IntercomConversationPart {
  author: {
    type: string;
    name?: string;
  };
  body: string;
  created_at: number;
}

export interface IntercomConversation {
  id: string;
  created_at: number;
  updated_at: number;
  source: {
    body: string;
    author: {
      type: string;
      name?: string;
      email?: string;
      id?: string;
    };
  };
  contacts: {
    contacts: Array<{ id: string; type: string }>;
  };
  conversation_parts?: {
    conversation_parts: IntercomConversationPart[];
  };
  tags?: {
    tags: Array<{ name: string }>;
  };
  state: string;
}

// Scorer types
export interface ScorerInput {
  conversation: IntercomConversation;
  contact: IntercomContact;
  prompt: string;
}

export interface ScorerOutput {
  result: Confidence;
  product: Product;
  signal_type: SignalType;
  stripe_verified: boolean;
  current_plan: string;
  profitwell_plans: string;
  quote: string;
  action: string;
  raw_response: string;
  tokens_used: number;
  skip_reason?: string;
}

// Scan options
export interface ScanOptions {
  since?: string;      // e.g. "24h", "7d"
  from?: string;       // ISO date
  to?: string;         // ISO date
  conversationId?: string;
  dryRun?: boolean;
  output?: 'slack' | 'json' | 'table';
  minConfidence?: 'high' | 'medium' | 'low';
  trigger?: Trigger;
}
