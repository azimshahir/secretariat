'use client'

import { useMemo, useState, useTransition } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import {
  AI_ADMIN_TASKS,
  AI_TASK_DESCRIPTIONS,
  AI_TASK_LABELS,
  AI_PROVIDER_LABELS,
  type AiProvider,
  type AdminAiTask,
  type EffectiveAiConfig,
} from '@/lib/ai/catalog'
import { postJson } from '@/lib/api/client'
import {
  SUBSCRIPTION_PLAN_ORDER,
  getAllowedAiModelIdsForPlan,
  getSubscriptionPlan,
} from '@/lib/subscription/catalog'
import type { PlanTier } from '@/lib/supabase/types'
import { Button } from '@/components/ui/button'

interface Props {
  initialConfigs: Record<PlanTier, Record<AdminAiTask, EffectiveAiConfig>>
  options: Record<AiProvider, string[]>
}

export function AiModelSettings({ initialConfigs, options }: Props) {
  const [savedConfigs, setSavedConfigs] = useState(initialConfigs)
  const [configs, setConfigs] = useState(initialConfigs)
  const [pending, startTransition] = useTransition()

  const isDirty = useMemo(
    () => SUBSCRIPTION_PLAN_ORDER.some(planTier => AI_ADMIN_TASKS.some(task =>
      configs[planTier][task].provider !== savedConfigs[planTier][task].provider
      || configs[planTier][task].model !== savedConfigs[planTier][task].model
    )),
    [configs, savedConfigs],
  )

  function getAllowedProviderModels(planTier: PlanTier, provider: AiProvider) {
    const allowed = new Set(getAllowedAiModelIdsForPlan(planTier))
    return (options[provider] ?? []).filter(model => allowed.has(model))
  }

  function updateTaskProvider(planTier: PlanTier, task: AdminAiTask, provider: AiProvider) {
    const nextModels = getAllowedProviderModels(planTier, provider)
    setConfigs(prev => ({
      ...prev,
      [planTier]: {
        ...prev[planTier],
        [task]: {
          provider,
          model: nextModels[0] ?? '',
        },
      },
    }))
  }

  function updateTaskModel(planTier: PlanTier, task: AdminAiTask, model: string) {
    setConfigs(prev => ({
      ...prev,
      [planTier]: {
        ...prev[planTier],
        [task]: {
          ...prev[planTier][task],
          model,
        },
      },
    }))
  }

  return (
    <section className="mb-8 rounded-lg border bg-white p-4 dark:bg-zinc-900">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Plan AI Model Matrix
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Set the default AI model per subscription tier. Ask chat stays user-selectable inside the tier allowlist.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            startTransition(async () => {
              try {
                await postJson<{ ok: true }>('/api/admin/ai-models', { configs })
                setSavedConfigs(configs)
                toast.success('Plan AI model settings updated')
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Failed to update AI model settings')
              }
            })
          }}
          disabled={pending || !isDirty || SUBSCRIPTION_PLAN_ORDER.some(planTier => AI_ADMIN_TASKS.some(task => !configs[planTier][task].model))}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? 'Saving...' : 'Save Models'}
        </Button>
      </div>

      <div className="space-y-5">
        {SUBSCRIPTION_PLAN_ORDER.map(planTier => {
          const plan = getSubscriptionPlan(planTier)

          return (
            <div
              key={planTier}
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {plan.label}
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    RM {plan.priceRmMonthly}/month • {plan.operatorsLabel} • {plan.committeeAllowanceLabel}
                  </p>
                </div>
                <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  Allowed models: {getAllowedAiModelIdsForPlan(planTier).length}
                </div>
              </div>

              <div className="space-y-4">
                {AI_ADMIN_TASKS.map(task => {
                  const config = configs[planTier][task]
                  const providerOptions = (['anthropic', 'openai', 'google'] as const).filter(provider => (
                    getAllowedProviderModels(planTier, provider).length > 0
                  ))
                  const modelOptions = getAllowedProviderModels(planTier, config.provider)

                  return (
                    <div
                      key={`${planTier}-${task}`}
                      className="grid gap-3 rounded-lg border border-zinc-200 p-4 md:grid-cols-[minmax(0,1.3fr)_220px_minmax(0,1fr)] dark:border-zinc-800"
                    >
                      <div>
                        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {AI_TASK_LABELS[task]}
                        </h4>
                        <p className="mt-1 text-xs text-zinc-500">
                          {AI_TASK_DESCRIPTIONS[task]}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">
                          Current: {AI_PROVIDER_LABELS[savedConfigs[planTier][task].provider]} - {savedConfigs[planTier][task].model}
                        </p>
                      </div>

                      <select
                        value={config.provider}
                        onChange={event => updateTaskProvider(planTier, task, event.target.value as AiProvider)}
                        className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        disabled={pending}
                      >
                        {providerOptions.map(provider => (
                          <option key={provider} value={provider}>
                            {AI_PROVIDER_LABELS[provider]}
                          </option>
                        ))}
                      </select>

                      <select
                        value={config.model}
                        onChange={event => updateTaskModel(planTier, task, event.target.value)}
                        className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        disabled={pending || modelOptions.length === 0}
                      >
                        {modelOptions.map(model => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
