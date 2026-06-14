import 'server-only'

import Stripe from 'stripe'

export type BillingTier = 'pro' | 'premium'

let stripeClient: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
    stripeClient = new Stripe(key)
  }
  return stripeClient
}

// Price IDs (overridable via env). Defaults are the live/test prices created in Stripe.
export const PRICE_BY_TIER: Record<BillingTier, string> = {
  pro: process.env.STRIPE_PRICE_PRO || 'price_1Ti8My2Q1dYB9tsfyFM36xNg',
  premium: process.env.STRIPE_PRICE_PREMIUM || 'price_1Ti8NL2Q1dYB9tsfcmKYyaLM',
}

export const TIER_BY_PRICE: Record<string, BillingTier> = Object.fromEntries(
  (Object.entries(PRICE_BY_TIER) as [BillingTier, string][]).map(([tier, price]) => [price, tier]),
)

export function isBillingTier(value: string | null | undefined): value is BillingTier {
  return value === 'pro' || value === 'premium'
}

export function getSiteUrl(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  const host = req.headers.get('host')
  return host ? `https://${host}` : 'https://secretariat.my'
}
