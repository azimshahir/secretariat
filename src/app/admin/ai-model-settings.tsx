'use client'

import { Bot, CheckCircle2 } from 'lucide-react'
import { AI_ADMIN_TASKS, AI_TASK_LABELS, AI_TASK_DESCRIPTIONS, getAiModelLabel, type AdminAiTask, type EffectiveAiConfig } from '@/lib/ai/catalog'
import type { PlanTier } from '@/lib/supabase/types'

interface Props {
  initialConfigs: Record<PlanTier, Record<AdminAiTask, EffectiveAiConfig>>
}

export function AiModelSettings({ initialConfigs }: Props) {
  // Show the current model config per task (read-only)
  // All tiers now use the same model — show the 'pro' tier as representative
  const configs = initialConfigs.pro ?? initialConfigs.free

  return (
    <section className="mb-8 rounded-lg border bg-white p-4 dark:bg-zinc-900">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          AI Model Configuration
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          All minute generation uses a single model. Model selection per plan has been removed for simplicity and cost efficiency.
        </p>
      </div>

      <div className="space-y-3">
        {AI_ADMIN_TASKS.map(task => {
          const config = configs[task]
          return (
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
              <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 dark:border-emerald-900 dark:bg-emerald-950">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {getAiModelLabel(config.model)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
