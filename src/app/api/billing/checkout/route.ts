import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, PRICE_BY_TIER, isBillingTier, getSiteUrl } from '@/lib/billing/stripe'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const tier = url.searchParams.get('tier')
  const site = getSiteUrl(req)

  if (!isBillingTier(tier)) {
    return NextResponse.redirect(`${site}/pricing`)
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
      .select('stripe_customer_id, full_name')
      .eq('id', user.id)
      .single()

    // Reuse or create a Stripe customer for this user
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
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: PRICE_BY_TIER[tier], quantity: 1 }],
      success_url: `${site}/?checkout=success`,
      cancel_url: `${site}/pricing`,
      metadata: { userId: user.id, tier },
      subscription_data: { metadata: { userId: user.id, tier } },
    })

    if (!session.url) throw new Error('Stripe did not return a checkout URL')
    return NextResponse.redirect(session.url)
  } catch (error) {
    console.error('[api/billing/checkout] failed', error)
    return NextResponse.redirect(`${site}/pricing?error=checkout`)
  }
}
