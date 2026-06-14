import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, TIER_BY_PRICE, type BillingTier } from '@/lib/billing/stripe'
import { adjustUserCreditWallet } from '@/lib/subscription/entitlements'

export const runtime = 'nodejs'

type ProfileUpdate = {
  plan?: 'free' | BillingTier
  stripe_subscription_id?: string | null
  subscription_status?: string | null
  current_period_end?: string | null
}

async function updateProfileByCustomer(customerId: string, patch: ProfileUpdate) {
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update(patch).eq('stripe_customer_id', customerId)
  if (error) console.error('[billing/webhook] profile update failed', error.message)
}

function tierFromSubscription(sub: Stripe.Subscription): BillingTier | null {
  const priceId = sub.items.data[0]?.price?.id
  return priceId ? TIER_BY_PRICE[priceId] ?? null : null
}

export async function POST(req: Request) {
  const stripe = getStripe()
  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const body = await req.text()
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch (error) {
    console.error('[billing/webhook] signature verification failed', error)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        // One-time credit top-up
        if (session.mode === 'payment' && session.metadata?.type === 'credit_topup') {
          const userId = session.metadata.userId
          const credits = Math.trunc(Number(session.metadata.credits ?? 0))
          if (userId && credits > 0) {
            const admin = createAdminClient()
            const { data: profile } = await admin
              .from('profiles')
              .select('organization_id')
              .eq('id', userId)
              .single()
            if (profile?.organization_id) {
              await adjustUserCreditWallet({
                targetUserId: userId,
                organizationId: profile.organization_id,
                deltaCredits: credits,
                reason: `Self-service credit top-up (${credits} credits)`,
                createdBy: userId,
                adminSupabase: admin,
              })
            }
          }
          break
        }

        if (session.mode !== 'subscription' || !session.customer || !session.subscription) break
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        const tier = tierFromSubscription(sub)
          ?? (session.metadata?.tier as BillingTier | undefined)
          ?? null
        await updateProfileByCustomer(session.customer as string, {
          plan: tier ?? 'free',
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          current_period_end: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
        })
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const tier = tierFromSubscription(sub)
        const isActive = sub.status === 'active' || sub.status === 'trialing'
        await updateProfileByCustomer(sub.customer as string, {
          plan: isActive && tier ? tier : 'free',
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          current_period_end: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
        })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await updateProfileByCustomer(sub.customer as string, {
          plan: 'free',
          subscription_status: 'canceled',
        })
        break
      }
    }
  } catch (error) {
    console.error('[billing/webhook] handler error', error)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
