# PushPress Upsell Signal Reference

This reference file contains PushPress-specific patterns, known products, plan tiers,
and historical false positive patterns. Load this file when you need more detail
on what constitutes a genuine upsell for a PushPress customer.

---

## PushPress Product Tiers & Add-Ons

Use this to determine upgrade paths when doing Stripe lookups.

### Core Plans (ascending order)
1. **Free** — Basic gym management (launching ~May 2026)
2. **Starter / Base** — Core platform
3. **Pro** — Full platform features

### Key Add-Ons to Watch For
| Add-On | What it does | Upsell trigger |
|---|---|---|
| **Grow** | Marketing, lead gen, website tools | Customer asks about websites, lead capture, marketing automation, memberships |
| **Train** | Workout programming, coaching tools | Customer asks about programming, coach tools, athlete tracking, workout delivery |

### Common Upgrade Paths
- Free → Any paid plan
- Base → Pro
- Any plan without Grow → Grow
- Any plan without Train → Train
- Base/Pro without both add-ons → Bundle opportunity

---

## High-Value Upsell Scenarios (from closed-won deals — update as Sybill data comes in)

These are patterns from real deals that closed. Treat conversations matching these as HIGH confidence.

1. **Multi-location gym** asking about managing multiple sites → Grow or Pro upgrade
2. **Growing gym** adding staff and asking about coach tools → Train
3. **Gym owner** frustrated with their current website asking if PushPress has one → Grow
4. **High-volume gym** asking about member communication or automations → Grow
5. **Coaching-focused gym** asking about programming delivery to members → Train

---

## Known False Positive Patterns

These have historically fired as upsell signals but were support tickets. 
Add to this list over time as the feedback loop matures.

| Pattern | Why it's NOT an upsell |
|---|---|
| "How do I set up my Grow website?" | They already have Grow — this is setup/support |
| "Grow isn't showing my classes correctly" | Bug report on an owned product |
| "Train workouts aren't syncing" | Technical support for owned product |
| "What plan am I on?" | Billing inquiry, not upgrade intent |
| "Can I cancel Grow?" | Churn risk — route to CX retention, not sales upsell |
| "I have a question about my invoice" | Billing only |

---

## Marcy's Manual Search Terms (v1 baseline)

These are the terms Marcy currently uses when manually scanning Intercom.
Use these as seed queries in addition to the Signal Library in SKILL.md.

```
grow
grow pricing
grow train pricing
train
pricing
upgrade
add on
new product
website
lead gen
programming
coach tools
```

*Note: This list should expand over time as more patterns are identified.*

---

## Routing Notes

| Confidence | Slack behavior | Clay | HubSpot |
|---|---|---|---|
| High | Post immediately + @marcy | Always push | v2 — manual trigger for now |
| Medium | Post to channel, no tag | Push if 3+ in a batch | No |
| Low | Batch in daily digest | Optional | No |

### Who's in the Slack channel
- Marcy Rodriguez — primary reviewer + acts on opportunities
- Jim Putnam — AE, input on criteria, acts on flagged opps
- Jackson Glover — AE, input on criteria, acts on flagged opps  
- Beth — Backup SDR (coverage when Marshall is out)

---

## Future Enhancements (v2+)

- Pull Sybill closed-won deal data to enrich signal patterns by product
- Add HubSpot opportunity auto-creation for High confidence signals
- Real-time webhook trigger from Intercom (vs. scheduled scan)
- Fin conversation review — scan AI-handled convos that never reached a human
- Pre-call brief: surface Intercom history to reps alongside Sybill data before demos
