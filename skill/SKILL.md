---
name: intercom-upsell-detector
description: >
  Detects and surfaces upsell opportunities from Intercom conversations for PushPress.
  Uses Stripe to cross-reference customer subscriptions by email before flagging,
  ensuring signals are genuine expansion opportunities and not support requests from
  customers who already own the product. Routes qualified signals to Slack and/or Clay.
  
  ALWAYS use this skill when the user asks to:
  - Scan or search Intercom for upsell opportunities
  - Find expansion signals, upgrade interest, or add-on inquiries in support conversations
  - Run an upsell check, upsell audit, or upsell scan
  - Look for customers interested in Grow, Train, or any PushPress paid add-on
  - Build or run the upsell bot or upsell alert
  - Find customers who should be talking to sales
  Also trigger for casual phrasing like "find me upsells", "any upsell signals today?",
  "run the upsell scan", or "who should Marcy reach out to?"

compatibility:
  required_mcps:
    - Intercom (conversation search + customer email lookup)
    - Stripe (subscription lookup by email)
    - Slack (alert delivery)
  optional_mcps:
    - Clay (structured opportunity logging)
    - HubSpot (opportunity creation — v2)
---

# Intercom Upsell Detector

Surfaces genuine upsell opportunities from Intercom conversations by cross-referencing
Stripe subscription data to eliminate false positives before alerting the sales team.

---

## Core Workflow

Follow these steps in order every time this skill is invoked.

### Step 1 — Fetch Intercom Conversations

Use Intercom MCP to pull recent conversations. Default window: **last 7 days**.
If the user specifies a time range, use that instead.

**Filter on pull:**
- Open or recently closed conversations only
- Exclude bot-only (Fin-handled) conversations where no human signal keyword is present
- Exclude conversations already tagged as upsell or already escalated to sales

Search using the keyword groups in the **Signal Library** (see below).
Cast a wide net at this stage — false positives get filtered in Step 2.

---

### Step 2 — Extract Customer Email

For each flagged conversation, extract the customer's email address from the Intercom contact record.

- If no email is found, note `email: unknown` and still proceed — flag with lower confidence
- If multiple contacts are in the conversation, use the primary contact email

---

### Step 3 — Stripe Subscription Lookup (GUARDRAIL)

**This is the most important step. Do not skip it.**

Use Stripe MCP to look up the customer's active subscriptions by email.

For each signal detected, check:

| Signal Type | Stripe Check |
|---|---|
| Asking about Grow | Do they already have an active Grow subscription? |
| Asking about Train | Do they already have an active Train subscription? |
| Asking about a specific add-on | Do they already own that add-on? |
| Asking about pricing/upgrading | What plan are they currently on? Is there a higher tier? |
| No product mentioned | What do they currently have? What are they missing? |

**Guardrail rules:**
- If the customer **already owns** the product they're asking about → **SKIP. This is a support ticket, not an upsell.**
- If the customer is on the **highest available plan** with no upgrade path → **SKIP.**
- If Stripe returns **no customer record** for the email → Flag with confidence = `Low` and note `stripe: no record`
- If the ask is clearly a **support or technical issue** (not exploring new capabilities) → **SKIP**, even if the product is mentioned

---

### Step 4 — Score the Signal

Once the Stripe check passes, score the conversation:

#### Confidence: HIGH
All of the following are true:
- Customer explicitly asks about a product, feature, or plan they don't have
- No current subscription for that product in Stripe
- Positive or curious tone (not frustrated)
- Has an upgrade path available

#### Confidence: MEDIUM
Any of the following:
- Expansion language without explicit product mention ("we're growing," "adding staff," "opening another location")
- High engagement on setup/workflows for a product adjacent to one they don't own
- Asking about pricing without specifying what they want
- Positive sentiment + indirect capability ask

#### Confidence: LOW
Any of the following:
- Mention of Grow/Train in passing (not exploratory)
- No Stripe record found for the email
- Signal is inferred from behavior, not stated intent
- Could be interpreted as either support OR upsell

---

### Step 5 — Build the Opportunity Summary

For each qualifying conversation, produce:

