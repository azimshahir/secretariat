'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { CustomIndustryRequestStatus } from '@/lib/supabase/types'

export async function updateCustomRequestStatus(
  id: string,
  status: CustomIndustryRequestStatus,
  notes: string
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    throw new Error('Admin access required')
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('custom_industry_requests')
    .update({
      status,
      admin_notes: notes || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', profile.organization_id)

  if (error) throw new Error(error.message)

  revalidatePath('/admin')
}
