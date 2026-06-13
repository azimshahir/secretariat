'use client'

import { useState, useTransition } from 'react'
import { Bot, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  AI_ADMIN_TASKS,
  AI_TASK_LABELS,
  AI_TASK_DESCRIPTIONS,
  AI_MODEL_OPTIONS,
  inferProviderFromModel,
  type AdminAiTask,
  type EffectiveAiConfig,
} from '@/lib/ai/catalog'
import type { PlanTier } from '@/lib/supabase/types'
import { Button } from '@/components/ui/button'
import { updateOrganizationAiModels } from './actions'

interface Props {
  initialConfigs: Record<PlanTier, Record<AdminAiTask, EffectiveAiConfig>>
  suggestedConfigs?: Record<AdminAiTask, EffectiveAiConfig> | null
}

function buildInitialModels(
  initialConfigs: Record<PlanTier, Record<AdminAiTask, EffectiveAiConfig>>,
): Record<AdminAiTask, string> {
  const configs = initialConfigs.pro ?? initialConfigs.free
  return Object.fromEntries(
    AI_ADMIN_TASKS.map(task => [task, configs[task]?.model ?? '']),
  ) as Record<AdminAiTask, string>
}

export function AiModelSettings({ initialConfigs, suggestedConfigs }: Props) {
  const [models, setModels] = useState<Record<AdminAiTask, string>>(
    () => buildInitialModels(initialConfigs),
  )
  const [savedModels, setSavedModels] = useState<Record<AdminAiTask, string>>(
    () => buildInitialModels(initialConfigs),
  )
  const [pending, startTransition] = useTransition()

  const isDirty = AI_ADMIN_TASKS.some(task => models[task] !== savedModels[task])

  function applyAll(model: string) {
    const provider = inferProviderFromModel(model)
    if (!provider) return
    setModels(Object.fromEntries(AI_ADMIN_TASKS.map(task => [task, model])) as Record<AdminAiTask, string>)
  }

  return (
    <section className="mb-8 rounded-lg border bg-white p-4 dark:bg-zinc-900">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            AI Model Configuration
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Select the AI model for each generation task.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {suggestedConfigs && (
            <Button
              type="button"
              variant="outline"
              onClick={() => applyAll(suggestedConfigs.generate_mom.model)}
              disabled={pending}
              className="gap-1.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Apply Preset Suggestion
            </Button>
          )}
          <Button
            type="button"
            onClick={() => {
              startTransition(async () => {
                try {
                  const configs = Object.fromEntries(
                    AI_ADMIN_TASKS.map(task => {
                      const model = models[task]
                      const provider = inferProviderFromModel(model)
                      if (!provider) throw new Error(`Unknown provider for model: ${model}`)
                      return [task, { provider, model }]
                    }),
                  ) as Record<AdminAiTask, EffectiveAiConfig>
                  await updateOrganizationAiModels({ configs })
                  setSavedModels({ ...models })
                  toast.success('AI model configuration saved')
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Failed to save AI model config')
                }
              })
            }}
            disabled={pending || !isDirty}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {pending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {AI_ADMIN_TASKS.map(task => (
          <div
            key={task}
            className="flex items-center gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950">
              <Bot className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {AI_TASK_LABELS[task]}
              </h4>
              <p className="mt-0.5 text-xs text-zinc-500">{AI_TASK_DESCRIPTIONS[task]}</p>
            </div>
            <select
              value={models[task]}
              onChange={e => setModels(prev => ({ ...prev, [task]: e.target.value }))}
              disabled={pending}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {AI_MODEL_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} ({opt.provider})
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {isDirty && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          You have unsaved changes.
        </p>
      )}
    </section>
  )
}
