'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  AI_TASKS,
  type AiTask,
  type EffectiveAiConfig,
  isSupportedProviderModel,
} from '@/lib/ai/catalog'

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

export async function updateOrganizationAiModels(input: {
  configs: Record<AiTask, EffectiveAiConfig>
}) {
  const { supabase, userId, organizationId } = await requireAdmin()
  const configs = AI_TASKS.reduce((next, task) => {
    const config = input.configs[task]
    const model = config?.model?.trim() ?? ''

    if (!config || !isSupportedProviderModel(config.provider, model)) {
      throw new Error(`Unsupported provider/model selection for ${task}`)
    }

    next[task] = {
      provider: config.provider,
      model,
    }
    return next
  }, {} as Record<AiTask, EffectiveAiConfig>)

  const defaultConfig = configs.generate_mom

  const { error } = await supabase
    .from('organization_ai_settings')
    .upsert(
      {
        organization_id: organizationId,
        provider: defaultConfig.provider,
        model: defaultConfig.model,
        generate_mom_provider: configs.generate_mom.provider,
        generate_mom_model: configs.generate_mom.model,
        go_deeper_ask_provider: configs.go_deeper_ask.provider,
        go_deeper_ask_model: configs.go_deeper_ask.model,
        go_deeper_agent_provider: configs.go_deeper_agent.provider,
        go_deeper_agent_model: configs.go_deeper_agent.model,
        generate_itineraries_provider: configs.generate_itineraries.provider,
        generate_itineraries_model: configs.generate_itineraries.model,
      },
      { onConflict: 'organization_id' },
    )
  if (error) throw new Error(error.message)

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'organization_ai_models_updated',
    details: configs,
  })

  revalidatePath('/admin')
}
