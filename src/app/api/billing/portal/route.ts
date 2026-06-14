import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, getSiteUrl } from '@/lib/billing/stripe'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const site = getSiteUrl(req)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${site}/login?next=/settings`)
  }

  try {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (!profile?.stripe_customer_id) {
      return NextResponse.redirect(`${site}/pricing`)
    }

    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${site}/settings`,
    })
    return NextResponse.redirect(session.url)
  } catch (error) {
    console.error('[api/billing/portal] failed', error)
    return NextResponse.redirect(`${site}/settings?error=portal`)
  }
}