```
CUSTOMER: [Name / Company]
EMAIL: [email]
CURRENT PLAN: [from Stripe — plan name]
SIGNAL TYPE: [Explicit | Behavioral | Inferred]
CONFIDENCE: [High | Medium | Low]
PRODUCT OF INTEREST: [Grow | Train | Add-on name | Unknown]
KEY QUOTE: "[verbatim excerpt from conversation that triggered the flag]"
RECOMMENDED ACTION: [e.g., "Schedule discovery call", "Send Grow overview", "Have Marcy reach out"]
INTERCOM LINK: [direct URL to conversation]
DATE DETECTED: [timestamp]
```

---

### Step 6 — Route the Output

#### Slack Alert (default — always do this)

Post to the designated upsell channel. Format each alert as a clean block:

```
🔔 *Upsell Signal Detected* — [Confidence: HIGH / MEDIUM / LOW]

*Customer:* [Name] | [Company]
*Current Plan:* [Stripe plan]
*Signal:* [Signal type + product of interest]
*Quote:* "[key quote]"
*Action:* [Recommended next step]
*Conversation:* [Intercom link]

@marcy — flagged for review
```

- High confidence → Post immediately, @marcy in the message
- Medium confidence → Post to channel, no direct tag (team reviews async)
- Low confidence → Batch into a daily digest format, don't ping anyone

#### Clay Table (if requested or if >3 signals found)

Push each opportunity as a structured row with all fields from Step 5.
Clay can then trigger HubSpot opportunity creation or sequences downstream.

---

## Signal Library

Use these keyword and pattern groups when scanning conversations.

### Group A — Explicit Product Interest
```
grow, grow plan, grow pricing, grow features
train, train plan, train pricing, train features
add-on, add on, upgrade, upgrade my plan
new product, what else do you offer, what's included in
demo, can I see, show me how
```

### Group B — Pricing Exploration
```
how much does, what does it cost, pricing, price, cost per
what plan, which plan, plan options, compare plans
is there a way to get, do you have a plan that
```

### Group C — Expansion Language
```
we're growing, growing our team, adding staff, new location
opening another, expanding, scaling, more members
new hire, hiring, second location, franchise
```

### Group D — Capability Gap (Inferred)
```
wish you had, would be great if, do you support, can your platform
is there a feature, we need a way to, how do we handle
currently using [other tool] for, we also use [competitor]
```

### Group E — High Engagement Signals (Behavioral)
These aren't keywords — watch for:
- Customer has had 5+ conversations in 30 days about Grow setup/workflows
- Customer is deeply configuring features in a plan adjacent to one they don't own
- Customer asks detailed "how does X work" questions about a product they don't have

---

## What NOT to Flag (Support vs. Upsell Disambiguation)

This is critical. Before flagging anything, ask:
> "Is this person trying to get something working, or are they exploring new capabilities?"

**DO NOT FLAG** if:
- They own the product and are asking how to use it → support ticket
- They're frustrated, reporting a bug, or escalating an issue → support ticket
- They mention Grow/Train only in the context of troubleshooting → support ticket
- They're asking about a feature that's included in their current plan → support ticket
- The conversation is purely billing/invoice related → support ticket

**DO FLAG** if:
- They're asking what Grow/Train *does* when they don't have it
- They're asking if their plan *includes* something → check Stripe → if not included, flag
- They're comparing plans or asking what they'd get by upgrading
- They describe a business need that maps to a product they don't own

When in doubt: **run the Stripe check first, then decide.**

---

## Feedback Loop

After posting alerts, watch for these signals and use them to improve future scans:

- If Marcy or the team reacts with ❌ or replies "not an upsell" → log as false positive, note what triggered it, and add it to the DO NOT FLAG patterns above
- If a flagged conversation converts to a deal → note what signal type it was (high value training data)
- Over time, build a list of PushPress-specific false positive patterns to add to Group E exclusions

---

## Output When No Signals Found

If no qualifying conversations are found after the full scan:

```
✅ Upsell scan complete — [date range scanned]
Conversations reviewed: [N]
Signals found: 0
No upsell opportunities detected in this window.
```

---

## Notes

- **Primary domain owner:** Marcy Rodriguez (CX) — she defines and validates signal quality
- **Slack channel:** Dedicated upsell signals channel (Marcy, Jim, Jackson, Beth)
- **Stripe is the source of truth** for what a customer currently owns — always check before flagging
- **Intercom product data** (passed in from the product) should match Stripe, but Stripe takes precedence if there's a conflict
- **v1 scope:** Slack alerts + Clay push. HubSpot opportunity auto-creation is v2 (after signal quality is validated)
