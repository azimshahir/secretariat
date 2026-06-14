import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, getSiteUrl } from '@/lib/billing/stripe'
import {
  getBillingSettings,
  TOPUP_MIN_CREDITS,
  TOPUP_MAX_CREDITS,
} from '@/lib/subscription/billing-settings'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const site = getSiteUrl(req)
  const credits = Math.trunc(Number(url.searchParams.get('credits') ?? 0))

  if (!Number.isFinite(credits) || credits < TOPUP_MIN_CREDITS || credits > TOPUP_MAX_CREDITS) {
    return NextResponse.redirect(`${site}/pricing?error=invalid_credits`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${site}/login?next=/pricing`)
  }

  try {
    const stripe = getStripe()
    const admin = createAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id, full_name, organization_id')
      .eq('id', user.id)
      .single()

    const settings = await getBillingSettings(profile?.organization_id, admin)
    const unitAmount = Math.round(settings.creditPriceRm * 100) // sen
    if (unitAmount <= 0) {
      return NextResponse.redirect(`${site}/pricing?error=topup_unavailable`)
    }

    let customerId = profile?.stripe_customer_id ?? null
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: profile?.full_name ?? undefined,
        metadata: { userId: user.id },
      })
      customerId = customer.id
      await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{
        quantity: credits,
        price_data: {
          currency: 'myr',
          unit_amount: unitAmount,
          product_data: { name: 'Secretariat credits' },
        },
      }],
      success_url: `${site}/?topup=success`,
      cancel_url: `${site}/pricing`,
      metadata: { type: 'credit_topup', userId: user.id, credits: String(credits) },
    })

    if (!session.url) throw new Error('Stripe did not return a checkout URL')
    return NextResponse.redirect(session.url)
  } catch (error) {
    console.error('[api/billing/topup] failed', error)
    return NextResponse.redirect(`${site}/pricing?error=topup`)
  }
}
