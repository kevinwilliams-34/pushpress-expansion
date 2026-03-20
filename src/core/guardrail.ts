/**
 * Guardrail engine — checks whether a customer already owns the product
 * they're asking about. If they do, the conversation is SKIPped.
 *
 * v1: uses Intercom custom_attributes (stripe_plan, profitwell_plans)
 * v2: will add direct Stripe API lookup (feature-flagged)
 */

import { IntercomContact, Product } from '../types';

export interface GuardrailResult {
  skip: boolean;
  reason?: string;
  current_plan: string;
  profitwell_plans: string;
  detected_products: Product[];
}

/**
 * Returns true if the plan string indicates ownership of the given product.
 */
function planContains(plan: string, product: string): boolean {
  if (!plan) return false;
  return plan.toLowerCase().includes(product.toLowerCase());
}

/**
 * Parse which PushPress products a customer currently owns from their plan data.
 */
export function detectOwnedProducts(stripePlan: string, profitwellPlans: string): Product[] {
  const combined = `${stripePlan} ${profitwellPlans}`.toLowerCase();
  const owned: Product[] = [];

  if (combined.includes('grow')) owned.push('Grow');
  if (combined.includes('train')) owned.push('Train');
  if (combined.includes('pro')) owned.push('Pro');

  return owned;
}

/**
 * The primary guardrail check.
 * Given a contact and the product(s) they appear to be asking about,
 * returns whether to SKIP and why.
 */
export function runGuardrail(contact: IntercomContact, productOfInterest: Product | null): GuardrailResult {
  const stripePlan = String(contact.custom_attributes?.stripe_plan ?? '');
  const profitwellPlans = String(contact.custom_attributes?.profitwell_plans ?? '');
  const detectedProducts = detectOwnedProducts(stripePlan, profitwellPlans);

  // If product of interest is identified and they already own it → SKIP
  if (productOfInterest && productOfInterest !== 'Unknown') {
    const alreadyOwns = planContains(stripePlan, productOfInterest) ||
      planContains(profitwellPlans, productOfInterest);

    if (alreadyOwns) {
      return {
        skip: true,
        reason: `Customer already owns ${productOfInterest} (plan: ${stripePlan || profitwellPlans || 'unknown'})`,
        current_plan: stripePlan,
        profitwell_plans: profitwellPlans,
        detected_products: detectedProducts,
      };
    }
  }

  // If no plan data at all and no Stripe record, flag as Low confidence (don't skip)
  // This is handled in the scorer confidence downgrade, not a hard skip here.

  return {
    skip: false,
    current_plan: stripePlan,
    profitwell_plans: profitwellPlans,
    detected_products: detectedProducts,
  };
}

/**
 * Quick pre-guardrail: detect which product the conversation is likely about
 * based on keyword matching alone (before Claude call).
 */
export function detectProductFromText(text: string): Product | null {
  const lower = text.toLowerCase();
  if (lower.includes('grow')) return 'Grow';
  if (lower.includes('train')) return 'Train';
  if (lower.includes('pro plan') || lower.includes('pro tier')) return 'Pro';
  return null;
}
