'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { type AiProvider, isSupportedProviderModel } from '@/lib/ai/model-config'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') throw new Error('Admin access required')
  return { supabase, userId: user.id, organizationId: profile.organization_id }
}

export async function updateOrganizationAiModel(input: {
  provider: AiProvider
  model: string
}) {
  const { supabase, userId, organizationId } = await requireAdmin()
  const provider = input.provider
  const model = input.model.trim()

  if (!isSupportedProviderModel(provider, model)) {
    throw new Error('Unsupported provider/model selection')
  }

  const { error } = await supabase
    .from('organization_ai_settings')
    .upsert(
      { organization_id: organizationId, provider, model },
      { onConflict: 'organization_id' },
    )
  if (error) throw new Error(error.message)

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'organization_ai_model_updated',
    details: { provider, model },
  })

  revalidatePath('/admin')
}
