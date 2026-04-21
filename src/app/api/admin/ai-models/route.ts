import { NextResponse } from 'next/server'
import type { PlanTier } from '@/lib/supabase/types'
import {
  AI_ADMIN_TASKS,
  isSupportedProviderModel,
  type AdminAiTask,
  type EffectiveAiConfig,
} from '@/lib/ai/catalog'
import { isAiModelAllowedForPlan, normalizePlanTier } from '@/lib/subscription/catalog'
import { getSubscriptionSchemaCompatibility } from '@/lib/subscription/schema-compat'
import { requireAdminOrgContext, serializeAdminApiError } from '../_lib/write-access'

const PLAN_TIERS: PlanTier[] = ['free', 'basic', 'pro', 'premium']

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      configs?: Record<string, Record<AdminAiTask, EffectiveAiConfig>>
    }
    const context = await requireAdminOrgContext()
    const compatibility = await getSubscriptionSchemaCompatibility({
      organizationId: context.organizationId,
      adminSupabase: context.adminSupabase,
    })

    if (!compatibility.planAiMatrixAvailable) {
      return NextResponse.json(
        {
          ok: false,
          message: 'This action needs the latest subscription database update',
          code: 'subscription_schema_not_ready',
        },
        { status: 503 },
      )
    }

    const configs = PLAN_TIERS.reduce((next, planTier) => {
      const planConfigs = body.configs?.[planTier]
      if (!planConfigs) {
        throw new Error(`Missing AI model settings for ${planTier}`)
      }

      next[planTier] = AI_ADMIN_TASKS.reduce((taskConfigs, task) => {
        const config = planConfigs[task]
        const model = config?.model?.trim() ?? ''

        if (!config || !isSupportedProviderModel(config.provider, model)) {
          throw new Error(`Unsupported provider/model selection for ${planTier}:${task}`)
        }
        if (!isAiModelAllowedForPlan(planTier, model)) {
          throw new Error(`${model} is not allowed for the ${planTier} plan`)
        }

        taskConfigs[task] = {
          provider: config.provider,
          model,
        }
        return taskConfigs
      }, {} as Record<AdminAiTask, EffectiveAiConfig>)

      return next
    }, {} as Record<PlanTier, Record<AdminAiTask, EffectiveAiConfig>>)

    const upserts = PLAN_TIERS.map(planTier => ({
      organization_id: context.organizationId,
      plan_tier: normalizePlanTier(planTier),
      generate_mom_provider: configs[planTier].generate_mom.provider,
      generate_mom_model: configs[planTier].generate_mom.model,
      go_deeper_ask_provider: configs[planTier].go_deeper_ask.provider,
      go_deeper_ask_model: configs[planTier].go_deeper_ask.model,
      go_deeper_agent_provider: configs[planTier].go_deeper_agent.provider,
      go_deeper_agent_model: configs[planTier].go_deeper_agent.model,
      generate_itineraries_provider: configs[planTier].generate_itineraries.provider,
      generate_itineraries_model: configs[planTier].generate_itineraries.model,
    }))

    const { error } = await context.adminSupabase
      .from('organization_ai_plan_settings')
      .upsert(upserts, { onConflict: 'organization_id,plan_tier' })

    if (error) {
      throw new Error(error.message)
    }

    await context.adminSupabase.from('audit_logs').insert({
      organization_id: context.organizationId,
      user_id: context.userId,
      action: 'organization_ai_plan_models_updated',
      details: configs,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message, code } = serializeAdminApiError(
      error,
      'Failed to update AI model settings',
    )
    return NextResponse.json({ ok: false, message, code }, { status })
  }
}
