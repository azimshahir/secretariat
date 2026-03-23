'use client'

import { useMemo, useState, useTransition } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import {
  AI_TASK_DESCRIPTIONS,
  AI_TASK_LABELS,
  AI_TASKS,
  type AiProvider,
  type AiTask,
  type EffectiveAiConfig,
} from '@/lib/ai/catalog'
import { Button } from '@/components/ui/button'
import { updateOrganizationAiModels } from './actions'

interface Props {
  initialConfigs: Record<AiTask, EffectiveAiConfig>
  options: Record<AiProvider, string[]>
}

const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
}

export function AiModelSettings({ initialConfigs, options }: Props) {
  const [configs, setConfigs] = useState(initialConfigs)
  const [pending, startTransition] = useTransition()

  const isDirty = useMemo(
    () => AI_TASKS.some(task =>
      configs[task].provider !== initialConfigs[task].provider
      || configs[task].model !== initialConfigs[task].model
    ),
    [configs, initialConfigs],
  )

  function updateTaskProvider(task: AiTask, provider: AiProvider) {
    const nextModels = options[provider] ?? []
    setConfigs(prev => ({
      ...prev,
      [task]: {
        provider,
        model: nextModels[0] ?? '',
      },
    }))
  }

  function updateTaskModel(task: AiTask, model: string) {
    setConfigs(prev => ({
      ...prev,
      [task]: {
        ...prev[task],
        model,
      },
    }))
  }

  return (
    <section className="mb-8 rounded-lg border bg-white p-4 dark:bg-zinc-900">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            AI Model Control
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Admin-only per-feature model selection for the main AI workflows.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            startTransition(async () => {
              try {
                await updateOrganizationAiModels({ configs })
                toast.success('AI model settings updated')
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Failed to update AI model settings')
              }
            })
          }}
          disabled={pending || !isDirty || AI_TASKS.some(task => !configs[task].model)}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? 'Saving...' : 'Save Models'}
        </Button>
      </div>

      <div className="space-y-4">
        {AI_TASKS.map(task => {
          const config = configs[task]
          const modelOptions = options[config.provider] ?? []

          return (
            <div
              key={task}
              className="grid gap-3 rounded-lg border border-zinc-200 p-4 md:grid-cols-[minmax(0,1.3fr)_220px_minmax(0,1fr)] dark:border-zinc-800"
            >
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {AI_TASK_LABELS[task]}
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  {AI_TASK_DESCRIPTIONS[task]}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Current: {PROVIDER_LABEL[initialConfigs[task].provider]} - {initialConfigs[task].model}
                </p>
              </div>

              <select
                value={config.provider}
                onChange={event => updateTaskProvider(task, event.target.value as AiProvider)}
                className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                disabled={pending}
              >
                <option value="anthropic">{PROVIDER_LABEL.anthropic}</option>
                <option value="openai">{PROVIDER_LABEL.openai}</option>
                <option value="google">{PROVIDER_LABEL.google}</option>
              </select>

              <select
                value={config.model}
                onChange={event => updateTaskModel(task, event.target.value)}
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
    </section>
  )
}
